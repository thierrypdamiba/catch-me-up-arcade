/**
 * Arcade Contextual Access — pre-execution hook.
 *
 * POST /api/arcade/hooks/pre
 *
 * Arcade calls this endpoint before every tool execution. We translate the
 * PreHookRequest into our PolicyContext, run the policy chain, and return
 * OK | CHECK_FAILED per Arcade's webhook contract. When we deny, error_message
 * is prefixed with the policy ID so the agent can surface it cleanly.
 *
 * Configure the extension in the Arcade dashboard to point at this URL and
 * set ARCADE_HOOKS_TOKEN in your .env to whatever bearer token you registered.
 */

import { verifyHookAuth } from "@/lib/hook-auth";
import { contextFromToolCall, runPolicies } from "@/lib/policies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PreHookRequest {
  execution_id: string;
  tool: { name: string; toolkit: string; version: string };
  inputs: Record<string, unknown>;
  context?: {
    user_id?: string;
    metadata?: Record<string, unknown>;
  };
}

export async function POST(request: Request) {
  const auth = verifyHookAuth(request);
  if (!auth.ok) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PreHookRequest;
  try {
    body = (await request.json()) as PreHookRequest;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.tool?.name) {
    return Response.json({ error: "Missing tool.name" }, { status: 400 });
  }

  const ctx = contextFromToolCall({
    toolName: body.tool.name,
    toolkit: body.tool.toolkit,
    inputs: body.inputs ?? {},
  });

  if (!ctx) {
    // Tool is not something our policy set covers — allow through.
    return Response.json({ code: "OK" });
  }

  // Step-up MFA is intentionally skipped at the gateway because Arcade's
  // webhook contract has no native way to pause the pipeline and wait for an
  // out-of-band approval. We enforce MFA in the client (app/api/action/route.ts)
  // before the tool is ever invoked. The gateway here is defense-in-depth for
  // the two policies that map cleanly to a synchronous allow/deny decision.
  const result = runPolicies(ctx, { skipMfa: true });

  if (result.allow) {
    return Response.json({ code: "OK" });
  }

  const errorMessage = `[${result.policy}] ${result.reason}`;
  console.log(
    `[arcade-hooks/pre] DENY execution_id=${body.execution_id} tool=${body.tool.name} policy=${result.policy}`
  );
  return Response.json({
    code: "CHECK_FAILED",
    error_message: errorMessage,
  });
}
