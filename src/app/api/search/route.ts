/**
 * Semantic search across everything the catch-me-up agent has ever classified.
 *
 * POST /api/search
 * Body: { query: string, limit?: number }
 *
 * The agent indexes items into Qdrant during /api/plan as a fire-and-forget
 * upsert. This endpoint embeds the user's query and returns the top-K matches
 * scoped to their user_id.
 *
 * This is the "memory" half of the Arcade × Qdrant architecture — Arcade
 * dispatches the tool calls, Qdrant remembers what came back so the user can
 * later ask "what did Jane say about Q2" without another full fetch.
 */

import { getSession } from "@/lib/auth";
import { isQdrantConfigured, searchMemory } from "@/lib/qdrant";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const user = await getSession();
  if (!user) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!isQdrantConfigured()) {
    return Response.json(
      {
        ok: false,
        error:
          "Qdrant is not configured. Set QDRANT_URL (and QDRANT_API_KEY if using cloud) in .env.",
      },
      { status: 503 }
    );
  }

  let payload: { query?: string; limit?: number };
  try {
    payload = (await request.json()) as { query?: string; limit?: number };
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const query = payload.query?.trim() ?? "";
  if (query.length === 0) {
    return Response.json({ ok: false, error: "query is required" }, { status: 400 });
  }
  const limit = Math.min(Math.max(payload.limit ?? 10, 1), 25);

  try {
    const results = await searchMemory(user.id, query, limit);
    return Response.json({ ok: true, results });
  } catch (err) {
    console.error("[search] failed:", err);
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Search failed" },
      { status: 500 }
    );
  }
}
