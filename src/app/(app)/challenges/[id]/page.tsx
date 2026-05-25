import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  Play,
  Trophy,
  Sparkles,
  Users,
  Crown,
  Lock,
  Hourglass,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  getParticipants,
  isParticipant,
  lazyCloseIfDue,
  type Participant,
} from "@/lib/matches";
import { closeMatchAction } from "./actions";
import { CopyInviteLink } from "./copy-invite-link";

interface ChallengeDetail {
  id: string;
  challenger_id: string;
  topic: string;
  topic_interpretation: string | null;
  knowledge_warning: string | null;
  difficulty_requested: number;
  difficulty_delivered: number | null;
  num_questions: number;
  format: string;
  mode: string;
  time_per_question_s: number | null;
  total_time_s: number | null;
  status: string;
  invite_token: string | null;
  max_players: number | null;
  auto_close_at: string | null;
  closed_at: string | null;
}

async function getChallenge(id: string): Promise<ChallengeDetail | null> {
  const { rows } = await query<ChallengeDetail>(
    `SELECT
       c.id, c.challenger_id, c.topic, c.topic_interpretation,
       c.knowledge_warning, c.difficulty_requested, c.difficulty_delivered,
       c.num_questions, c.format::text AS format, c.mode::text AS mode,
       c.time_per_question_s, c.total_time_s,
       c.status::text AS status, c.invite_token,
       c.max_players, c.auto_close_at, c.closed_at
     FROM challenges c
     WHERE c.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export default async function ChallengePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  // Lazy close if past auto-close deadline.
  await lazyCloseIfDue(id);

  const c = await getChallenge(id);
  if (!c) notFound();

  const userIsParticipant = await isParticipant(id, user.id);
  if (!userIsParticipant) {
    // Not a participant: redirect to join flow if there's an invite token.
    if (c.invite_token) {
      redirect(`/join/${c.invite_token}`);
    }
    notFound();
  }

  if (c.status === "completed") {
    redirect(`/challenges/${id}/results`);
  }

  const participants = await getParticipants(id);
  const me = participants.find((p) => p.user_id === user.id);
  const youAreChallenger = c.challenger_id === user.id;
  const myProgress = me?.answered_count ?? 0;
  const myDone = myProgress >= c.num_questions;
  const isOpen = c.closed_at === null && c.status !== "completed" && c.status !== "cancelled";
  const isFull = c.max_players !== null && participants.length >= c.max_players;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-3 gap-1.5">
        <Link href="/dashboard">
          <ArrowLeft className="size-4" />
          Back to dashboard
        </Link>
      </Button>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="gap-1.5">
            <Sparkles className="size-3.5" />
            {c.format.replace("_", " ")}
          </Badge>
          <Badge variant="outline">{c.mode}</Badge>
          <Badge variant="outline">D{c.difficulty_requested}</Badge>
          {c.time_per_question_s && (
            <Badge variant="outline" className="gap-1">
              <Clock className="size-3" /> {c.time_per_question_s}s/q
            </Badge>
          )}
          <Badge variant="outline" className="gap-1">
            <Users className="size-3" />
            {c.max_players ? `${participants.length}/${c.max_players}` : `${participants.length} joined`}
          </Badge>
        </div>
        <h1 className="font-display text-4xl font-extrabold tracking-tighter">{c.topic}</h1>
        <p className="text-muted-foreground">{c.num_questions} questions</p>
      </header>

      {c.topic_interpretation && (
        <Card className="border-2 border-primary/30">
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wider font-semibold text-primary mb-2">
              AI&rsquo;s interpretation
            </p>
            <p className="text-sm leading-relaxed">{c.topic_interpretation}</p>
          </CardContent>
        </Card>
      )}

      {c.knowledge_warning && (
        <Card className="border-2 border-accent">
          <CardContent className="p-5 flex items-start gap-3">
            <AlertTriangle className="size-5 text-accent-foreground shrink-0 mt-0.5" />
            <div>
              <p className="text-xs uppercase tracking-wider font-semibold mb-1">Heads up</p>
              <p className="text-sm leading-relaxed">{c.knowledge_warning}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {c.auto_close_at && isOpen && (
        <Card className="bg-muted/40">
          <CardContent className="p-4 flex items-center gap-2 text-sm">
            <Hourglass className="size-4 text-muted-foreground" />
            Auto-closes <RelativeTime iso={c.auto_close_at} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-bold">
              {participants.some((p) => p.total_score > 0) ? "Leaderboard" : "Players"}
            </h2>
            {isFull && (
              <Badge variant="outline" className="gap-1">
                <Lock className="size-3" /> Full
              </Badge>
            )}
          </div>
          <div className="space-y-3">
            {participants.map((p, i) => (
              <ParticipantRow
                key={p.user_id}
                p={p}
                total={c.num_questions}
                rank={i + 1}
                isYou={p.user_id === user.id}
                someoneHasScore={participants.some((q) => q.total_score > 0)}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Invite link */}
      {isOpen && c.invite_token && !isFull && (
        <CopyInviteLink token={c.invite_token} />
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        {!myDone && isOpen && (
          <Button asChild size="lg" className="gap-2">
            <Link href={`/challenges/${id}/play`}>
              <Play className="size-5" />
              {myProgress === 0 ? "Start playing" : "Continue"}
            </Link>
          </Button>
        )}
        {myDone && isOpen && (
          <p className="text-sm text-muted-foreground">
            You&rsquo;ve finished. Waiting on the rest of the players (or the host to close the match).
          </p>
        )}
        {youAreChallenger && isOpen && (
          <form action={async () => { "use server"; await closeMatchAction(id); }}>
            <Button type="submit" variant="outline" size="lg" className="gap-2">
              <Trophy className="size-5" />
              Close match
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

function ParticipantRow({
  p,
  total,
  rank,
  isYou,
  someoneHasScore,
}: {
  p: Participant;
  total: number;
  rank: number;
  isYou: boolean;
  someoneHasScore: boolean;
}) {
  const pct = total > 0 ? Math.min(100, (p.answered_count / total) * 100) : 0;
  const initials = (p.display_name ?? p.username).slice(0, 2).toUpperCase();
  return (
    <div className="flex items-center gap-3">
      {someoneHasScore && (
        <div className="w-6 text-center shrink-0">
          <RankBadge rank={rank} />
        </div>
      )}
      <Avatar className="size-9 shrink-0">
        <AvatarFallback className={isYou ? "bg-primary text-primary-foreground font-medium" : "bg-muted text-muted-foreground font-medium"}>
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">
            {isYou ? "You" : (p.display_name ?? p.username)}
          </span>
          {p.is_challenger && (
            <Crown className="size-3.5 text-primary shrink-0" />
          )}
          <span className="ml-auto text-xs font-mono tabular-nums text-muted-foreground">
            {p.answered_count}/{total}
          </span>
        </div>
        <div className="mt-1 h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className={isYou ? "h-full bg-primary transition-all" : "h-full bg-chart-2 transition-all"}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      {someoneHasScore && (
        <div className="text-right shrink-0 w-14">
          <p className="font-display text-lg font-bold leading-none tabular-nums">
            {p.total_score.toFixed(1)}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {p.is_correct_count} right
          </p>
        </div>
      )}
    </div>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <span className="font-display text-base font-bold text-primary">1</span>;
  if (rank === 2) return <span className="font-display text-base font-bold text-chart-2">2</span>;
  if (rank === 3) return <span className="font-display text-base font-bold text-accent-foreground">3</span>;
  return <span className="text-sm text-muted-foreground font-medium">{rank}</span>;
}

function RelativeTime({ iso }: { iso: string }) {
  const target = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = target - now;
  const absMin = Math.abs(Math.round(diffMs / 60000));
  const future = diffMs > 0;
  let label: string;
  if (absMin < 60) label = `${absMin}m`;
  else if (absMin < 60 * 24) label = `${Math.round(absMin / 60)}h`;
  else label = `${Math.round(absMin / (60 * 24))}d`;
  return <span className="font-mono">{future ? `in ${label}` : `${label} ago`}</span>;
}
