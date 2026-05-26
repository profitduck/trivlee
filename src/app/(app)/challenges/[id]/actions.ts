"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { closeChallenge } from "@/lib/matches";

export async function closeMatchAction(challengeId: string) {
  const user = await requireUser();
  const { rows } = await query<{ challenger_id: string }>(
    `SELECT challenger_id FROM challenges WHERE id = $1`,
    [challengeId]
  );
  if (rows.length === 0 || rows[0].challenger_id !== user.id) {
    return { error: "Only the match host can close it." };
  }
  await closeChallenge(challengeId);
  revalidatePath(`/challenges/${challengeId}`);
  return { ok: true };
}

/**
 * Hard-delete a match the user created. Schema has ON DELETE CASCADE on
 * challenge_participants, question_sets, attempts, and results — so the
 * one DELETE cleans up every related row. We do NOT credit back the AI
 * rate-limit slot: the slot was consumed when the API call was made,
 * regardless of whether the resulting match got used.
 *
 * Only the challenger can delete their own match. Joiners can leave a
 * match but can't delete it (deletion would erase the host's questions
 * and the other players' attempts).
 *
 * Always redirects to /dashboard on success — the match's page won't
 * exist anymore so we can't revalidate it.
 */
export async function deleteMatchAction(challengeId: string) {
  const user = await requireUser();
  const { rows } = await query<{ challenger_id: string }>(
    `SELECT challenger_id FROM challenges WHERE id = $1`,
    [challengeId]
  );
  if (rows.length === 0) {
    // Already gone — treat as success and bounce the user to their dashboard.
    redirect("/dashboard");
  }
  if (rows[0].challenger_id !== user.id) {
    return { error: "Only the match host can delete it." };
  }
  await query(`DELETE FROM challenges WHERE id = $1`, [challengeId]);
  redirect("/dashboard");
}
