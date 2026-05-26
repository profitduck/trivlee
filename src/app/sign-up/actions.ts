"use server";

import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { setSession } from "@/lib/auth";
import { safeNextPath } from "@/lib/safe-redirect";

export interface SignUpFormState {
  error?: string;
}

export async function signUpAction(
  _prev: SignUpFormState | null,
  formData: FormData
): Promise<SignUpFormState> {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const displayName = String(formData.get("display_name") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim() || null;
  const next = safeNextPath(String(formData.get("next") ?? ""));

  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    return {
      error:
        "Username must be 3-20 characters: lowercase letters, digits, or underscores.",
    };
  }

  try {
    const { rows } = await query<{ id: string }>(
      `INSERT INTO users (username, display_name, email)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [username, displayName, email]
    );
    await setSession(rows[0].id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("users_username_key")) {
      return { error: `Username "${username}" is taken.` };
    }
    if (msg.includes("users_email_key")) {
      return { error: "An account with that email already exists." };
    }
    return { error: "Something went wrong creating your account." };
  }

  redirect(next);
}
