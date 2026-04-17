/**
 * Qdrant memory layer for the catch-me-up agent.
 *
 * Every item the agent classifies (Gmail thread, Slack message, GitHub
 * notification, Linear issue, Calendar event) is embedded and upserted here
 * keyed by user_id. Later the user can search across everything the agent
 * has ever seen — cross-source, semantic, no refetch from the provider.
 *
 * This is the "memory" to Arcade's "hands": Arcade dispatches authed tool
 * calls, Qdrant remembers what came back. Together they make a real agent
 * platform instead of a stateless triage run.
 */

import { QdrantClient } from "@qdrant/js-client-rest";
import { EMBEDDING_DIM, embedBatch, embedOne } from "@/lib/embed";
import type { InboxItem } from "@/types/inbox";

export const QDRANT_COLLECTION =
  process.env.QDRANT_COLLECTION?.trim() || "catchmeup_items";

let cachedClient: QdrantClient | null = null;
let ensurePromise: Promise<void> | null = null;

export function isQdrantConfigured(): boolean {
  return Boolean(process.env.QDRANT_URL?.trim());
}

export function getQdrantClient(): QdrantClient | null {
  if (!isQdrantConfigured()) return null;
  if (cachedClient) return cachedClient;
  cachedClient = new QdrantClient({
    url: process.env.QDRANT_URL!.trim(),
    apiKey: process.env.QDRANT_API_KEY?.trim() || undefined,
  });
  return cachedClient;
}

/**
 * Create the collection if it doesn't exist. Runs at most once per process.
 */
export async function ensureCollection(): Promise<void> {
  if (ensurePromise) return ensurePromise;
  const client = getQdrantClient();
  if (!client) return;
  ensurePromise = (async () => {
    try {
      const exists = await client.collectionExists(QDRANT_COLLECTION);
      if (exists.exists) return;
      await client.createCollection(QDRANT_COLLECTION, {
        vectors: { size: EMBEDDING_DIM, distance: "Cosine" },
      });
      console.log(`[qdrant] created collection ${QDRANT_COLLECTION}`);
      // Index the user_id field for fast per-user filtering.
      await client.createPayloadIndex(QDRANT_COLLECTION, {
        field_name: "user_id",
        field_schema: "keyword",
      });
    } catch (err) {
      console.error("[qdrant] ensureCollection failed:", err);
      ensurePromise = null;
      throw err;
    }
  })();
  return ensurePromise;
}

/**
 * Deterministic point ID so re-classifying the same thread updates in place
 * instead of creating duplicates. We hash user_id + source + item.id.
 */
function pointId(userId: string, item: InboxItem): string {
  const raw = `${userId}::${item.source}::${item.id}`;
  // FNV-1a 32-bit hash → UUID-ish for Qdrant (which wants UUIDs or uints).
  // Good enough for demo: collision risk is negligible in a single user's data.
  let h1 = 0xcbf29ce4,
    h2 = 0x84222325,
    h3 = 0xc4ceb9fe,
    h4 = 0x7b1c71d4;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x01000193) >>> 0;
    h3 = Math.imul(h3 ^ c, 0x01000193) >>> 0;
    h4 = Math.imul(h4 ^ c, 0x01000193) >>> 0;
  }
  const hex = (n: number) => n.toString(16).padStart(8, "0");
  return `${hex(h1)}-${hex(h2).slice(0, 4)}-${hex(h2).slice(4)}-${hex(h3).slice(0, 4)}-${hex(h3).slice(4)}${hex(h4)}`;
}

function itemToEmbedText(item: InboxItem): string {
  const parts = [
    `[${item.source}]`,
    item.sourceDetail ?? "",
    item.summary,
    item.why ?? "",
    item.participants?.map((p) => p.name).join(", ") ?? "",
  ].filter(Boolean);
  return parts.join("\n");
}

export async function upsertItems(userId: string, items: InboxItem[]): Promise<void> {
  if (items.length === 0) return;
  const client = getQdrantClient();
  if (!client) return;
  await ensureCollection();

  const texts = items.map(itemToEmbedText);
  const vectors = await embedBatch(texts);

  const points = items.map((item, i) => ({
    id: pointId(userId, item),
    vector: vectors[i],
    payload: {
      user_id: userId,
      source: item.source,
      summary: item.summary,
      source_detail: item.sourceDetail ?? null,
      category: item.category,
      priority: item.priority,
      url: item.url ?? null,
      participants: item.participants ?? [],
      fetched_at: new Date().toISOString(),
      item_id: item.id,
    },
  }));

  try {
    await client.upsert(QDRANT_COLLECTION, { wait: false, points });
  } catch (err) {
    console.error("[qdrant] upsert failed:", err);
  }
}

export interface SearchResult {
  score: number;
  source: string;
  sourceDetail: string | null;
  summary: string;
  category?: string;
  priority?: string;
  url: string | null;
  fetchedAt: string;
}

export async function searchMemory(
  userId: string,
  query: string,
  limit: number = 10
): Promise<SearchResult[]> {
  const client = getQdrantClient();
  if (!client) return [];
  await ensureCollection();

  const vector = await embedOne(query);
  const result = await client.search(QDRANT_COLLECTION, {
    vector,
    limit,
    filter: {
      must: [{ key: "user_id", match: { value: userId } }],
    },
    with_payload: true,
  });

  return result.map((hit) => {
    const p = (hit.payload ?? {}) as Record<string, unknown>;
    return {
      score: hit.score,
      source: (p.source as string) ?? "other",
      sourceDetail: (p.source_detail as string | null) ?? null,
      summary: (p.summary as string) ?? "",
      category: p.category as string | undefined,
      priority: p.priority as string | undefined,
      url: (p.url as string | null) ?? null,
      fetchedAt: (p.fetched_at as string) ?? "",
    };
  });
}

export async function countForUser(userId: string): Promise<number> {
  const client = getQdrantClient();
  if (!client) return 0;
  try {
    await ensureCollection();
    const result = await client.count(QDRANT_COLLECTION, {
      filter: { must: [{ key: "user_id", match: { value: userId } }] },
      exact: false,
    });
    return result.count;
  } catch {
    return 0;
  }
}
