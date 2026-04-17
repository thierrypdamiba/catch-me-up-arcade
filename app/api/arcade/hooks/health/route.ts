/**
 * Arcade Contextual Access — health hook.
 *
 * GET /api/arcade/hooks/health
 *
 * Arcade polls this to confirm the extension is reachable. Returns the
 * HealthResponse shape from logic_extensions/http/1.0 — status is one of
 * "healthy" | "degraded" | "unhealthy".
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ status: "healthy" });
}
