"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";

/**
 * Admin-only match deletion. Cascades clean up participants, attempts,
 * results, and questions. Used from /admin/matches; unlike the host-side
 * deleteMatchAction, this stays on the admin matches list instead of
 * redirecting to the user's dashboard.
 */
export async function deleteMatchAsAdmin(
  matchId: string
): Promise<{ ok: true } | { error: string }> {
  await requireAdmin();
  const { rowCount } = await query(`DELETE FROM challenges WHERE id = $1`, [matchId]);
  if (rowCount === 0) {
    return { error: "Match not found (already deleted?)." };
  }
  revalidatePath("/admin/matches");
  return { ok: true };
}

/**
 * Toggle a bank question's hidden flag. Hiding excludes it from future
 * drawFromBank calls without deleting the row, so any existing matches
 * that already drew from it still work. Use this to purge bad questions
 * from the bank without breaking historical play data.
 */
export async function toggleBankHidden(
  bankQuestionId: string,
  hidden: boolean
): Promise<{ ok: true } | { error: string }> {
  await requireAdmin();
  const { rowCount } = await query(
    `UPDATE question_bank SET hidden = $2 WHERE id = $1`,
    [bankQuestionId, hidden]
  );
  if (rowCount === 0) {
    return { error: "Bank question not found." };
  }
  revalidatePath("/admin/matches");
  return { ok: true };
}

/**
 * Hard-delete a bank question. Use sparingly — the bank row is what other
 * matches' questions point to via bank_question_id, so deleting it leaves
 * orphan FK references (which is allowed by the ON DELETE SET NULL on the
 * questions.bank_question_id constraint). The questions themselves stay
 * intact; they just lose the link back to the bank.
 *
 * In most cases, toggleBankHidden(true) is the better choice.
 */
export async function deleteBankQuestion(
  bankQuestionId: string
): Promise<{ ok: true } | { error: string }> {
  await requireAdmin();
  const { rowCount } = await query(
    `DELETE FROM question_bank WHERE id = $1`,
    [bankQuestionId]
  );
  if (rowCount === 0) {
    return { error: "Bank question not found." };
  }
  revalidatePath("/admin/matches");
  return { ok: true };
}
