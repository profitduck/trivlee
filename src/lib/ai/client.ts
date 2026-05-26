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
    // Pull the largest balanced {...} or [...] block.
    const firstBrace = trimmed.search(/[{\[]/);
    const lastBrace = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      try {
        return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
      } catch {
        // fall through
      }
    }
    throw new Error(
      `Model returned non-JSON output. First 200 chars: ${raw.slice(0, 200)}`
    );
  }
}
