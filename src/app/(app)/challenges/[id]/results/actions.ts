"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  getBankIdForQuestion,
  incrementBankReport,
  recomputeBankQuality,
} from "@/lib/ai/question-bank";

export async function reportQuestion(
  questionId: string,
  challengeId: string,
  reason: string
) {
  const user = await requireUser();
  const trimmed = reason.trim();
  if (trimmed.length < 5) {
    return { error: "Please give a brief reason (5+ characters)." };
  }

  // Detect whether this is a NEW report (not just an updated reason).
  // We use the unique (question_id, reporter_id) key — first insert returns
  // the row, second insert is a no-op via DO NOTHING and returns nothing.
  const { rows } = await query<{ id: string }>(
    `INSERT INTO question_reports (question_id, reporter_id, reason)
     VALUES ($1, $2, $3)
     ON CONFLICT (question_id, reporter_id) DO NOTHING
     RETURNING id`,
    [questionId, user.id, trimmed]
  );
  const isNewReport = rows.length > 0;

  // If they're updating an existing report (e.g. clarifying the reason), don't
  // double-count it on the bank.
  if (!isNewReport) {
    await query(
      `UPDATE question_reports
          SET reason = $3, status = 'open', created_at = now()
        WHERE question_id = $1 AND reporter_id = $2`,
      [questionId, user.id, trimmed]
    );
  } else {
    const bankId = await getBankIdForQuestion(questionId);
    await incrementBankReport(bankId);
  }

  revalidatePath(`/challenges/${challengeId}/results`);
  return { ok: true };
}

export async function rateQuestion(
  questionId: string,
  challengeId: string,
  qualityRating: number | null,
  difficultyRating: number | null
) {
  const user = await requireUser();

  if (qualityRating !== null && (qualityRating < 1 || qualityRating > 5)) {
    return { error: "Quality must be 1-5." };
  }
  if (difficultyRating !== null && (difficultyRating < 1 || difficultyRating > 10)) {
    return { error: "Difficulty must be 1-10." };
  }

  await query(
    `INSERT INTO question_ratings (question_id, user_id, quality_rating, difficulty_rating)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (question_id, user_id)
       DO UPDATE SET
         quality_rating = COALESCE(EXCLUDED.quality_rating, question_ratings.quality_rating),
         difficulty_rating = COALESCE(EXCLUDED.difficulty_rating, question_ratings.difficulty_rating)`,
    [questionId, user.id, qualityRating, difficultyRating]
  );

  // Recompute the parent bank entry's quality_score (if this question came
  // from the bank). Aggregates all ratings on this bank question across all
  // matches it's appeared in.
  if (qualityRating !== null) {
    const bankId = await getBankIdForQuestion(questionId);
    await recomputeBankQuality(bankId);
  }

  revalidatePath(`/challenges/${challengeId}/results`);
  return { ok: true };
}
