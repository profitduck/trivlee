import Link from "next/link";
import { Flag, Users, ListChecks, Database, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth";
import { query } from "@/lib/db";

interface AdminStats {
  total_users: number;
  total_matches: number;
  pending_matches: number;
  failed_matches: number;
  bank_questions: number;
  open_reports: number;
}

async function getStats(): Promise<AdminStats> {
  const { rows } = await query<{
    total_users: string;
    total_matches: string;
    pending_matches: string;
    failed_matches: string;
    bank_questions: string;
    open_reports: string;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM users)                                  AS total_users,
       (SELECT COUNT(*) FROM challenges)                             AS total_matches,
       (SELECT COUNT(*) FROM challenges WHERE status = 'pending')    AS pending_matches,
       (SELECT COUNT(*) FROM challenges
          WHERE generation_phase LIKE 'failed:%')                    AS failed_matches,
       (SELECT COUNT(*) FROM question_bank WHERE hidden = false)     AS bank_questions,
       (SELECT COUNT(*) FROM question_reports WHERE status = 'open') AS open_reports`
  );
  const r = rows[0];
  return {
    total_users: Number(r.total_users),
    total_matches: Number(r.total_matches),
    pending_matches: Number(r.pending_matches),
    failed_matches: Number(r.failed_matches),
    bank_questions: Number(r.bank_questions),
    open_reports: Number(r.open_reports),
  };
}

export default async function AdminIndex() {
  await requireAdmin();
  const stats = await getStats();

  const sections = [
    {
      title: "Users",
      description: "List, promote, or delete user accounts.",
      icon: Users,
      href: "/admin/users",
      badge: stats.total_users,
    },
    {
      title: "Matches",
      description: "Browse matches with their AI generation metadata. Inspect failures.",
      icon: ListChecks,
      href: "/admin/matches",
      badge: stats.total_matches,
      detail: stats.failed_matches > 0 ? `${stats.failed_matches} failed` : null,
    },
    {
      title: "Reports",
      description: "Review user-reported questions.",
      icon: Flag,
      href: "/admin/reports",
      badge: stats.open_reports,
      highlight: stats.open_reports > 0,
    },
    {
      title: "Question bank",
      description: "Curated reusable trivia questions across topics.",
      icon: Database,
      href: "/admin/matches", // bank inspection lives in match browser for now
      badge: stats.bank_questions,
    },
  ];

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <header className="space-y-2">
        <p className="text-sm uppercase tracking-wider text-muted-foreground font-semibold">
          Admin
        </p>
        <h1 className="font-display text-4xl font-extrabold tracking-tighter">
          Operator console
        </h1>
        <p className="text-sm text-muted-foreground">
          Health, content, and account management for Trivlee.
        </p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Total users" value={stats.total_users} />
        <StatTile label="Total matches" value={stats.total_matches} />
        <StatTile label="Pending matches" value={stats.pending_matches} />
        <StatTile
          label="Failed generations"
          value={stats.failed_matches}
          tone={stats.failed_matches > 0 ? "destructive" : "muted"}
        />
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        {sections.map((s) => (
          <Link key={s.title} href={s.href} className="block">
            <Card
              className={`transition hover:shadow-md ${s.highlight ? "border-destructive/40" : "hover:border-primary/40"}`}
            >
              <CardContent className="p-5 flex items-start gap-4">
                <div className="size-10 rounded-lg bg-primary/10 grid place-items-center shrink-0">
                  <s.icon className="size-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="font-display text-lg font-bold">{s.title}</h3>
                    <span className="text-xs font-mono tabular-nums text-muted-foreground">
                      {s.badge}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1">{s.description}</p>
                  {s.detail && (
                    <p className="text-xs text-destructive mt-1.5 font-medium">{s.detail}</p>
                  )}
                </div>
                <ArrowRight className="size-4 text-muted-foreground shrink-0 self-center" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </section>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "muted" | "destructive";
}) {
  const valueClass =
    tone === "destructive"
      ? "text-destructive"
      : tone === "muted"
        ? "text-muted-foreground"
        : "text-foreground";
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
          {label}
        </p>
        <p className={`font-display text-3xl font-bold mt-1 tabular-nums ${valueClass}`}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
