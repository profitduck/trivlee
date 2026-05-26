import type { FactCandidate, GeneratedQuestion } from "./types";

// ─── Source-hint quality blocklist ─────────────────────────────────────────
// Patterns that signal the model wasn't grounded in a single citeable source.
// In the 3-stage pipeline this is mostly defensive — the validator should
// already have dropped facts with vague sources — but it's a cheap last check.
const SOURCE_HINT_BLOCKLIST: RegExp[] = [
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
  /\bnote:/i,
  /\bnote that\b/i,
  /\s\/\s.*(season|episode|chapter|page|year)/i,
  /\band related (episodes|chapters|sources|moments|scenes)\b/i,
  /\bvarious episodes\b/i,
  /\bmultiple episodes\b/i,
  /\bthroughout (the )?series\b/i,
  /\bacross the series\b/i,
  /\bwidely reported\b/i,
  /\bcommonly cited\b/i,
  /\bgenerally agreed\b/i,
  /\breportedly\b/i,
  /\bapproximately\b/i,
  /\brumored\b/i,
  /\bsources (say|claim|report)\b/i,
];

function looksLikeMetaCommentary(hint: string): boolean {
  return SOURCE_HINT_BLOCKLIST.some((re) => re.test(hint));
}

// ─── Trick-answer blocklist ────────────────────────────────────────────────
// Questions that presuppose a non-existent fact ("real name of unnamed
// character") — the writer's correct_answer admits the question is invalid.
const ANSWER_TRICK_BLOCKLIST: RegExp[] = [
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

// ─── Length-giveaway detector ──────────────────────────────────────────────
// MC questions where the correct answer is conspicuously longer than the
// distractors leak the answer through visual mismatch.
function looksLikeLengthGiveaway(correctAnswer: string, distractors: string[]): boolean {
  if (distractors.length < 3) return false;
  const avg = distractors.reduce((s, d) => s + d.length, 0) / distractors.length;
  const longest = Math.max(...distractors.map((d) => d.length));
  return correctAnswer.length >= avg * 1.4 && correctAnswer.length - longest >= 10;
}

// ─── Answer-in-question detector ───────────────────────────────────────────
// "Which character does Elaine work for at the J. Peterman catalog?" → "J. Peterman"
// The answer is literally a substring of the question; the player just reads it off.
const ANSWER_IN_QUESTION_STOPWORDS = new Set([
  "yes", "no", "true", "false",
  "the", "and", "of", "or", "a", "an",
  "it", "its", "that", "this", "they",
]);

function looksLikeAnswerInQuestion(question: string, answer: string): boolean {
  const q = normalizeText(question);
  const a = normalizeText(answer);
  if (a.length < 3) return false;
  if (ANSWER_IN_QUESTION_STOPWORDS.has(a)) return false;
  return q.includes(a);
}

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function distinctNormalizedValues(values: string[]): string[] {
  return values
    .map((value) => normalizeText(value))
    .filter((value) => value.length > 0);
}

function hasDuplicateOptions(correctAnswer: string, aliases: string[], distractors: string[]): boolean {
  const correctForms = new Set(distinctNormalizedValues([correctAnswer, ...aliases]));
  const distractorForms = distinctNormalizedValues(distractors);
  const allForms = distinctNormalizedValues([correctAnswer, ...distractors]);

  if (new Set(allForms).size !== allForms.length) return true;
  return distractorForms.some((d) =>
    [...correctForms].some((c) => d === c || (c.length >= 3 && d.includes(c)))
  );
}

function looksLikeAnyAnswerInQuestion(question: string, answers: string[]): boolean {
  return answers.some((answer) => looksLikeAnswerInQuestion(question, answer));
}

function hasEmptyOption(values: string[]): boolean {
  return values.some((value) => value.trim().length === 0);
}

function looksLikeYesNoQuestion(question: string, answer: string): boolean {
  const q = normalizeText(question);
  const a = normalizeText(answer);
  if (a !== "yes" && a !== "no" && a !== "true" && a !== "false") return false;
  return /^(is|are|was|were|do|does|did|can|could|should|would|will|has|have|had)\b/.test(q);
}

const ANSWER_GROUNDING_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "onto",
  "a", "an", "of", "in", "on", "to", "by", "as", "at", "or",
]);

function answerTerms(answer: string): string[] {
  return normalizeText(answer)
    .split(" ")
    .filter((token) => token.length >= 3 && !ANSWER_GROUNDING_STOPWORDS.has(token));
}

function appearsGrounded(answer: string, context: string): boolean {
  const normalizedAnswer = normalizeText(answer);
  const compactAnswer = normalizedAnswer.replace(/\s+/g, "");
  const compactContext = context.replace(/\s+/g, "");
  if (compactAnswer.length >= 2 && compactContext.includes(compactAnswer)) return true;
  if (normalizedAnswer.length < 3) return false;
  if (context.includes(normalizedAnswer)) return true;

  const terms = answerTerms(answer);
  if (terms.length === 0) return false;
  return terms.every((term) => context.includes(term));
}

function looksGroundedInFact(q: GeneratedQuestion, fact: FactCandidate): boolean {
  const context = normalizeText(`${fact.claim} ${fact.source}`);
  return [q.correct_answer, ...q.answer_aliases].some((answer) =>
    appearsGrounded(answer, context)
  );
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Runs all post-write deterministic checks. Returns null if the question
 * should be dropped, with a console.warn explaining why. Returns the question
 * unchanged if it passes.
 *
 * Defense-in-depth: even with verified facts, the writer can still construct
 * questions that leak the answer or break MC parallelism. These filters catch
 * the patterns that the prompt forbids but the model occasionally still emits.
 */
export function checkQuestion(q: GeneratedQuestion): {
  ok: boolean;
  reason?: string;
} {
  if (q.question.trim().length === 0 || q.correct_answer.trim().length === 0) {
    return { ok: false, reason: "empty question or answer" };
  }
  if (q.source_hint.trim().length === 0) {
    return { ok: false, reason: "missing source_hint" };
  }
  if (looksLikeMetaCommentary(q.source_hint)) {
    return { ok: false, reason: `meta-commentary in source_hint: "${q.source_hint.slice(0, 80)}"` };
  }
  if (looksLikeTrickAnswer(q.correct_answer)) {
    return { ok: false, reason: `trick answer: "${q.correct_answer.slice(0, 60)}"` };
  }
  if (looksLikeYesNoQuestion(q.question, q.correct_answer)) {
    return { ok: false, reason: "yes/no question" };
  }
  if (looksLikeAnyAnswerInQuestion(q.question, [q.correct_answer, ...q.answer_aliases])) {
    return {
      ok: false,
      reason: `answer "${q.correct_answer.slice(0, 40)}" appears in question text`,
    };
  }
  if (q.per_question_format === "free_text" && q.distractors.length > 0) {
    return { ok: false, reason: "free-text question has distractors" };
  }
  if (q.per_question_format === "multiple_choice" && q.distractors.length !== 3) {
    return { ok: false, reason: `multiple-choice question has ${q.distractors.length} distractors` };
  }
  if (
    q.per_question_format === "multiple_choice" &&
    hasEmptyOption([q.correct_answer, ...q.distractors])
  ) {
    return { ok: false, reason: "multiple-choice question has an empty option" };
  }
  if (
    q.per_question_format === "multiple_choice" &&
    hasDuplicateOptions(q.correct_answer, q.answer_aliases, q.distractors)
  ) {
    return { ok: false, reason: "duplicate or answer-equivalent multiple-choice option" };
  }
  if (
    q.per_question_format === "multiple_choice" &&
    q.distractors.length >= 2 &&
    looksLikeLengthGiveaway(q.correct_answer, q.distractors)
  ) {
    return { ok: false, reason: "length giveaway — correct answer much longer than distractors" };
  }
  return { ok: true };
}

export function checkQuestionAgainstFact(
  q: GeneratedQuestion,
  fact: FactCandidate
): { ok: boolean; reason?: string } {
  if (!looksGroundedInFact(q, fact)) {
    return {
      ok: false,
      reason: `answer "${q.correct_answer.slice(0, 40)}" is not grounded in source fact`,
    };
  }
  return { ok: true };
}

// Re-export internals for unit-test-style usage if needed in the future.
export {
  looksLikeMetaCommentary,
  looksLikeTrickAnswer,
  looksLikeLengthGiveaway,
  looksLikeAnswerInQuestion,
  looksGroundedInFact,
};
