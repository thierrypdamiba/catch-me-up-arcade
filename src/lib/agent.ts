import { readFileSync } from "fs";
import { join } from "path";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";

// AI-EDIT-SAFE: model selection
// --- CUSTOMIZATION POINT ---
// Set AGENT_MODEL in .env to pick the agent LLM. Provider is auto-detected
// from the model ID prefix:
//   claude-*       → Anthropic
//   gpt-*  |  o1-*  |  o3-*  |  o4-*  → OpenAI
//
// Examples that work out of the box:
//   AGENT_MODEL=gpt-5.4                (default — OpenAI frontier)
//   AGENT_MODEL=gpt-5.4-mini           (faster, cheaper, slightly worse)
//   AGENT_MODEL=claude-sonnet-4-6      (Claude alternative)
//   AGENT_MODEL=claude-opus-4-7        (highest-nuance Claude)
//
// If AGENT_MODEL isn't set, the default is whichever provider's API key
// is present: OPENAI_API_KEY → gpt-5.4, else ANTHROPIC_API_KEY → claude-sonnet-4-6.
export function getModel() {
  const modelId = process.env.AGENT_MODEL?.trim();

  if (modelId) {
    if (/^(gpt-|o\d-)/.test(modelId)) return openai(modelId);
    if (/^claude-/.test(modelId)) return anthropic(modelId);
    // Unrecognized prefix — fall through to key-based default.
  }

  if (process.env.OPENAI_API_KEY) return openai("gpt-5.4");
  if (process.env.ANTHROPIC_API_KEY) return anthropic("claude-sonnet-4-6");
  // Last resort — will error at call time if key is missing.
  return openai("gpt-5.4");
}

// --- CUSTOMIZATION POINT ---
// Edit system-prompt.md (in this directory) to change the agent's purpose.
// AI-EDIT-SAFE: system prompt behavior
export const systemPrompt = readFileSync(join(process.cwd(), "src/lib/system-prompt.md"), "utf-8");
export const planPrompt = readFileSync(join(process.cwd(), "src/lib/plan-prompt.md"), "utf-8");
