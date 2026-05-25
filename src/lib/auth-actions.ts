"use server";

import { redirect } from "next/navigation";
import { clearSession } from "./auth";

export async function signOutAction() {
  await clearSession();
  redirect("/");
}
