import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { query } from "./db";

const SESSION_COOKIE = "td_session";

export interface SessionUser {
  id: string;
  username: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  is_admin: boolean;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.is_admin) {
    redirect("/dashboard");
  }
  return user;
}

export async function setSession(userId: string) {
  const c = await cookies();
  c.set(SESSION_COOKIE, userId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSession() {
  const c = await cookies();
  c.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const c = await cookies();
  const userId = c.get(SESSION_COOKIE)?.value;
  if (!userId) return null;

  const { rows } = await query<SessionUser>(
    `SELECT id, username, email, display_name, avatar_url, is_admin FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0] ?? null;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in");
  return user;
}
