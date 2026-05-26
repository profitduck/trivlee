import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Single Anthropic client cached on globalThis so the SDK's connection pool
// survives hot module replacement during dev. Each pipeline stage uses this
// same client — they differ only in prompt and tool config.
const globalForAnthropic = globalThis as unknown as { __anthropic?: Anthropic };

export function getAnthropicClient(): Anthropic {
  if (!globalForAnthropic.__anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Either provide it or set USE_MOCK_AI=true."
      );
    }
    globalForAnthropic.__anthropic = new Anthropic({ apiKey });
  }
  return globalForAnthropic.__anthropic;
}

export const PIPELINE_MODEL = "claude-sonnet-4-6";

/**
 * Strips a markdown fence and pulls the last JSON object out of a model
 * response. The pipeline stages all return JSON; web_search-using stages
 * may emit intermediate text blocks before the final JSON.
 */
export function parseStrictJson(raw: string): unknown {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    // The model sometimes prefixes with a sentence even when told not to.
    // Pull the first balanced {...} or [...] block so trailing commentary
    // after valid JSON doesn't poison the parse.
    const balanced = firstBalancedJsonBlock(trimmed);
    if (balanced) {
      try {
        return JSON.parse(balanced);
      } catch {
        // fall through
      }
    }
    throw new Error(
      `Model returned non-JSON output. First 200 chars: ${raw.slice(0, 200)}`
    );
  }
}

function firstBalancedJsonBlock(text: string): string | null {
  const start = text.search(/[{\[]/);
  if (start < 0) return null;
  const stack: string[] = [];
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      stack.push(ch);
      continue;
    }
    if (ch === "}" || ch === "]") {
      const open = stack.pop();
      if ((ch === "}" && open !== "{") || (ch === "]" && open !== "[")) return null;
      if (stack.length === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}
