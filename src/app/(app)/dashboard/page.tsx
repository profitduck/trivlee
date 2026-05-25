import Link from "next/link";
import { Plus, Inbox, Trophy, Users, MailOpen, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { getPendingInvites, sweepAutoCloseForUser, type PendingInvite } from "@/lib/matches";

interface ChallengeRow {
  id: string;
  topic: string;
  difficulty_requested: number;
  num_questions: number;
  mode: string;
  status: string;
  created_at: string;
  is_challenger: boolean;
  participant_count: number;
  max_players: number | null;
  challenger_username: string | null;
}

async function getMyChallenges(userId: string): Promise<ChallengeRow[]> {
  const { rows } = await query<ChallengeRow>(
    `SELECT
       c.id, c.topic, c.difficulty_requested, c.num_questions,
       c.mode::text AS mode, c.status::text AS status, c.created_at,
       c.max_players,
       cp_me.is_challenger,
       (SELECT COUNT(*) FROM challenge_participants cp2 WHERE cp2.challenge_id = c.id) AS participant_count,
       ch.username AS challenger_username
     FROM challenges c
     JOIN challenge_participants cp_me ON cp_me.challenge_id = c.id AND cp_me.user_id = $1
     LEFT JOIN users ch ON ch.id = c.challenger_id
     ORDER BY c.created_at DESC
     LIMIT 50`,
    [userId]
  );
  return rows.map((r) => ({ ...r, participant_count: Number(r.participant_count) }));
}

export default async function DashboardPage() {
  const user = await requireUser();
  await sweepAutoCloseForUser(user.id);
  const [challenges, pendingInvites] = await Promise.all([
    getMyChallenges(user.id),
    getPendingInvites(user.id),
  ]);

  const pending = challenges.filter((c) => c.status === "pending");
  const inProgress = challenges.filter((c) => c.status === "in_progress");
  const completed = challenges.filter((c) => c.status === "completed");

  return (
    <div className="space-y-10">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-wider text-muted-foreground font-semibold">
            Welcome back
          </p>
          <h1 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tighter mt-1">
            Ready for a match, {user.display_name ?? user.username}?
          </h1>
        </div>
        <Button asChild size="lg" className="gap-2">
          <Link href="/challenges/new">
            <Plus className="size-5" />
            New match
          </Link>
        </Button>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        <StatCard
          icon={<Inbox className="size-5" />}
          label="Open"
          value={pending.length}
          hue="bg-accent text-accent-foreground"
        />
        <StatCard
          icon={<Trophy className="size-5" />}
          label="In progress"
          value={inProgress.length}
          hue="bg-primary text-primary-foreground"
        />
        <StatCard
          icon={<Trophy className="size-5" />}
          label="Completed"
          value={completed.length}
          hue="bg-chart-2 text-primary-foreground"
        />
      </section>

      {pendingInvites.length > 0 && (
        <section>
          <h2 className="font-display text-2xl font-bold mb-4 flex items-center gap-2">
            <MailOpen className="size-5 text-primary" />
            Pending invites
            <Badge variant="secondary">{pendingInvites.length}</Badge>
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {pendingInvites.map((inv) => (
              <PendingInviteCard key={inv.challenge_id} inv={inv} />
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="font-display text-2xl font-bold mb-4">Your matches</h2>
        {challenges.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-10 text-center">
              <p className="text-muted-foreground mb-4">
                No matches yet. Pick a topic and invite some friends.
              </p>
              <Button asChild>
                <Link href="/challenges/new">Start your first match</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {challenges.map((c) => (
              <ChallengeCard key={c.id} c={c} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hue,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  hue: string;
}) {
  return (
    <Card>
      <CardContent className="p-6 flex items-center gap-4">
        <div className={`grid size-12 place-items-center rounded-xl ${hue}`}>{icon}</div>
        <div>
          <p className="text-3xl font-display font-bold leading-none">{value}</p>
          <p className="text-sm text-muted-foreground mt-1">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function PendingInviteCard({ inv }: { inv: PendingInvite }) {
  const hostName = inv.challenger_display ?? inv.challenger_username;
  const sizeLabel = inv.max_players ? `${inv.participant_count}/${inv.max_players}` : `${inv.participant_count} joined`;
  return (
    <Link href={`/join/${inv.invite_token}`} className="block">
      <Card className="border-primary/30 bg-primary/5 transition hover:shadow-md hover:border-primary/60 h-full">
        <CardHeader>
          <CardDescription className="flex items-center gap-1.5 text-xs">
            <span className="font-medium">{hostName}</span> invited you
          </CardDescription>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base font-display">{inv.topic}</CardTitle>
            <ArrowRight className="size-4 text-primary shrink-0" />
          </div>
          <CardDescription className="flex items-center gap-3 flex-wrap">
            <span>{inv.num_questions} questions · D{inv.difficulty_requested} · {inv.mode}</span>
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5" />
              {sizeLabel}
            </span>
          </CardDescription>
        </CardHeader>
      </Card>
    </Link>
  );
}

function ChallengeCard({ c }: { c: ChallengeRow }) {
  const sizeLabel = c.max_players ? `${c.participant_count}/${c.max_players}` : `${c.participant_count}`;
  const roleLabel = c.is_challenger ? "host" : c.challenger_username ? `vs @${c.challenger_username}` : "";
  return (
    <Link href={`/challenges/${c.id}`} className="block">
      <Card className="transition hover:shadow-md hover:border-primary/40 h-full">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base font-display">{c.topic}</CardTitle>
            <span className="text-xs uppercase tracking-wider px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
              {c.status.replace("_", " ")}
            </span>
          </div>
          <CardDescription className="flex items-center gap-3 flex-wrap">
            <span>{c.num_questions} questions · D{c.difficulty_requested} · {c.mode}</span>
            <span className="inline-flex items-center gap-1">
              <Users className="size-3.5" />
              {sizeLabel}
            </span>
            {roleLabel && <span>· {roleLabel}</span>}
          </CardDescription>
        </CardHeader>
      </Card>
    </Link>
  );
}
