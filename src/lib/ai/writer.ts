import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient, parseStrictJson } from "./client";
import { WRITER_SYSTEM_PROMPT } from "./prompts";
import { checkQuestion } from "./filters";
import type {
  FactCandidate,
  GeneratedQuestion,
  GenerationRequest,
  PerQuestionFormat,
  QuestionType,
} from "./types";

// Writer runs on Haiku 4.5. By the time facts reach this stage they've either
// been validated or are about to be validated in parallel — the writer doesn't
// need world knowledge, only the ability to shape verified material into
// well-formed questions. Haiku is 3x cheaper than Sonnet and faster; quality
// is on par for this kind of structured transformation task.
const WRITER_MODEL = "claude-haiku-4-5";

/**
 * Speculative-writer extension to GeneratedQuestion: tags which input fact
 * the question is based on. After the validator finishes, the pipeline filters
 * out questions whose source fact failed validation. The fact_index field is
 * internal and stripped before the question hits the DB.
 */
export interface SpeculativeQuestion extends GeneratedQuestion {
  fact_index: number;
}

interface WriterInput extends GenerationRequest {
  topic_interpretation: string;
  /**
   * Pool of researched facts. In speculative mode these are NOT yet validated —
   * the writer must include `fact_index` on each question so the orchestrator
   * can drop questions whose source fact gets rejected by the validator.
   */
  facts: FactCandidate[];
  difficulty_delivered: number;
  knowledge_warning_so_far: string | null;
  /** Tells the writer to oversample (counts × 1.3) so post-validator drops don't shortfall. */
  oversample: boolean;
}

export interface WriterOutput {
  topic_interpretation: string;
  topic_safe: boolean;
  rejection_reason: string | null;
  difficulty_delivered: number;
  knowledge_warning: string | null;
  /** Questions with fact_index tags — pipeline strips fact_index after filtering. */
  questions: SpeculativeQuestion[];
  meta: { model: string; latency_ms: number };
}

/**
 * Stage 3 of the pipeline: writes trivia questions from a pool of (possibly
 * unverified) facts. Each question is tagged with `fact_index` so the
 * pipeline can drop questions backed by rejected facts after the parallel
 * validator finishes.
 *
 * No web search — facts are already gathered upstream. Just shaping.
 */
export async function writeQuestions(input: WriterInput): Promise<WriterOutput> {
  const client = getAnthropicClient();
  const start = performance.now();

  // Speculative mode oversamples so the validator's drops still leave us with
  // enough questions. ~30% extra gives margin for a typical 15-25% drop rate.
  const writerCount = input.oversample
    ? Math.min(25, Math.ceil(input.count * 1.3))
    : input.count;

  // Compact format matching the researcher/validator stages.
  const compactFacts = input.facts.map((f) => ({
    c: f.claim,
    s: f.source,
    d: f.suggested_difficulty,
    ...(f.sub_topic ? { t: f.sub_topic } : {}),
  }));
  const userPayload = JSON.stringify({
    topic: input.topic,
    interp: input.topic_interpretation,
    diff: input.difficulty_delivered,
    format: input.format,
    count: writerCount,
    facts: compactFacts,
  });

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: WRITER_MODEL,
      max_tokens: 8000,
      system: [
        {
          type: "text",
          text: WRITER_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      // No tools — writer doesn't need web search.
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

  // Tolerate both compact ({interp, safe, ...}) and long ({topic_interpretation, ...})
  // formats during partial rollouts.
  const topic_interpretation =
    typeof r.interp === "string"
      ? r.interp
      : typeof r.topic_interpretation === "string"
        ? r.topic_interpretation
        : input.topic_interpretation;
  const topic_safe =
    typeof r.safe === "boolean"
      ? r.safe
      : typeof r.topic_safe === "boolean"
        ? r.topic_safe
        : true;
  const rejStr = typeof r.rej === "string" ? r.rej : typeof r.rejection_reason === "string" ? r.rejection_reason : null;
  const rejection_reason = rejStr && rejStr.trim().length > 0 ? rejStr : null;
  const diffRaw =
    typeof r.diff === "number"
      ? r.diff
      : typeof r.difficulty_delivered === "number"
        ? r.difficulty_delivered
        : input.difficulty_delivered;
  const difficulty_delivered = clampDifficulty(diffRaw);
  const warnStr = typeof r.warn === "string" ? r.warn : typeof r.knowledge_warning === "string" ? r.knowledge_warning : null;
  let writerWarning = warnStr && warnStr.trim().length > 0 ? warnStr : null;

  const rawQuestions = Array.isArray(r.qs)
    ? r.qs
    : Array.isArray(r.questions)
      ? r.questions
      : [];
  const questions: SpeculativeQuestion[] = rawQuestions
    .map((q, i) => normalizeQuestion(q, input, i))
    .filter((q): q is SpeculativeQuestion => q !== null);

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

function normalizeQuestion(
  raw: unknown,
  input: WriterInput,
  index: number
): SpeculativeQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const q = raw as Record<string, unknown>;

  // Tolerate compact ({q, a, al, d, src, t, f, fi}) and long form during rollout.
  const questionText = typeof q.q === "string" ? q.q : typeof q.question === "string" ? q.question : null;
  const correctAnswer = typeof q.a === "string" ? q.a : typeof q.correct_answer === "string" ? q.correct_answer : null;
  if (!questionText || !correctAnswer || questionText.trim().length === 0 || correctAnswer.trim().length === 0) {
    return null;
  }

  const aliases = Array.isArray(q.al)
    ? (q.al as unknown[]).filter((a): a is string => typeof a === "string")
    : Array.isArray(q.answer_aliases)
      ? (q.answer_aliases as unknown[]).filter((a): a is string => typeof a === "string")
      : [];
  const rawDistractors = Array.isArray(q.d)
    ? (q.d as unknown[]).filter((d): d is string => typeof d === "string")
    : Array.isArray(q.distractors)
      ? (q.distractors as unknown[]).filter((d): d is string => typeof d === "string")
      : [];
  const sourceHint =
    typeof q.src === "string" ? q.src : typeof q.source_hint === "string" ? q.source_hint : "";

  // Compact format uses "mc" / "ft"; tolerate the long form too.
  let pqf: PerQuestionFormat;
  const fRaw = typeof q.f === "string" ? q.f : typeof q.per_question_format === "string" ? q.per_question_format : null;
  if (fRaw === "mc" || fRaw === "multiple_choice") {
    pqf = "multiple_choice";
  } else if (fRaw === "ft" || fRaw === "free_text") {
    pqf = "free_text";
  } else if (input.format === "multiple_choice") {
    pqf = "multiple_choice";
  } else if (input.format === "free_text") {
    pqf = "free_text";
  } else {
    pqf = index % 2 === 0 ? "multiple_choice" : "free_text";
  }

  const distractors = pqf === "free_text" ? [] : rawDistractors.slice(0, 3);

  const tRaw = typeof q.t === "string" ? q.t : typeof q.type === "string" ? q.type : "factual";
  const type: QuestionType =
    tRaw === "factual" || tRaw === "quote" || tRaw === "identification" || tRaw === "numeric"
      ? tRaw
      : "factual";

  // fact_index is required for speculative-mode filtering. If the writer
  // omits it, the orchestrator will drop the question (we can't safely
  // include a question whose source fact we can't identify).
  const factIdxRaw =
    typeof q.fi === "number"
      ? q.fi
      : typeof q.fact_index === "number"
        ? q.fact_index
        : -1;
  const fact_index = Number.isInteger(factIdxRaw) ? Math.floor(factIdxRaw) : -1;

  const candidate: SpeculativeQuestion = {
    question: questionText.trim(),
    correct_answer: correctAnswer.trim(),
    answer_aliases: aliases,
    distractors,
    source_hint: sourceHint,
    type,
    per_question_format: pqf,
    fact_index,
  };

  // Deterministic post-write filters — drop questions that leak the answer,
  // emit trick-answer copy, or break MC parallelism.
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
