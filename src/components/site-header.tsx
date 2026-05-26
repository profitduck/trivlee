import Link from "next/link";
import { Swords, LogOut, ShieldCheck, Trophy, Award } from "lucide-react";
import { Button } from "./ui/button";
import { Avatar, AvatarFallback } from "./ui/avatar";
import type { SessionUser } from "@/lib/auth";
import { signOutAction } from "@/lib/auth-actions";

export function SiteHeader({ user }: { user: SessionUser }) {
  const initials = (user.display_name ?? user.username).slice(0, 2).toUpperCase();
  return (
    <header className="border-b bg-card/70 backdrop-blur-md sticky top-0 z-40">
      <div className="mx-auto max-w-6xl px-6 h-16 flex items-center justify-between">
        <Link href="/dashboard" className="flex items-center gap-2 group">
          <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-md shadow-primary/30 group-hover:shadow-lg group-hover:shadow-primary/40 group-hover:rotate-3 transition-all duration-200">
            <Swords className="size-5" />
          </div>
          <span className="font-display text-xl font-extrabold tracking-tight">
            Trivlee
          </span>
        </Link>
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="sm" asChild className="gap-1.5">
            <Link href="/leaderboard">
              <Trophy className="size-4" />
              <span className="hidden sm:inline">Leaderboard</span>
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild className="gap-1.5">
            <Link href="/achievements">
              <Award className="size-4" />
              <span className="hidden sm:inline">Achievements</span>
            </Link>
          </Button>
          {user.is_admin && (
            <Button variant="ghost" size="sm" asChild className="gap-1.5">
              <Link href="/admin">
                <ShieldCheck className="size-4" />
                <span className="hidden sm:inline">Admin</span>
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
