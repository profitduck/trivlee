"use server";

import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { setSession } from "@/lib/auth";
import { safeNextPath } from "@/lib/safe-redirect";

export async function signInAction(formData: FormData) {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const next = safeNextPath(String(formData.get("next") ?? ""));
  if (!username) {
    return { error: "Username is required." };
  }

  const { rows } = await query<{ id: string }>(
    `SELECT id FROM users WHERE username = $1`,
    [username]
  );

  if (rows.length === 0) {
    return { error: `No user found with username "${username}".` };
  }

  await setSession(rows[0].id);
  redirect(next);
}

export async function quickSwitchAction(userId: string, next?: string) {
  await setSession(userId);
  redirect(safeNextPath(next));
}
