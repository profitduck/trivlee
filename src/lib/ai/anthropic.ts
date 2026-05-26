import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { QUESTION_GENERATOR_SYSTEM_PROMPT } from "./prompts";
import { GENERATOR_WEB_SEARCH_TOOL } from "./web-search-config";
import type {
  GeneratedQuestion,
  GenerationRequest,
  GenerationResponse,
  PerQuestionFormat,
  QuestionType,
} from "./types";

const MODEL = "claude-sonnet-4-6";
const MAX_TOKENS = 12000;

const globalForAnthropic = globalThis as unknown as { __anthropic?: Anthropic };

function getClient(): Anthropic {
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

export async function anthropicGenerate(
  req: GenerationRequest
): Promise<GenerationResponse> {
  const client = getClient();
  const start = performance.now();

  const userPayload = JSON.stringify({
    topic: req.topic,
    difficulty: req.difficulty,
    format: req.format,
    count: req.count,
  });

  let response: Anthropic.Message;
  try {
    response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [
        {
          type: "text",
          text: QUESTION_GENERATOR_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [GENERATOR_WEB_SEARCH_TOOL],
      messages: [{ role: "user", content: userPayload }],
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      throw new Error(`Anthropic API error ${err.status}: ${err.message}`);
    }
    throw err;
  }

  // Use the LAST text block — web_search results in interleaved tool_use,
  // tool_result, and intermediate text. The final JSON is the last text emit.
  const textBlocks = response.content.filter(
    (b): b is Anthropic.TextBlock => b.type === "text"
  );
  const textBlock = textBlocks[textBlocks.length - 1];
  if (!textBlock) {
    throw new Error("Anthropic response contained no text block.");
  }

  const parsed = parseStrictJson(textBlock.text);
  const latency_ms = Math.round(performance.now() - start);

  return normalize(parsed, req, latency_ms, response.usage);
}

function parseStrictJson(raw: string): unknown {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        // fall through
      }
    }
    throw new Error(
      `Model returned non-JSON output. First 200 chars: ${raw.slice(0, 200)}`
    );
  }
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

function normalize(
  raw: unknown,
  req: GenerationRequest,
  latency_ms: number,
  usage: Anthropic.Usage
): GenerationResponse {
  if (!raw || typeof raw !== "object") {
    throw new Error("Model response was not a JSON object.");
  }
  const r = raw as Record<string, unknown>;

  const topic_interpretation = typeof r.topic_interpretation === "string"
    ? r.topic_interpretation
    : `Interpreted as: ${req.topic}`;
  const topic_safe = typeof r.topic_safe === "boolean" ? r.topic_safe : true;
  const rejection_reason = typeof r.rejection_reason === "string" && r.rejection_reason.trim().length > 0
    ? r.rejection_reason
    : null;
  const difficulty_delivered = typeof r.difficulty_delivered === "number"
    ? clampDifficulty(r.difficulty_delivered)
    : req.difficulty;
  const knowledge_warning = typeof r.knowledge_warning === "string" && r.knowledge_warning.trim().length > 0
    ? r.knowledge_warning
    : null;

  const rawQuestions = Array.isArray(r.questions) ? r.questions : [];
  const questions: GeneratedQuestion[] = rawQuestions
    .map((q, i) => normalizeQuestion(q as RawQuestion, req, i))
    .filter((q): q is GeneratedQuestion => q !== null);

  return {
    topic_interpretation,
    topic_safe,
    rejection_reason,
    difficulty_delivered,
    knowledge_warning,
    questions,
    meta: {
      generated_by: `${MODEL} (cache hits: ${usage.cache_read_input_tokens ?? 0}/${(usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + usage.input_tokens})`,
      latency_ms,
    },
  };
}

function clampDifficulty(n: number): number {
  return Math.max(1, Math.min(10, Math.round(n)));
}

// Phrases that indicate the model is narrating its own generation process
// (self-correction, uncertainty, meta-commentary) instead of writing a clean
// citation. Any question whose source_hint matches one of these gets dropped —
// the model has self-flagged that the question is unreliable.
const SOURCE_HINT_BLOCKLIST = [
  /corrected/i,
  /\bcorrection\b/i,
  /replacing with/i,
  /\breplaced\b/i,
  /\brevised\b/i,
  /i apologize/i,
  /\bactually,/i,
  /\bwait[\s,—-]/i,
  /\blet me\b/i,
  /\bnot sure\b/i,
  /\buncertain\b/i,
  /\bi think\b/i,
  /\bi believe\b/i,
  /\bi'm not\b/i,
  /verified question/i,
  /this is verified/i,
  // Editorial "notes" — model adding caveats or cross-references means it
  // wasn't grounded in a single canonical source.
  /\bnote:/i,
  /\bnote that\b/i,
  // Multi-source citations (slash between two source descriptions) almost
  // always mean the model is conflating distinct episodes/properties into
  // one question.
  /\s\/\s.*(season|episode|chapter|page|year)/i,
  // Vague aggregations — when the model says it's pulling from "related
  // episodes" or "various" / "multiple", it isn't grounded in one fact.
  /\band related (episodes|chapters|sources|moments|scenes)\b/i,
  /\bvarious episodes\b/i,
  /\bmultiple episodes\b/i,
  /\bthroughout (the )?series\b/i,
  /\bacross the series\b/i,
];

function looksLikeMetaCommentary(hint: string): boolean {
  return SOURCE_HINT_BLOCKLIST.some((re) => re.test(hint));
}

// Patterns that indicate the question presupposes a fact that doesn't exist —
// "What is the name of the spinning top?" → "The top (no specific name given)"
// is a gotcha, not a fair question. If the correct_answer admits the
// presupposition failed, drop the question.
const ANSWER_TRICK_BLOCKLIST = [
  /no\s+(specific|official|real|formal|given|known|particular)?\s*name/i,
  /(doesn'?t|does not|don'?t).{0,20}have\s+(a\s+)?name/i,
  /(isn'?t|is not|never).{0,15}(given\s+a\s+)?name(d)?/i,
  /\bunnamed\b/i,
  /\bn\/a\b/i,
  /\btrick question\b/i,
  /\bnone given\b/i,
  /\bnot specified\b/i,
  /\bnot named\b/i,
  /no\s+canonical\s+(name|answer)/i,
];

function looksLikeTrickAnswer(answer: string): boolean {
  return ANSWER_TRICK_BLOCKLIST.some((re) => re.test(answer));
}

/**
 * Detects multiple-choice questions where the correct answer is conspicuously
 * longer than the distractors — a giveaway pattern we keep seeing where the
 * model breaks structural parallelism in the right answer. Example:
 *   distractors: ["Joe Pesci", "Bob Saget", "Christopher Lloyd"]      (avg 12)
 *   correct: "Danny DeVito plays Frank Reynolds in the FX sitcom..."  (50)
 */
function looksLikeLengthGiveaway(
  correctAnswer: string,
  distractors: string[]
): boolean {
  // Trivia MC always has 3 distractors. Anything less is malformed; skip.
  if (distractors.length < 3) return false;
  const avg =
    distractors.reduce((s, d) => s + d.length, 0) / distractors.length;
  const longest = Math.max(...distractors.map((d) => d.length));
  // Catches both magnitude (1.4x avg) and absolute outlier (10+ chars longer
  // than the longest distractor). Tuned against real giveaway: 52-char
  // correct answer vs 30/38/39 distractors (avg 35.67, longest 39).
  return (
    correctAnswer.length >= avg * 1.4 &&
    correctAnswer.length - longest >= 10
  );
}

function normalizeQuestion(
  q: RawQuestion,
  req: GenerationRequest,
  index: number
): GeneratedQuestion | null {
  if (
    typeof q.question !== "string" ||
    typeof q.correct_answer !== "string" ||
    q.question.trim().length === 0 ||
    q.correct_answer.trim().length === 0
  ) {
    return null;
  }

  // Drop questions where the model narrated its own confusion into source_hint.
  if (typeof q.source_hint === "string" && looksLikeMetaCommentary(q.source_hint)) {
    console.warn(
      `Dropping question with meta-commentary in source_hint: "${q.source_hint.slice(0, 120)}"`
    );
    return null;
  }

  // Drop questions whose correct_answer admits the question presupposed a fact
  // that doesn't exist (gotcha / trick questions).
  if (looksLikeTrickAnswer(q.correct_answer as string)) {
    console.warn(
      `Dropping trick question: "${(q.question as string).slice(0, 80)}" → answer "${(q.correct_answer as string).slice(0, 80)}"`
    );
    return null;
  }

  // Drop MC questions where the correct answer is conspicuously longer than
  // the distractors (structural giveaway — see looksLikeLengthGiveaway docs).
  if (
    Array.isArray(q.distractors) &&
    q.distractors.length >= 2 &&
    looksLikeLengthGiveaway(
      q.correct_answer as string,
      (q.distractors as unknown[]).filter((d): d is string => typeof d === "string")
    )
  ) {
    console.warn(
      `Dropping length-giveaway question: "${(q.question as string).slice(0, 80)}" → answer is much longer than distractors`
    );
    return null;
  }

  const aliases = Array.isArray(q.answer_aliases)
    ? q.answer_aliases.filter((a): a is string => typeof a === "string")
    : [];
  const rawDistractors = Array.isArray(q.distractors)
    ? q.distractors.filter((d): d is string => typeof d === "string")
    : [];

  const requestedFormat = req.format;
  let pqf: PerQuestionFormat;
  if (typeof q.per_question_format === "string" &&
      (q.per_question_format === "multiple_choice" || q.per_question_format === "free_text")) {
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

  return {
    question: q.question.trim(),
    correct_answer: q.correct_answer.trim(),
    answer_aliases: aliases,
    distractors,
    source_hint: typeof q.source_hint === "string" ? q.source_hint : "",
    type,
    per_question_format: pqf,
  };
}
