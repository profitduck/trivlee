import Link from "next/link";
import { Swords, LogOut, ShieldCheck } from "lucide-react";
import { Button } from "./ui/button";
import { Avatar, AvatarFallback } from "./ui/avatar";
import type { SessionUser } from "@/lib/auth";
import { signOutAction } from "@/lib/auth-actions";

export function SiteHeader({ user }: { user: SessionUser }) {
  const initials = (user.display_name ?? user.username).slice(0, 2).toUpperCase();
  return (
    <header className="border-b bg-card/60 backdrop-blur">
      <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-2">
          <div className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Swords className="size-5" />
          </div>
          <span className="font-display text-xl font-bold tracking-tight">
            Trivia Duel
          </span>
        </Link>
        <div className="flex items-center gap-4">
          {user.is_admin && (
            <Button variant="ghost" size="sm" asChild className="gap-1.5">
              <Link href="/admin/reports">
                <ShieldCheck className="size-4" />
                <span className="hidden sm:inline">Moderation</span>
              </Link>
            </Button>
          )}
          <div className="hidden sm:flex items-center gap-2">
            <Avatar className="size-8">
              <AvatarFallback className="bg-primary text-primary-foreground font-medium text-xs">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="text-sm leading-tight">
              <div className="font-medium">{user.display_name ?? user.username}</div>
              <div className="text-xs text-muted-foreground">@{user.username}</div>
            </div>
          </div>
          <form action={signOutAction}>
            <Button type="submit" variant="ghost" size="sm" className="gap-1.5">
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Sign out</span>
            </Button>
          </form>
        </div>
      </div>
    </header>
  );
}
