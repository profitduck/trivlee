import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getAnthropicClient, PIPELINE_MODEL, parseStrictJson } from "./client";
import { checkQuestion } from "./filters";
import type {
  GeneratedQuestion,
  GenerationRequest,
  GenerationResponse,
  PerQuestionFormat,
  QuestionType,
} from "./types";

const FAST_GENERATOR_TIMEOUT_MS = 35_000;
const FAST_REPAIR_TIMEOUT_MS = 20_000;
const FAST_FALLBACK_MODEL = "claude-haiku-4-5";

const FAST_GENERATOR_PROMPT = `You are the fast trivia generator for Trivlee.

You do NOT have web search. Your job is to produce stable, well-known, citeable trivia only. If you are not highly confident, return fewer questions, lower difficulty, or refuse with a short reason. Never fill quota with guesses.

# Input
JSON:
{
  "topic": "string",
  "difficulty": 1-10,
  "format": "multiple_choice" | "free_text" | "mixed",
  "count": integer
}

# Rules
- Prefer facts that are stable, canonical, and easy to cite: official titles, credited people, episode/film/book facts, dates that are not disputed.
- Avoid current-date/current-office/current-record questions.
- Avoid subjective "best/most popular" questions.
- Avoid trick questions and yes/no questions.
- If topic or difficulty is too obscure, cap difficulty downward and set warn.
- For broad catchphrase, greeting, slogan, quote, recurring line, or dialogue-fragment prompts, use free text. Multiple-choice dialogue questions often have several technically correct options.
- For MC, all four options must be mutually exclusive, same category, and similarly shaped. If any distractor could also be correct, use free text.
- source hints must be concrete: episode/film/book title, year, official/work reference, or common reference name. No "various sources" or hedging.
- Include aliases for free-text grading: alternate spellings, initials, surnames, shortened titles.

# Output
Return ONLY compact JSON:
{
  "interp": "one sentence topic interpretation",
  "safe": true,
  "rej": null,
  "diff": 1-10,
  "warn": "string | null",
  "qs": [
    {
      "q": "question text",
      "a": "correct answer",
      "al": ["aliases"],
      "d": ["distractor1", "distractor2", "distractor3"],
      "src": "source hint",
      "t": "factual" | "quote" | "identification" | "numeric",
      "f": "mc" | "ft"
    }
  ]
}

If unsafe, vague, or insufficiently known, set rej and qs:[].`;

interface CompactFastOutput {
  interp?: string;
  topic_interpretation?: string;
  safe?: boolean;
  topic_safe?: boolean;
  rej?: string | null;
  rejection_reason?: string | null;
  diff?: number;
  difficulty_delivered?: number;
  warn?: string | null;
  knowledge_warning?: string | null;
  qs?: unknown[];
  questions?: unknown[];
}

export async function generateFastQuestions(
  req: GenerationRequest
): Promise<GenerationResponse> {
  const start = performance.now();
  const first = await callFastGenerator(req, Math.min(20, Math.ceil(req.count * 1.5)), FAST_GENERATOR_TIMEOUT_MS);
  let normalized = normalizeFastOutput(first.raw, req, first.model, Math.round(performance.now() - start));

  if (normalized.questions.length < req.count && normalized.topic_safe && !normalized.rejection_reason) {
    const existing = normalized.questions.map((q) => `${q.question} => ${q.correct_answer}`);
    const repairReq = {
      ...req,
      topic: `${req.topic}\nAvoid duplicating these already accepted questions:\n${existing.join("\n")}`,
      count: req.count - normalized.questions.length,
    };
    try {
      const repairRaw = await callFastGenerator(repairReq, repairReq.count, FAST_REPAIR_TIMEOUT_MS);
      const repair = normalizeFastOutput(repairRaw.raw, req, repairRaw.model, Math.round(performance.now() - start));
      normalized = {
        ...normalized,
        questions: dedupeQuestions([...normalized.questions, ...repair.questions]).slice(0, req.count),
        knowledge_warning: combineWarnings(normalized.knowledge_warning, repair.knowledge_warning),
        meta: {
          ...normalized.meta,
          latency_ms: Math.round(performance.now() - start),
          repair_write_ms: repair.meta.latency_ms,
        },
      };
    } catch (err) {
      console.warn("[fast-generator] repair pass failed:", err);
    }
  }

  if (normalized.questions.length < req.count && normalized.topic_safe && !normalized.rejection_reason) {
    const note = `Delivered ${normalized.questions.length} of ${req.count} requested to avoid slow or uncertain generation.`;
    normalized.knowledge_warning = combineWarnings(normalized.knowledge_warning, note);
  }

  normalized.questions = normalized.questions.slice(0, req.count);
  normalized.meta.latency_ms = Math.round(performance.now() - start);
  return normalized;
}

async function callFastGenerator(
  req: GenerationRequest,
  count: number,
  timeout: number
): Promise<{ raw: unknown; model: string }> {
  try {
    return await callFastGeneratorWithModel(req, count, timeout, PIPELINE_MODEL);
  } catch (err) {
    console.warn("[fast-generator] Sonnet direct generation failed; retrying with Haiku:", err);
    return callFastGeneratorWithModel(req, count, Math.min(timeout, 18_000), FAST_FALLBACK_MODEL);
  }
}

async function callFastGeneratorWithModel(
  req: GenerationRequest,
  count: number,
  timeout: number,
  model: string
): Promise<{ raw: unknown; model: string }> {
  const client = getAnthropicClient();
  const response = await client.messages.create(
    {
      model,
      max_tokens: Math.min(7_000, Math.max(3_500, 900 + count * 450)),
      system: [
        {
          type: "text",
          text: FAST_GENERATOR_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: JSON.stringify({
            topic: req.topic,
            difficulty: req.difficulty,
            format: req.format,
            count,
          }),
        },
      ],
    },
    { maxRetries: 0, timeout }
  );

  const textBlocks = response.content.filter(
    (b): b is Anthropic.TextBlock => b.type === "text"
  );
  const textBlock = textBlocks[textBlocks.length - 1];
  if (!textBlock) throw new Error("Fast generator response contained no text block.");
  return { raw: parseStrictJson(textBlock.text), model };
}

function normalizeFastOutput(
  raw: unknown,
  req: GenerationRequest,
  model: string,
  latencyMs: number
): GenerationResponse {
  if (!raw || typeof raw !== "object") {
    throw new Error("Fast generator response was not a JSON object.");
  }
  const r = raw as CompactFastOutput;
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
  const rejectionRaw = typeof r.rej === "string"
    ? r.rej
    : typeof r.rejection_reason === "string"
      ? r.rejection_reason
      : null;
  const rejection_reason = rejectionRaw && rejectionRaw.trim().length > 0 ? rejectionRaw.trim() : null;
  const difficulty_delivered = clampDifficulty(
    typeof r.diff === "number"
      ? r.diff
      : typeof r.difficulty_delivered === "number"
        ? r.difficulty_delivered
        : req.difficulty
  );
  const warningRaw = typeof r.warn === "string"
    ? r.warn
    : typeof r.knowledge_warning === "string"
      ? r.knowledge_warning
      : null;
  const knowledge_warning = warningRaw && warningRaw.trim().length > 0 ? warningRaw.trim() : null;

  const rawQuestions = Array.isArray(r.qs)
    ? r.qs
    : Array.isArray(r.questions)
      ? r.questions
      : [];
  const questions = dedupeQuestions(
    rawQuestions
      .map((q, i) => normalizeQuestion(q, req, i))
      .filter((q): q is GeneratedQuestion => q !== null)
  );

  return {
    topic_interpretation,
    topic_safe,
    rejection_reason,
    difficulty_delivered,
    knowledge_warning,
    questions,
    meta: {
      generated_by: `${model} (fast direct, no web search)`,
      latency_ms: latencyMs,
      facts_researched: 0,
      facts_validated: 0,
    },
  };
}

function normalizeQuestion(
  raw: unknown,
  req: GenerationRequest,
  index: number
): GeneratedQuestion | null {
  if (!raw || typeof raw !== "object") return null;
  const q = raw as Record<string, unknown>;
  const question = typeof q.q === "string" ? q.q : typeof q.question === "string" ? q.question : null;
  const answer = typeof q.a === "string" ? q.a : typeof q.correct_answer === "string" ? q.correct_answer : null;
  if (!question || !answer || question.trim().length === 0 || answer.trim().length === 0) return null;

  const aliases = Array.isArray(q.al)
    ? q.al.filter((a): a is string => typeof a === "string")
    : Array.isArray(q.answer_aliases)
      ? q.answer_aliases.filter((a): a is string => typeof a === "string")
      : [];
  const rawDistractors = Array.isArray(q.d)
    ? q.d.filter((d): d is string => typeof d === "string")
    : Array.isArray(q.distractors)
      ? q.distractors.filter((d): d is string => typeof d === "string")
      : [];
  const sourceHint =
    typeof q.src === "string" ? q.src : typeof q.source_hint === "string" ? q.source_hint : "";

  const fRaw = typeof q.f === "string" ? q.f : typeof q.per_question_format === "string" ? q.per_question_format : null;
  let perQuestionFormat: PerQuestionFormat;
  if (fRaw === "mc" || fRaw === "multiple_choice") {
    perQuestionFormat = "multiple_choice";
  } else if (fRaw === "ft" || fRaw === "free_text") {
    perQuestionFormat = "free_text";
  } else if (req.format === "multiple_choice") {
    perQuestionFormat = "multiple_choice";
  } else if (req.format === "free_text") {
    perQuestionFormat = "free_text";
  } else {
    perQuestionFormat = index % 2 === 0 ? "multiple_choice" : "free_text";
  }

  const tRaw = typeof q.t === "string" ? q.t : typeof q.type === "string" ? q.type : "factual";
  const type: QuestionType =
    tRaw === "quote" || tRaw === "identification" || tRaw === "numeric" || tRaw === "factual"
      ? tRaw
      : "factual";

  const candidate: GeneratedQuestion = {
    question: question.trim(),
    correct_answer: answer.trim(),
    answer_aliases: aliases.map((a) => a.trim()).filter(Boolean),
    distractors: perQuestionFormat === "multiple_choice" ? rawDistractors.slice(0, 3) : [],
    source_hint: sourceHint.trim(),
    type,
    per_question_format: perQuestionFormat,
  };

  const check = checkQuestion(candidate);
  if (!check.ok) {
    console.warn(`[fast-generator] dropping: ${check.reason} — "${candidate.question.slice(0, 80)}"`);
    return null;
  }
  return candidate;
}

function dedupeQuestions(questions: GeneratedQuestion[]): GeneratedQuestion[] {
  const seen = new Set<string>();
  const out: GeneratedQuestion[] = [];
  for (const q of questions) {
    const key = `${q.question}|${q.correct_answer}`
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

function combineWarnings(...warnings: (string | null | undefined)[]): string | null {
  const unique = [...new Set(warnings.filter((w): w is string => !!w && w.trim().length > 0))];
  return unique.length > 0 ? unique.join(" ") : null;
}

function clampDifficulty(n: number): number {
  return Math.max(1, Math.min(10, Math.round(n)));
}
