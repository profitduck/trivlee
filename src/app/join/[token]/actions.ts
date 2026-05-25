"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { clearInviteView, tryJoinChallenge } from "@/lib/matches";

export async function joinAction(token: string) {
  const user = await requireUser();
  const { rows } = await query<{ id: string }>(
    `SELECT id FROM challenges WHERE invite_token = $1`,
    [token]
  );
  if (rows.length === 0) {
    return { error: "Invite link is invalid or expired." };
  }
  const challengeId = rows[0].id;
  const result = await tryJoinChallenge(challengeId, user.id);
  if (!result.ok) {
    return { error: result.reason };
  }
  await clearInviteView(user.id, challengeId);
  redirect(`/challenges/${challengeId}`);
}
