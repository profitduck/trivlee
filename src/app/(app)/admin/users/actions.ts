"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";

/**
 * Flip a user's is_admin flag. Admins can promote or demote anyone EXCEPT
 * themselves — preventing the last admin from accidentally locking the org
 * out. (You can still demote-then-be-demoted-by-another-admin manually.)
 */
export async function toggleAdminAction(
  userId: string,
  newValue: boolean
): Promise<{ ok: true } | { error: string }> {
  const me = await requireAdmin();
  if (me.id === userId) {
    return { error: "You can't change your own admin flag." };
  }
  await query(`UPDATE users SET is_admin = $2 WHERE id = $1`, [userId, newValue]);
  revalidatePath("/admin/users");
  return { ok: true };
}

/**
 * Hard-delete a user account. ON DELETE CASCADE on related tables cleans up
 * everything they touched (matches they created, attempts they made, etc.).
 * Refuses self-deletion for safety.
 */
export async function deleteUserAction(
  userId: string
): Promise<{ ok: true } | { error: string }> {
  const me = await requireAdmin();
  if (me.id === userId) {
    return { error: "You can't delete your own account from here. Use account settings." };
  }
  await query(`DELETE FROM users WHERE id = $1`, [userId]);
  revalidatePath("/admin/users");
  return { ok: true };
}
