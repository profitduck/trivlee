import type { GeneratedQuestion } from "./types";

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
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const q = normalize(question);
  const a = normalize(answer);
  if (a.length < 3) return false;
  if (ANSWER_IN_QUESTION_STOPWORDS.has(a)) return false;
  return q.includes(a);
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
  if (looksLikeMetaCommentary(q.source_hint)) {
    return { ok: false, reason: `meta-commentary in source_hint: "${q.source_hint.slice(0, 80)}"` };
  }
  if (looksLikeTrickAnswer(q.correct_answer)) {
    return { ok: false, reason: `trick answer: "${q.correct_answer.slice(0, 60)}"` };
  }
  if (
    q.per_question_format === "multiple_choice" &&
    q.distractors.length >= 2 &&
    looksLikeLengthGiveaway(q.correct_answer, q.distractors)
  ) {
    return { ok: false, reason: "length giveaway — correct answer much longer than distractors" };
  }
  if (looksLikeAnswerInQuestion(q.question, q.correct_answer)) {
    return {
      ok: false,
      reason: `answer "${q.correct_answer.slice(0, 40)}" appears in question text`,
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
};
