import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient, PIPELINE_MODEL, parseStrictJson } from "./client";
import { RESEARCHER_SYSTEM_PROMPT } from "./prompts";
import { researcherSearchTool } from "./web-search-config";
import type {
  FactCandidate,
  GenerationRequest,
  ResearchResponse,
} from "./types";

// We ask for ~2.5x the question count so the validator has slack to drop facts
// without leaving the writer empty-handed.
const FACT_OVERSAMPLE_RATIO = 2.5;
const MAX_FACT_TARGET = 35;

export function computeFactTarget(questionCount: number): number {
  return Math.min(MAX_FACT_TARGET, Math.ceil(questionCount * FACT_OVERSAMPLE_RATIO));
}

/**
 * Stage 1 of the pipeline: produces a list of citeable fact candidates. The
 * researcher's only job is gathering source-able claims — no questions, no
 * distractors, no question shaping. Web search budget is concentrated here
 * because this is where ground-truth lookup adds the most value.
 */
export async function researchFacts(
  req: GenerationRequest
): Promise<ResearchResponse> {
  const client = getAnthropicClient();
  const start = performance.now();

  const factTarget = computeFactTarget(req.count);
  const userPayload = JSON.stringify({
    topic: req.topic,
    difficulty: req.difficulty,
    count: factTarget,
  });

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: PIPELINE_MODEL,
      max_tokens: 12000,
      system: [
        {
          type: "text",
          text: RESEARCHER_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [researcherSearchTool(req.difficulty)],
      messages: [{ role: "user", content: userPayload }],
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      throw new Error(`Researcher API error ${err.status}: ${err.message}`);
    }
    throw err;
  }

  // Web search interleaves tool_use / tool_result / text blocks — the JSON
  // payload is the last text block.
  const textBlocks = response.content.filter(
    (b): b is Anthropic.TextBlock => b.type === "text"
  );
  const textBlock = textBlocks[textBlocks.length - 1];
  if (!textBlock) {
    throw new Error("Researcher response contained no text block.");
  }

  const parsed = parseStrictJson(textBlock.text);
  const latency_ms = Math.round(performance.now() - start);
  return normalizeResearch(parsed, req, latency_ms);
}

function normalizeResearch(
  raw: unknown,
  req: GenerationRequest,
  latency_ms: number
): ResearchResponse {
  if (!raw || typeof raw !== "object") {
    throw new Error("Researcher response was not a JSON object.");
  }
  const r = raw as Record<string, unknown>;

  // Compact format uses short field names. Fall back to long names so we don't
  // break if the model emits the older format during a partial rollout.
  const topic_interpretation =
    typeof r.interp === "string"
      ? r.interp
      : typeof r.topic_interpretation === "string"
        ? r.topic_interpretation
        : `Interpreted as: ${req.topic}`;
  const topic_safe =
    typeof r.safe === "boolean"
      ? r.safe
      : typeof r.topic_safe === "boolean"
        ? r.topic_safe
        : true;
  const rejStr = typeof r.rej === "string" ? r.rej : typeof r.rejection_reason === "string" ? r.rejection_reason : null;
  const rejection_reason = rejStr && rejStr.trim().length > 0 ? rejStr : null;
  const diffNum =
    typeof r.diff === "number"
      ? r.diff
      : typeof r.difficulty_delivered === "number"
        ? r.difficulty_delivered
        : req.difficulty;
  const difficulty_delivered = clampDifficulty(diffNum);
  const warnStr = typeof r.warn === "string" ? r.warn : typeof r.knowledge_warning === "string" ? r.knowledge_warning : null;
  const knowledge_warning = warnStr && warnStr.trim().length > 0 ? warnStr : null;

  const rawFacts = Array.isArray(r.facts) ? r.facts : [];
  const facts: FactCandidate[] = rawFacts
    .map((f) => normalizeFact(f))
    .filter((f): f is FactCandidate => f !== null);

  return {
    topic_interpretation,
    topic_safe,
    rejection_reason,
    difficulty_delivered,
    knowledge_warning,
    facts,
    meta: {
      model: PIPELINE_MODEL,
      latency_ms,
    },
  };
}

function normalizeFact(raw: unknown): FactCandidate | null {
  if (!raw || typeof raw !== "object") return null;
  const f = raw as Record<string, unknown>;
  // Compact format: {c, s, d, t}. Long format: {claim, source, suggested_difficulty, sub_topic}.
  const claim = typeof f.c === "string" ? f.c : typeof f.claim === "string" ? f.claim : null;
  const source = typeof f.s === "string" ? f.s : typeof f.source === "string" ? f.source : null;
  if (!claim || claim.trim().length === 0) return null;
  if (!source || source.trim().length === 0) return null;
  const diffRaw =
    typeof f.d === "number" ? f.d : typeof f.suggested_difficulty === "number" ? f.suggested_difficulty : 5;
  const subTopic = typeof f.t === "string" ? f.t : typeof f.sub_topic === "string" ? f.sub_topic : undefined;
  return {
    claim: claim.trim(),
    source: source.trim(),
    suggested_difficulty: clampDifficulty(diffRaw),
    sub_topic: subTopic && subTopic.trim().length > 0 ? subTopic.trim() : undefined,
  };
}

function clampDifficulty(n: number): number {
  return Math.max(1, Math.min(10, Math.round(n)));
}
