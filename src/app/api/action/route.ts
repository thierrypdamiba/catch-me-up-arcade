/**
 * Action API Route — Execute a draft reply.
 *
 * POST /api/action
 * Body: { target: DraftTarget, body: string }
 *
 * Resolves the DraftTarget to an Arcade MCP gateway tool and executes it with
 * the provided body. The gateway must include the corresponding write tool:
 *
 *   gmail_reply          → Gmail_SendEmail
 *   slack_message        → Slack_SendMessage (or Slack_SendMessageToChannel)
 *   github_issue_comment → Github_CreateIssueComment
 *   github_pr_comment    → Github_CreateIssueComment (PR comments are issue comments)
 *   linear_comment       → Linear_CreateComment
 *
 * If the tool isn't available in the gateway, returns 404 with a hint.
 */

import { getSession } from "@/lib/auth";
import { getArcadeMCPClient } from "@/lib/arcade";
import { runPolicies } from "@/lib/policies";
import type { DraftTarget } from "@/types/inbox";

export const maxDuration = 60;

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;

function buildToolCall(target: DraftTarget, body: string): ToolCall | { error: string } {
  switch (target.type) {
    case "gmail_reply": {
      // Gmail_SendEmail schema requires { recipient, subject, body }.
      // Prefer the LLM-populated recipientEmail; fall back to the first
      // email address we can find in the draft body.
      const recipient = target.recipientEmail?.trim() || body.match(EMAIL_RE)?.[0];
      if (!recipient) {
        return {
          error:
            "Gmail send needs a recipient email. Add it to the draftTarget or include an address in the draft.",
        };
      }
      const subject =
        target.subject?.trim() ||
        (target.recipientName ? `Re: (to ${target.recipientName})` : "Re: your message");
      return {
        name: "Gmail_SendEmail",
        args: { recipient, subject, body },
      };
    }
    case "slack_message": {
      if (!target.channelId) return { error: "slack_message requires channelId" };
      return {
        name: "Slack_SendMessage",
        args: {
          channel: target.channelId,
          text: body,
          ...(target.ts ? { thread_ts: target.ts } : {}),
        },
      };
    }
    case "github_issue_comment":
    case "github_pr_comment": {
      if (!target.repo || !target.issueNumber) {
        return { error: `${target.type} requires repo and issueNumber` };
      }
      const [owner, repoName] = target.repo.split("/");
      if (!owner || !repoName) return { error: "repo must be owner/name" };
      return {
        name: "Github_CreateIssueComment",
        args: {
          owner,
          repo: repoName,
          issue_number: Number(target.issueNumber),
          body,
        },
      };
    }
    case "linear_comment": {
      if (!target.issueNumber) return { error: "linear_comment requires issueNumber" };
      return {
        name: "Linear_CreateComment",
        args: {
          issueId: target.issueNumber,
          body,
        },
      };
    }
    default: {
      return { error: `Unknown draft target type: ${(target as DraftTarget).type}` };
    }
  }
}

function findTool(
  tools: Record<string, { execute?: (args: Record<string, unknown>, opts: unknown) => unknown }>,
  preferredName: string
): { name: string; execute: (args: Record<string, unknown>, opts: unknown) => unknown } | null {
  const normalize = (s: string) => s.replace(/[._]/g, "_").toLowerCase();
  const target = normalize(preferredName);
  for (const [name, tool] of Object.entries(tools)) {
    if (normalize(name) === target && tool.execute) {
      return { name, execute: tool.execute };
    }
  }
  const [namespace, method] = preferredName.split("_");
  if (namespace && method) {
    const fallback = `${namespace.toLowerCase()}.${method.toLowerCase()}`;
    for (const [name, tool] of Object.entries(tools)) {
      if (normalize(name).replace(/_/g, ".") === fallback && tool.execute) {
        return { name, execute: tool.execute };
      }
    }
  }
  return null;
}

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let payload: { target?: DraftTarget; body?: string; mfaApproved?: boolean };
  try {
    payload = (await request.json()) as {
      target?: DraftTarget;
      body?: string;
      mfaApproved?: boolean;
    };
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const { target, body, mfaApproved } = payload;
  if (!target || typeof body !== "string" || body.trim().length === 0) {
    return Response.json(
      { ok: false, error: "target and non-empty body are required" },
      { status: 400 }
    );
  }

  const resolved = buildToolCall(target, body);
  if ("error" in resolved) {
    return Response.json({ ok: false, error: resolved.error }, { status: 400 });
  }

  // Contextual Access: run the policy chain before dispatching to Arcade.
  // In production this enforcement lives inside Arcade's gateway; we surface it
  // in-app here so the demo can show the deny/step-up UX end-to-end.
  const policy = runPolicies(
    { tool: resolved.name, target, body },
    { mfaApproved: mfaApproved === true }
  );
  if (!policy.allow) {
    return Response.json(
      {
        ok: false,
        denied: true,
        action: policy.action,
        policy: policy.policy,
        reason: policy.reason,
        matched: policy.matched,
      },
      { status: 200 }
    );
  }

  let mcpClient: Awaited<ReturnType<typeof getArcadeMCPClient>> | null = null;
  try {
    mcpClient = await getArcadeMCPClient();
    const tools = (await mcpClient.tools()) as Record<
      string,
      { execute?: (args: Record<string, unknown>, opts: unknown) => unknown }
    >;
    const tool = findTool(tools, resolved.name);
    if (!tool) {
      return Response.json(
        {
          ok: false,
          error: `Tool "${resolved.name}" not available in your Arcade Gateway. Add it at https://app.arcade.dev/mcp-gateways.`,
        },
        { status: 404 }
      );
    }
    const result = (await tool.execute(resolved.args, {})) as {
      isError?: boolean;
      content?: { type: string; text: string }[];
      structuredContent?: {
        authorization_url?: string;
        message?: string;
        [k: string]: unknown;
      };
    } | null;

    // Arcade surfaces auth-required responses via structuredContent.authorization_url
    // (canonical path), with a human-readable JSON also stuffed into content[0].text.
    // Check the structured field first, then fall back to parsing the text blob.
    const asText = result?.content?.map((c) => c?.text).filter(Boolean).join("\n") ?? "";
    let authUrl: string | undefined = result?.structuredContent?.authorization_url;
    if (!authUrl && asText) {
      try {
        const parsed = JSON.parse(asText) as { authorization_url?: string };
        authUrl = parsed.authorization_url;
      } catch {
        /* not JSON — ignore */
      }
    }

    if (result?.isError) {
      console.error(`[action] ${tool.name} isError:`, asText.slice(0, 500));
      return Response.json(
        { ok: false, tool: tool.name, error: asText.slice(0, 500) || "Tool reported failure" },
        { status: 200 }
      );
    }
    if (authUrl) {
      const message =
        (result?.structuredContent?.message as string | undefined) ??
        "Arcade needs additional authorization for this tool.";
      console.log(`[action] ${tool.name} needs auth: ${authUrl.slice(0, 80)}...`);
      return Response.json(
        { ok: false, needsAuth: authUrl, tool: tool.name, message },
        { status: 200 }
      );
    }
    console.log(`[action] ${tool.name} OK — args: ${JSON.stringify(resolved.args).slice(0, 200)}`);
    return Response.json({ ok: true, tool: tool.name, result });
  } catch (err) {
    console.error("[action] error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ ok: false, error: msg }, { status: 500 });
  } finally {
    if (mcpClient) {
      try {
        await mcpClient.close();
      } catch {
        /* ignore */
      }
    }
  }
}
