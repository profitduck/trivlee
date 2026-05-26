import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient, parseStrictJson } from "./client";
import { WRITER_SYSTEM_PROMPT } from "./prompts";
import { checkQuestion } from "./filters";
import type {
  GeneratedQuestion,
  GenerationRequest,
  PerQuestionFormat,
  QuestionType,
  ValidatedFact,
} from "./types";

// Writer runs on Haiku 4.5. By the time facts reach this stage they're
// pre-validated, so the writer doesn't need world knowledge — it only needs
// to shape verified material into well-formed questions. Haiku is 3x cheaper
// than Sonnet and faster; quality is on par for this kind of structured
// transformation task.
const WRITER_MODEL = "claude-haiku-4-5";

interface WriterInput extends GenerationRequest {
  topic_interpretation: string;
  facts: ValidatedFact[];
  /** Difficulty the researcher actually delivered (may be capped). */
  difficulty_delivered: number;
  /** Carried over from research/validate stages — surfaced to the player. */
  knowledge_warning_so_far: string | null;
}

export interface WriterOutput {
  topic_interpretation: string;
  topic_safe: boolean;
  rejection_reason: string | null;
  difficulty_delivered: number;
  knowledge_warning: string | null;
  questions: GeneratedQuestion[];
  meta: { model: string; latency_ms: number };
}

/**
 * Stage 3 of the pipeline: writes trivia questions from a pool of verified
 * facts. No web search — the writer's job is shaping known-good material into
 * great questions, not researching. Lower latency and lower token cost than
 * the old combined generator.
 */
export async function writeQuestions(input: WriterInput): Promise<WriterOutput> {
  const client = getAnthropicClient();
  const start = performance.now();

  const userPayload = JSON.stringify({
    topic: input.topic,
    topic_interpretation: input.topic_interpretation,
    difficulty: input.difficulty_delivered,
    format: input.format,
    count: input.count,
    facts: input.facts.map((f) => ({
      claim: f.claim,
      source: f.source,
      suggested_difficulty: f.suggested_difficulty,
      sub_topic: f.sub_topic,
    })),
  });

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: WRITER_MODEL,
      max_tokens: 10000,
      system: [
        {
          type: "text",
          text: WRITER_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      // No tools — writer doesn't need web search; all facts are pre-validated.
      messages: [{ role: "user", content: userPayload }],
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      throw new Error(`Writer API error ${err.status}: ${err.message}`);
    }
    throw err;
  }

  const textBlocks = response.content.filter(
    (b): b is Anthropic.TextBlock => b.type === "text"
  );
  const textBlock = textBlocks[textBlocks.length - 1];
  if (!textBlock) {
    throw new Error("Writer response contained no text block.");
  }

  const parsed = parseStrictJson(textBlock.text);
  const latency_ms = Math.round(performance.now() - start);
  return normalizeWriter(parsed, input, latency_ms);
}

function normalizeWriter(
  raw: unknown,
  input: WriterInput,
  latency_ms: number
): WriterOutput {
  if (!raw || typeof raw !== "object") {
    throw new Error("Writer response was not a JSON object.");
  }
  const r = raw as Record<string, unknown>;

  const topic_interpretation =
    typeof r.topic_interpretation === "string"
      ? r.topic_interpretation
      : input.topic_interpretation;
  const topic_safe = typeof r.topic_safe === "boolean" ? r.topic_safe : true;
  const rejection_reason =
    typeof r.rejection_reason === "string" && r.rejection_reason.trim().length > 0
      ? r.rejection_reason
      : null;
  const difficulty_delivered =
    typeof r.difficulty_delivered === "number"
      ? clampDifficulty(r.difficulty_delivered)
      : input.difficulty_delivered;

  let writerWarning =
    typeof r.knowledge_warning === "string" && r.knowledge_warning.trim().length > 0
      ? r.knowledge_warning
      : null;

  const rawQuestions = Array.isArray(r.questions) ? r.questions : [];
  const questions: GeneratedQuestion[] = rawQuestions
    .map((q, i) => normalizeQuestion(q, input, i))
    .filter((q): q is GeneratedQuestion => q !== null);

  // Combine warnings: research/validate stage's note + writer's note.
  const combinedWarning = [input.knowledge_warning_so_far, writerWarning]
    .filter((s): s is string => typeof s === "string" && s.length > 0)
    .join(" ");
  writerWarning = combinedWarning.length > 0 ? combinedWarning : null;

  return {
    topic_interpretation,
    topic_safe,
    rejection_reason,
    difficulty_delivered,
    knowledge_warning: writerWarning,
    questions,
    meta: { model: WRITER_MODEL, latency_ms },
  };
}

type RawQuestion = {
  question?: unknown;
  correct_answer?: unknown;
  answer_aliases?: unknown;
  distractors?: unknown;
  source_hint?: unknown;
  type?: unknown;
  per_question_format?: unknown;
};

function normalizeQuestion(
  raw: unknown,
  input: WriterInput,
  index: number
): GeneratedQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const q = raw as RawQuestion;
  if (
    typeof q.question !== "string" ||
    typeof q.correct_answer !== "string" ||
    q.question.trim().length === 0 ||
    q.correct_answer.trim().length === 0
  ) {
    return null;
  }

  const aliases = Array.isArray(q.answer_aliases)
    ? q.answer_aliases.filter((a): a is string => typeof a === "string")
    : [];
  const rawDistractors = Array.isArray(q.distractors)
    ? q.distractors.filter((d): d is string => typeof d === "string")
    : [];

  const requestedFormat = input.format;
  let pqf: PerQuestionFormat;
  if (
    typeof q.per_question_format === "string" &&
    (q.per_question_format === "multiple_choice" || q.per_question_format === "free_text")
  ) {
    pqf = q.per_question_format;
  } else if (requestedFormat === "multiple_choice") {
    pqf = "multiple_choice";
  } else if (requestedFormat === "free_text") {
    pqf = "free_text";
  } else {
    pqf = index % 2 === 0 ? "multiple_choice" : "free_text";
  }

  const distractors = pqf === "free_text" ? [] : rawDistractors.slice(0, 3);

  const type: QuestionType =
    typeof q.type === "string" &&
    (q.type === "factual" || q.type === "quote" || q.type === "identification" || q.type === "numeric")
      ? q.type
      : "factual";

  const candidate: GeneratedQuestion = {
    question: q.question.trim(),
    correct_answer: q.correct_answer.trim(),
    answer_aliases: aliases,
    distractors,
    source_hint: typeof q.source_hint === "string" ? q.source_hint : "",
    type,
    per_question_format: pqf,
  };

  // Deterministic post-write filters — drop questions that leak the answer,
  // emit trick-answer copy, or break MC parallelism. These should be rare in
  // the 3-stage pipeline (facts are pre-verified) but the writer can still
  // shape them badly.
  const check = checkQuestion(candidate);
  if (!check.ok) {
    console.warn(`[writer] dropping: ${check.reason} — "${candidate.question.slice(0, 80)}"`);
    return null;
  }

  return candidate;
}

function clampDifficulty(n: number): number {
  return Math.max(1, Math.min(10, Math.round(n)));
}
