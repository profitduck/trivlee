import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient, PIPELINE_MODEL, parseStrictJson } from "./client";
import { VALIDATOR_SYSTEM_PROMPT } from "./prompts";
import { WEB_SEARCH_ALLOWED_DOMAINS } from "./web-search-config";
import type { FactCandidate, ValidatedFact } from "./types";

// The validator gets a bigger search budget than the researcher per-call
// because it's doing one batch pass over many facts. Spread across N facts
// it's still ~0.3 searches/fact on average — Sonnet decides which ones
// warrant the look-up based on confidence.
const VALIDATOR_WEB_SEARCH_TOOL = {
  type: "web_search_20260209" as const,
  name: "web_search" as const,
  allowed_domains: WEB_SEARCH_ALLOWED_DOMAINS,
  max_uses: 8,
};

interface ValidatorOutput {
  validations: { claim: string; verified: boolean; confidence: string; notes: string }[];
}

/**
 * Stage 2 of the pipeline: validates a batch of fact candidates. Returns the
 * same array length, in the same order, with each fact tagged verified+confidence.
 * Callers filter to {verified=true, confidence='high'} before passing to the writer.
 *
 * Cost note: one batched call instead of N parallel calls keeps cost predictable
 * and avoids contention on the web-search rate limit. The model is told to spend
 * its 8 searches on the highest-uncertainty claims.
 */
export async function validateFacts(
  topic: string,
  facts: FactCandidate[]
): Promise<{ validated: ValidatedFact[]; latencyMs: number }> {
  if (facts.length === 0) {
    return { validated: [], latencyMs: 0 };
  }
  const client = getAnthropicClient();
  const start = performance.now();

  const userPayload = JSON.stringify({ topic, facts });

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: PIPELINE_MODEL,
      max_tokens: 8000,
      system: [
        {
          type: "text",
          text: VALIDATOR_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [VALIDATOR_WEB_SEARCH_TOOL],
      messages: [{ role: "user", content: userPayload }],
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      throw new Error(`Validator API error ${err.status}: ${err.message}`);
    }
    throw err;
  }

  const textBlocks = response.content.filter(
    (b): b is Anthropic.TextBlock => b.type === "text"
  );
  const textBlock = textBlocks[textBlocks.length - 1];
  if (!textBlock) {
    // No text block — pass everything through unvalidated (better than nuking
    // the match on a parser hiccup). They'll be marked low-confidence below.
    console.warn("Validator returned no text block; passing facts through unvalidated.");
    return {
      validated: facts.map((f) => ({ ...f, verified: false, confidence: "low", notes: "validator empty response" })),
      latencyMs: Math.round(performance.now() - start),
    };
  }

  let parsed: ValidatorOutput;
  try {
    parsed = parseStrictJson(textBlock.text) as ValidatorOutput;
  } catch (err) {
    console.warn("Validator returned unparseable JSON; passing facts through unvalidated:", err);
    return {
      validated: facts.map((f) => ({ ...f, verified: false, confidence: "low", notes: "validator parse error" })),
      latencyMs: Math.round(performance.now() - start),
    };
  }

  const validations = Array.isArray(parsed?.validations) ? parsed.validations : [];

  // The validator should return one row per fact in the same order. If it
  // drops any, we treat the missing entries as unverified. If it returns more
  // rows than facts, we ignore the extras.
  const validated: ValidatedFact[] = facts.map((fact, i) => {
    const v = validations[i];
    if (!v || typeof v !== "object") {
      return { ...fact, verified: false, confidence: "low", notes: "missing validator entry" };
    }
    const confidence =
      v.confidence === "high" || v.confidence === "medium" || v.confidence === "low"
        ? v.confidence
        : "low";
    return {
      ...fact,
      verified: v.verified === true,
      confidence,
      notes: typeof v.notes === "string" ? v.notes : "",
    };
  });

  return {
    validated,
    latencyMs: Math.round(performance.now() - start),
  };
}
