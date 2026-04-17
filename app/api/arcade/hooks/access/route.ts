/**
 * Arcade Contextual Access — access hook.
 *
 * POST /api/arcade/hooks/access
 *
 * Called when tools are enumerated for a user. We always return OK for now
 * (every authorized user sees every tool in the gateway). Extend this if you
 * want per-user or per-role tool visibility — a natural next step, especially
 * for multi-tenant deployments.
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
