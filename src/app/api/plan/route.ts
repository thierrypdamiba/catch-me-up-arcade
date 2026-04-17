/**
 * Plan API Route — Daily Planning Agent
 *
 * POST /api/plan
 *
 * Triggers the triage agent to scan connected services (Slack, Calendar,
 * Linear, GitHub, Gmail, etc.), classify each item, and stream back
 * structured InboxItem data as NDJSON.
 */

import { streamText, stepCountIs } from "ai";
import { getSession } from "@/lib/auth";
import { getModel, planPrompt } from "@/lib/agent";
import { getArcadeMCPClient } from "@/lib/arcade";
import { isQdrantConfigured, upsertItems } from "@/lib/qdrant";
import type { InboxItem } from "@/types/inbox";

export const maxDuration = 300;

// --- Types ---

type PlanEvent =
  | { type: "status"; message: string }
  | { type: "task"; data: InboxItem }
  | { type: "summary"; data: { total: number; bySource: Record<string, number> } }
  | { type: "auth_required"; authUrl: string; toolName?: string }
  | { type: "sources"; sources: string[] }
  | { type: "error"; message: string }
  | { type: "done" };

function encodeEvent(event: PlanEvent): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(event) + "\n");
}

import { mapToolToSource } from "@/lib/sources";

function extractAuthUrlFromToolOutput(output: unknown): string | null {
  const fromRecord = (value: unknown): string | null => {
    if (!value || typeof value !== "object") return null;
    const obj = value as Record<string, unknown>;
    if (typeof obj.authorization_url === "string" && obj.authorization_url)
      return obj.authorization_url;

    if (obj.structuredContent && typeof obj.structuredContent === "object") {
      const nested = obj.structuredContent as Record<string, unknown>;
      if (typeof nested.authorization_url === "string" && nested.authorization_url)
        return nested.authorization_url;
    }
    return null;
  };

  const fromObject = fromRecord(output);
  if (fromObject) return fromObject;

  const raw =
    typeof output === "string" ? output : JSON.stringify(output ?? "");
  const match = raw.match(
    /https:\/\/[^\s"'\]}>]+\/oauth\/[^\s"'\]}>]+|https:\/\/[^\s"'\]}>]+authorize[^\s"'\]}>]*/i
  );
  return match ? match[0] : null;
}

// --- Parse structured JSON blocks from streamed text ---

function extractJsonBlocks(text: string): {
  tasks: InboxItem[];
  summary: { total: number; bySource: Record<string, number> } | null;
  remaining: string;
} {
  const tasks: InboxItem[] = [];
  let summary: { total: number; bySource: Record<string, number> } | null = null;
  let lastConsumedIndex = 0;

  const taskPattern = /```json:task\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = taskPattern.exec(text)) !== null) {
    try {
      tasks.push(JSON.parse(match[1].trim()) as InboxItem);
      lastConsumedIndex = match.index + match[0].length;
    } catch {
      // Incomplete JSON
    }
  }

  const summaryPattern = /```json:summary\s*\n([\s\S]*?)```/g;
  while ((match = summaryPattern.exec(text)) !== null) {
    try {
      const raw = JSON.parse(match[1].trim());
      // Normalize: handle both old { tasks, conversations } and new { total, bySource } shapes
      if (raw.total !== undefined && raw.bySource !== undefined) {
        summary = raw;
      } else if (raw.tasks !== undefined) {
        summary = { total: raw.tasks, bySource: {} };
      } else {
        summary = { total: 0, bySource: {} };
      }
      const endIdx = match.index + match[0].length;
      if (endIdx > lastConsumedIndex) lastConsumedIndex = endIdx;
    } catch {
      // Incomplete JSON
    }
  }

  return {
    tasks,
    summary,
    remaining: lastConsumedIndex > 0 ? text.slice(lastConsumedIndex) : text,
  };
}

// --- Route handler ---

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let windowDays = 7;
  try {
    const body = (await request.json().catch(() => null)) as { windowDays?: number } | null;
    if (body && typeof body.windowDays === "number" && body.windowDays > 0 && body.windowDays <= 90) {
      windowDays = Math.floor(body.windowDays);
    }
  } catch {
    // fall through with default
  }
  const windowLabel =
    windowDays === 1 ? "the last 24 hours" : `the last ${windowDays} days`;
  const windowStartIso = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  let mcpClient: Awaited<ReturnType<typeof getArcadeMCPClient>> | null = null;
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
  });

  function emit(event: PlanEvent) {
    try {
      streamController?.enqueue(encodeEvent(event));
    } catch {
      // Stream closed by client
    }
  }

  // Process async — return stream immediately
  (async () => {
    try {
      emit({ type: "status", message: "Connecting to Arcade Gateway..." });

      mcpClient = await getArcadeMCPClient();
      const allTools = await mcpClient.tools();

      // Only keep tools useful for triage — filter out mutations (create, delete, send, etc.)
      // so the agent only reads data during planning.
      const MUTATION = /create|update|delete|send|reply|post|archive|remove|add|invite|merge|close|assign|edit|publish|comment/i;

      function isTriageTool(name: string): boolean {
        return !MUTATION.test(name);
      }
      // Cap individual tool results so they don't blow the model's context window.
      // Gmail threads, GitHub notifications, etc. can return 50k+ chars each.
      // MCP tools return { content: [{ type: "text", text: "..." }] } — we must
      // preserve that structure or the AI SDK crashes.
      const MAX_TOOL_RESULT_CHARS = 4000;

      function truncateToolResult(result: unknown): unknown {
        if (result && typeof result === "object" && "content" in (result as Record<string, unknown>)) {
          const obj = result as { content: { type: string; text: string }[] };
          return {
            ...obj,
            content: obj.content.map((item) => {
              if (item.type === "text" && item.text && item.text.length > MAX_TOOL_RESULT_CHARS) {
                return {
                  ...item,
                  text: item.text.slice(0, MAX_TOOL_RESULT_CHARS) +
                    `\n...[truncated ${item.text.length - MAX_TOOL_RESULT_CHARS} chars]`,
                };
              }
              return item;
            }),
          };
        }
        if (typeof result === "string" && result.length > MAX_TOOL_RESULT_CHARS) {
          return result.slice(0, MAX_TOOL_RESULT_CHARS) +
            `\n...[truncated ${result.length - MAX_TOOL_RESULT_CHARS} chars]`;
        }
        return result;
      }

      const tools: typeof allTools = {};
      for (const [name, tool] of Object.entries(allTools)) {
        if (!isTriageTool(name)) continue;
        // Don't give WhoAmI tools to the model — they're for auth checks, not data
        if (/[._]WhoAmI$/i.test(name)) continue;
        const orig = tool.execute;
        tools[name] = {
          ...tool,
          execute: orig
            ? async (args: Record<string, unknown>, opts: unknown) => {
                const result = await (orig as (...a: unknown[]) => unknown).call(null, args, opts);
                return truncateToolResult(result);
              }
            : undefined,
        } as (typeof allTools)[string];
      }

      const toolNames = Object.keys(tools);
      const sources = [...new Set(toolNames.map((n) => mapToolToSource(n)))];
      console.log(`[plan] ${toolNames.length} triage tools (of ${Object.keys(allTools).length} total) from sources: ${sources.join(", ")}`);

      emit({
        type: "status",
        message: `Found ${toolNames.length} tools across ${sources.length} sources. Starting triage...`,
      });

      emit({ type: "sources", sources });

      // Build a per-source tool inventory so the model knows exactly what to call
      const toolsBySource: Record<string, string[]> = {};
      for (const name of toolNames) {
        const src = mapToolToSource(name);
        if (!toolsBySource[src]) toolsBySource[src] = [];
        toolsBySource[src].push(name);
      }
      const toolInventory = Object.entries(toolsBySource)
        .map(([src, names]) => `${src}: ${names.join(", ")}`)
        .join("\n");

      let accumulatedText = "";
      let emittedTaskCount = 0;
      let emittedSummary = false;
      const collectedItems: InboxItem[] = [];

      const result = streamText({
        model: getModel(),
        messages: [
          {
            role: "user",
            content:
              `Catch me up on what I missed in ${windowLabel}. Today is ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}. Time window starts at ${windowStartIso}.\n\nHere are the tools available by source:\n\n${toolInventory}\n\nIn your FIRST step, call ALL non-WhoAmI tools in parallel — one call per tool. Do NOT skip any source.\nConstrain every query to ${windowLabel}. Slack's GetMessages takes an oldest_datetime — use "${windowStartIso}". Gmail's ListEmails takes a date_range — pick the closest preset to ${windowLabel}. GitHub/Linear/Calendar tools: filter or sort by recency.\nAfter getting results, classify every item that falls within the window. For each NEEDS_REPLY / NEEDS_FEEDBACK / NEEDS_DECISION / NEEDS_REVIEW item, include a "draftReply" and "draftTarget" so the user can send a response with one click.\nSkip anything older than ${windowStartIso}.\nI need a COMPLETE picture: mentions, assigned work, missed meetings, unread messages, PRs awaiting review.`,
          },
        ],
        tools,
        stopWhen: stepCountIs(30),
        system: planPrompt,
        onStepFinish: ({ toolCalls, toolResults }) => {
          console.log(
            `[plan] Step: ${toolCalls.length} calls, ${toolResults.length} results`
          );

          for (const call of toolCalls) {
            const source = mapToolToSource(call.toolName);
            emit({
              type: "status",
              message: `Calling ${source}: ${call.toolName}...`,
            });
          }

          const toolNameByCallId = new Map(
            toolCalls.map((call) => [call.toolCallId, call.toolName] as const)
          );

          for (let i = 0; i < toolResults.length; i++) {
            const result = toolResults[i];
            const authUrl = extractAuthUrlFromToolOutput(result.output);
            if (authUrl) {
              const resultCallId = (result as { toolCallId?: string }).toolCallId;
              const matchedToolName = resultCallId
                ? toolNameByCallId.get(resultCallId)
                : undefined;
              const fallbackToolName = i < toolCalls.length
                ? toolCalls[i].toolName
                : undefined;
              const toolName = mapToolToSource(matchedToolName ?? fallbackToolName);
              emit({ type: "auth_required", authUrl, toolName });
            }
          }
        },
      });

      const reader = result.textStream.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (value) {
          accumulatedText += value;
          const { tasks, summary, remaining } =
            extractJsonBlocks(accumulatedText);
          accumulatedText = remaining;

          for (const task of tasks) {
            emittedTaskCount++;
            collectedItems.push(task);
            emit({ type: "task", data: task });
            emit({
              type: "status",
              message: `Classified ${emittedTaskCount} item${emittedTaskCount > 1 ? "s" : ""}...`,
            });
          }
          if (summary) {
            emit({ type: "summary", data: summary });
            emittedSummary = true;
          }
        }
      }

      // Final pass on remaining buffer
      if (accumulatedText.length > 0) {
        const { tasks, summary } = extractJsonBlocks(accumulatedText);
        for (const task of tasks) {
          emittedTaskCount++;
          collectedItems.push(task);
          emit({ type: "task", data: task });
        }
        if (summary) {
          emit({ type: "summary", data: summary });
          emittedSummary = true;
        }
      }

      if (!emittedSummary && emittedTaskCount > 0) {
        emit({
          type: "summary",
          data: { total: emittedTaskCount, bySource: {} },
        });
      }

      // Fire-and-forget: index everything the agent classified into Qdrant so
      // the user can semantic-search across all past catch-ups later. Never
      // block the stream — if Qdrant is unavailable, the run still succeeds.
      if (isQdrantConfigured() && collectedItems.length > 0) {
        emit({
          type: "status",
          message: `Indexing ${collectedItems.length} items into Qdrant memory...`,
        });
        upsertItems(user.id, collectedItems)
          .then(() =>
            console.log(`[plan] qdrant: upserted ${collectedItems.length} items for user ${user.id}`)
          )
          .catch((err) => console.error("[plan] qdrant upsert failed:", err));
      }

      emit({ type: "done" });
    } catch (error) {
      console.error("[plan] Error:", error);
      const msg = error instanceof Error ? error.message : "Unknown error";
      const isAuthError =
        msg.includes("401") ||
        msg.includes("Missing Authorization") ||
        msg.includes("Unauthorized");
      emit({
        type: "error",
        message: isAuthError
          ? "Not connected to Arcade. Please connect your Arcade account from the dashboard."
          : msg,
      });
      emit({ type: "done" });
    } finally {
      if (mcpClient) {
        try {
          await mcpClient.close();
        } catch {
          /* ignore */
        }
      }
      try {
        streamController?.close();
      } catch {
        /* ignore */
      }
    }
  })();

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
