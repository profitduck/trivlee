import "server-only";
import { query } from "@/lib/db";
import type { GeneratedQuestion, PerQuestionFormat } from "./types";

export interface BankDraw {
  questions: GeneratedQuestion[];
  bankIds: string[]; // parallel to questions; for backref into the questions row
}

/**
 * Draw up to `count` non-hidden, non-reported questions from the bank matching
 * the cache key. Prefers higher quality_score, then more recently used, then
 * least-recently-seen-by-this-user. Multi-topic strings won't match (their
 * topic_normalized is the whole comma-joined string and unlikely to be cached).
 *
 * `format` is the per-question format we want — pass "multiple_choice" or
 * "free_text" for single-format requests. For "mixed" requests, draw from each
 * format proportionally — call this function twice.
 */
export async function drawFromBank(
  topicNormalized: string,
  difficulty: number,
  format: PerQuestionFormat,
  count: number,
  userId: string
): Promise<BankDraw> {
  if (count <= 0) return { questions: [], bankIds: [] };

  const { rows } = await query<{
    id: string;
    question_text: string;
    correct_answer: string;
    answer_aliases: string[];
    distractors: string[];
    source_hint: string | null;
    type: string;
    per_question_format: string;
  }>(
    `SELECT id, question_text, correct_answer, answer_aliases, distractors,
            source_hint, type::text AS type, per_question_format::text AS per_question_format
       FROM question_bank
      WHERE topic_normalized = $1
        AND difficulty = $2
        AND per_question_format = $3::per_question_format
        AND hidden = false
        AND report_count < 2
        -- Don't show the user a question they've already answered in another match.
        AND NOT EXISTS (
          SELECT 1
            FROM attempts a
            JOIN questions q ON q.id = a.question_id
           WHERE a.user_id = $5
             AND q.bank_question_id = question_bank.id
        )
        -- Also skip questions they've VIEWED but not answered (bailed before
        -- submitting). The play page upserts question_views on every render,
        -- so this catches the abandoned-match edge case.
        AND NOT EXISTS (
          SELECT 1
            FROM question_views v
            JOIN questions q ON q.id = v.question_id
           WHERE v.user_id = $5
             AND q.bank_question_id = question_bank.id
        )
      ORDER BY quality_score DESC NULLS LAST, times_used DESC, created_at DESC
      LIMIT $4`,
    [topicNormalized, difficulty, format, count, userId]
  );

  const questions: GeneratedQuestion[] = rows.map((r) => ({
    question: r.question_text,
    correct_answer: r.correct_answer,
    answer_aliases: r.answer_aliases ?? [],
    distractors: r.distractors ?? [],
    source_hint: r.source_hint ?? "",
    type: (r.type as GeneratedQuestion["type"]) ?? "factual",
    per_question_format: r.per_question_format as PerQuestionFormat,
  }));
  return {
    questions,
    bankIds: rows.map((r) => r.id),
  };
}

/**
 * After a user rates a question, recompute the parent bank entry's
 * quality_score (avg of all ratings 1-5) and rating_count. No-op if the
 * question wasn't drawn from the bank.
 */
export async function recomputeBankQuality(bankQuestionId: string | null): Promise<void> {
  if (!bankQuestionId) return;
  await query(
    `UPDATE question_bank SET
       quality_score = COALESCE(
         (SELECT AVG(qr.quality_rating)::numeric(3,2)
            FROM question_ratings qr
            JOIN questions q ON q.id = qr.question_id
           WHERE q.bank_question_id = $1
             AND qr.quality_rating IS NOT NULL),
         quality_score
       ),
       rating_count = (
         SELECT COUNT(*)::int
           FROM question_ratings qr
           JOIN questions q ON q.id = qr.question_id
          WHERE q.bank_question_id = $1
            AND qr.quality_rating IS NOT NULL
       )
     WHERE id = $1`,
    [bankQuestionId]
  );
}

const REPORT_HIDE_THRESHOLD = 2;

/**
 * After a user reports a question, increment the bank entry's report_count.
 * Auto-hides the bank entry once report_count crosses the threshold so
 * subsequent matches won't draw it.
 */
export async function incrementBankReport(bankQuestionId: string | null): Promise<void> {
  if (!bankQuestionId) return;
  await query(
    `UPDATE question_bank SET
       report_count = report_count + 1,
       hidden = (report_count + 1 >= $2)
     WHERE id = $1`,
    [bankQuestionId, REPORT_HIDE_THRESHOLD]
  );
}

/**
 * Look up the bank_question_id (if any) for a given questions.id.
 * Returns null for questions that weren't drawn from or seeded into the bank.
 */
export async function getBankIdForQuestion(questionId: string): Promise<string | null> {
  const { rows } = await query<{ bank_question_id: string | null }>(
    `SELECT bank_question_id FROM questions WHERE id = $1`,
    [questionId]
  );
  return rows[0]?.bank_question_id ?? null;
}

/**
 * Increment times_used for the bank rows we just drew from. Called when the
 * questions actually get attached to a match.
 */
export async function markBankUse(bankIds: string[]): Promise<void> {
  if (bankIds.length === 0) return;
  await query(
    `UPDATE question_bank SET times_used = times_used + 1 WHERE id = ANY($1)`,
    [bankIds]
  );
}

/**
 * Append newly-generated questions to the bank so future matches can draw
 * them. Idempotent by (topic_normalized, difficulty, question_text) unique key.
 * Returns the bank IDs in the same order as the input (NULL for any row that
 * was a duplicate and didn't insert).
 */
export async function addToBank(
  topicNormalized: string,
  difficulty: number,
  questions: GeneratedQuestion[]
): Promise<(string | null)[]> {
  if (questions.length === 0) return [];
  const out: (string | null)[] = [];
  for (const q of questions) {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO question_bank
         (topic_normalized, difficulty, per_question_format, question_text,
          correct_answer, answer_aliases, distractors, source_hint, type)
       VALUES ($1, $2, $3::per_question_format, $4, $5, $6, $7, $8, $9::question_type)
       ON CONFLICT (topic_normalized, difficulty, question_text) DO NOTHING
       RETURNING id`,
      [
        topicNormalized,
        difficulty,
        q.per_question_format,
        q.question,
        q.correct_answer,
        JSON.stringify(q.answer_aliases),
        JSON.stringify(q.distractors),
        q.source_hint,
        q.type,
      ]
    );
    out.push(rows[0]?.id ?? null);
  }
  return out;
}
