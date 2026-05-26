import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient, PIPELINE_MODEL, parseStrictJson } from "./client";
import { VALIDATOR_SYSTEM_PROMPT } from "./prompts";
import { validatorSearchTool } from "./web-search-config";
import type { FactCandidate, ValidatedFact } from "./types";

const VALIDATOR_SEARCH_TIMEOUT_MS = 50_000;
const VALIDATOR_FALLBACK_TIMEOUT_MS = 25_000;

/**
 * Validator output (compact format). Each entry references its source fact
 * by index, so the model doesn't waste tokens echoing the claim text back.
 */
interface CompactValidatorOutput {
  v?: { i?: number; ok?: boolean; conf?: string; n?: string }[];
}

/**
 * Stage 2 of the pipeline: validates a batch of fact candidates. Returns the
 * same array length, in the same order, with each fact tagged verified+confidence.
 * Callers filter to {verified=true, confidence='high'} before passing to the writer.
 *
 * Cost note: one batched call instead of N parallel calls keeps cost predictable
 * and avoids contention on the web-search rate limit. Search budget is
 * difficulty-aware and intentionally small; the validator should triage the
 * highest-risk claims instead of exhaustively searching every fact.
 *
 * Format: input facts are sent in compact form ({c, s, d, t}). Output uses
 * index-referenced verdicts ({i, ok, conf}) instead of echoing each claim back —
 * this saves output tokens and wall time on each batch.
 */
export async function validateFacts(
  topic: string,
  facts: FactCandidate[],
  difficulty: number
): Promise<{ validated: ValidatedFact[]; latencyMs: number }> {
  if (facts.length === 0) {
    return { validated: [], latencyMs: 0 };
  }
  const client = getAnthropicClient();
  const start = performance.now();

  // Send facts in the same compact format the researcher emits — saves ~30%
  // of input tokens vs. the long field-name version.
  const compactFacts = facts.map((f) => ({
    c: f.claim,
    s: f.source,
    d: f.suggested_difficulty,
    ...(f.sub_topic ? { t: f.sub_topic } : {}),
  }));
  const userPayload = JSON.stringify({ topic, facts: compactFacts });

  let response: Anthropic.Message;
  try {
    response = await createValidatorMessage(client, userPayload, difficulty, true);
  } catch (err) {
    console.warn(
      "[validator] web-search request failed or timed out; retrying without search:",
      summarizeAnthropicError(err)
    );
    try {
      response = await createValidatorMessage(client, userPayload, difficulty, false);
    } catch (fallbackErr) {
      if (fallbackErr instanceof Anthropic.APIError) {
        throw new Error(`Validator API error ${fallbackErr.status}: ${fallbackErr.message}`);
      }
      throw fallbackErr;
    }
  }

  const textBlocks = response.content.filter(
    (b): b is Anthropic.TextBlock => b.type === "text"
  );
  const textBlock = textBlocks[textBlocks.length - 1];
  if (!textBlock) {
    console.warn("Validator returned no text block; passing facts through unvalidated.");
    return {
      validated: facts.map((f) => ({ ...f, verified: false, confidence: "low", notes: "validator empty response" })),
      latencyMs: Math.round(performance.now() - start),
    };
  }

  let parsed: CompactValidatorOutput;
  try {
    parsed = parseStrictJson(textBlock.text) as CompactValidatorOutput;
  } catch (err) {
    console.warn("Validator returned unparseable JSON; passing facts through unvalidated:", err);
    return {
      validated: facts.map((f) => ({ ...f, verified: false, confidence: "low", notes: "validator parse error" })),
      latencyMs: Math.round(performance.now() - start),
    };
  }

  const rawValidations = Array.isArray(parsed?.v) ? parsed.v : [];

  // Build a lookup by index so we don't depend on the model preserving order.
  // If a fact is missing from the output, default to unverified.
  const byIndex = new Map<number, { ok: boolean; confidence: "high" | "medium" | "low"; notes: string }>();
  for (const v of rawValidations) {
    if (!v || typeof v !== "object" || typeof v.i !== "number") continue;
    const idx = Math.floor(v.i);
    if (idx < 0 || idx >= facts.length) continue;
    const conf =
      v.conf === "h" ? "high" :
      v.conf === "m" ? "medium" :
      v.conf === "l" ? "low" :
      v.conf === "high" || v.conf === "medium" || v.conf === "low" ? v.conf :
      "low";
    byIndex.set(idx, {
      ok: v.ok === true,
      confidence: conf,
      notes: typeof v.n === "string" ? v.n : "",
    });
  }

  const validated: ValidatedFact[] = facts.map((fact, i) => {
    const entry = byIndex.get(i);
    if (!entry) {
      return { ...fact, verified: false, confidence: "low", notes: "missing validator entry" };
    }
    return {
      ...fact,
      verified: entry.ok,
      confidence: entry.confidence,
      notes: entry.notes,
    };
  });

  return {
    validated,
    latencyMs: Math.round(performance.now() - start),
  };
}

async function createValidatorMessage(
  client: Anthropic,
  userPayload: string,
  difficulty: number,
  withSearch: boolean
): Promise<Anthropic.Message> {
  return client.messages.create(
    {
      model: PIPELINE_MODEL,
      max_tokens: 3000,
      system: [
        {
          type: "text",
          text: VALIDATOR_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      ...(withSearch ? { tools: [validatorSearchTool(difficulty)] } : {}),
      messages: [{ role: "user", content: userPayload }],
    },
    {
      maxRetries: 0,
      timeout: withSearch ? VALIDATOR_SEARCH_TIMEOUT_MS : VALIDATOR_FALLBACK_TIMEOUT_MS,
    }
  );
}

function summarizeAnthropicError(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    return `${err.status}: ${err.message}`;
  }
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}
