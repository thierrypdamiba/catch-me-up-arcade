/**
 * Embedding wrapper.
 *
 * Default: OpenAI `text-embedding-3-large` (3072-dim).
 * Override via EMBEDDING_MODEL env var. Supported values:
 *   - text-embedding-3-large  (3072 dim, best quality, default)
 *   - text-embedding-3-small  (1536 dim, ~6× cheaper)
 *
 * Switching models after data is already indexed requires re-embedding —
 * Qdrant vectors are tied to the model that produced them. Easiest path:
 * drop the catchmeup_items collection and let the app auto-recreate it
 * on the next catch-up run.
 *
 * These choices are not Arcade's recommendations — Arcade doesn't ship
 * embedding infrastructure. This is the app's call; swap to Voyage /
 * Cohere / a local model by changing this file.
 */

import { openai } from "@ai-sdk/openai";
import { embed, embedMany } from "ai";

const SUPPORTED = {
  "text-embedding-3-large": 3072,
  "text-embedding-3-small": 1536,
} as const;

type EmbeddingModelId = keyof typeof SUPPORTED;

function resolveModel(): EmbeddingModelId {
  const candidate = process.env.EMBEDDING_MODEL?.trim() as EmbeddingModelId | undefined;
  if (candidate && candidate in SUPPORTED) return candidate;
  return "text-embedding-3-large";
}

export const EMBEDDING_MODEL: EmbeddingModelId = resolveModel();
export const EMBEDDING_DIM: number = SUPPORTED[EMBEDDING_MODEL];

const model = openai.embedding(EMBEDDING_MODEL);

export async function embedOne(text: string): Promise<number[]> {
  const trimmed = text.slice(0, 6000);
  const { embedding } = await embed({ model, value: trimmed });
  return embedding;
}

export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const trimmed = texts.map((t) => t.slice(0, 6000));
  const { embeddings } = await embedMany({ model, values: trimmed });
  return embeddings;
}
