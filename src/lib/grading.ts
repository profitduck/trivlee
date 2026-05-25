import "server-only";
import { llmJudge } from "./ai/judge";

export type GradeMethod = "mc" | "exact" | "fuzzy" | "llm-judge" | "substring-fallback";

export interface GradeResult {
  score: number; // 0..1
  isCorrect: boolean;
  method: GradeMethod;
  reason?: string;
}

export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

function fuzzyMatches(user: string, target: string): boolean {
  const norm = normalizeAnswer(target);
  if (norm.length === 0) return false;
  const dist = levenshtein(user, norm);
  // Length-scaled threshold. ~12% of length, min 1, max 3.
  const threshold = Math.min(3, Math.max(1, Math.floor(norm.length * 0.12)));
  return dist <= threshold;
}

export function gradeMultipleChoice(
  userAnswer: string,
  correctAnswer: string
): GradeResult {
  const correct = userAnswer === correctAnswer;
  return {
    score: correct ? 1 : 0,
    isCorrect: correct,
    method: "mc",
  };
}

interface FreeTextContext {
  question: string;
  correctAnswer: string;
  aliases: string[];
  userAnswer: string;
}

/**
 * Three-tier free-text grader:
 *   1. Exact match after normalization (cheap, certain).
 *   2. Fuzzy match via Levenshtein (handles typos).
 *   3. LLM judge via Haiku for partial credit on semantically-close answers.
 *      Falls back to a substring heuristic when no Anthropic key is available
 *      (so dev with USE_MOCK_AI=true still grades sanely).
 */
export async function gradeFreeText(ctx: FreeTextContext): Promise<GradeResult> {
  const normUser = normalizeAnswer(ctx.userAnswer);
  if (!normUser) {
    return { score: 0, isCorrect: false, method: "exact" };
  }

  const candidates = [ctx.correctAnswer, ...ctx.aliases];

  // Tier 1: exact match after normalize.
  for (const c of candidates) {
    if (normalizeAnswer(c) === normUser) {
      return { score: 1, isCorrect: true, method: "exact" };
    }
  }

  // Tier 2: fuzzy match (Levenshtein).
  for (const c of candidates) {
    if (fuzzyMatches(normUser, c)) {
      return { score: 1, isCorrect: true, method: "fuzzy" };
    }
  }

  // Tier 3: LLM judge.
  const judged = await llmJudge({
    question: ctx.question,
    correctAnswer: ctx.correctAnswer,
    aliases: ctx.aliases,
    userAnswer: ctx.userAnswer,
  });
  if (judged) {
    return {
      score: judged.score,
      isCorrect: judged.isCorrect,
      method: "llm-judge",
      reason: judged.reason || undefined,
    };
  }

  // Tier 3 fallback (no LLM available): substring heuristic.
  for (const c of candidates) {
    const normC = normalizeAnswer(c);
    if (!normC) continue;
    if (normC.includes(normUser) && normUser.length >= 3) {
      return {
        score: 0.5,
        isCorrect: false,
        method: "substring-fallback",
        reason: `Partial: your answer is a substring of the expected ("${c}").`,
      };
    }
    if (normUser.includes(normC) && normC.length >= 3) {
      return {
        score: 0.6,
        isCorrect: false,
        method: "substring-fallback",
        reason: `Partial: expected ("${c}") is a substring of your answer.`,
      };
    }
  }

  return { score: 0, isCorrect: false, method: "exact" };
}
