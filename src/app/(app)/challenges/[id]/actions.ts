"use server";

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
