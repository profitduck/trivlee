"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";

// Returns void so these can be used directly as <form action={fn.bind(...)}>.
// Errors throw; revalidatePath refreshes the UI on success.

export async function hideReportedQuestion(reportId: string): Promise<void> {
  await requireAdmin();
  const { rows } = await query<{ question_id: string; bank_question_id: string | null }>(
    `SELECT qr.question_id, q.bank_question_id
       FROM question_reports qr
       JOIN questions q ON q.id = qr.question_id
      WHERE qr.id = $1`,
    [reportId]
  );
  if (rows.length === 0) return;
  const { bank_question_id } = rows[0];

  if (bank_question_id) {
    await query(
      `UPDATE question_bank SET hidden = true WHERE id = $1`,
      [bank_question_id]
    );
  }

  await query(
    `UPDATE question_reports
        SET status = 'reviewed_removed'
      WHERE question_id = $1`,
    [rows[0].question_id]
  );

  revalidatePath("/admin/reports");
}

export async function dismissReport(reportId: string): Promise<void> {
  await requireAdmin();
  await query(
    `UPDATE question_reports SET status = 'reviewed_kept' WHERE id = $1`,
    [reportId]
  );
  revalidatePath("/admin/reports");
}
