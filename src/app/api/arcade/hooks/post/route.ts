/**
 * Arcade Contextual Access — post-execution hook.
 *
 * POST /api/arcade/hooks/post
 *
 * Called after a tool executes, before the output is returned to the agent.
 * A production implementation would redact PII from tool outputs here (e.g.
 * scrub SSNs from fetched Gmail bodies before the model sees them). We keep
 * this as a pass-through for the demo to focus attention on the pre-hook,
 * which is where the visible policy denials happen.
 */

import { verifyHookAuth } from "@/lib/hook-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = verifyHookAuth(request);
  if (!auth.ok) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json({ code: "OK" });
}
