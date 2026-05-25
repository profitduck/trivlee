import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Sparkles,
  Users,
  AlertTriangle,
  Lock,
  Hourglass,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { requireUser, getCurrentUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { isParticipant, lazyCloseIfDue, recordInviteView } from "@/lib/matches";
import { JoinButton } from "./join-button";
import { redirect } from "next/navigation";

interface InviteView {
  id: string;
  challenger_username: string;
  challenger_display: string | null;
  topic: string;
  topic_interpretation: string | null;
  difficulty_requested: number;
  num_questions: number;
  format: string;
  mode: string;
  time_per_question_s: number | null;
  status: string;
  closed_at: string | null;
  max_players: number | null;
  auto_close_at: string | null;
  participant_count: string;
}

async function getInvite(token: string): Promise<InviteView | null> {
  const { rows } = await query<InviteView>(
    `SELECT
       c.id,
       u.username AS challenger_username,
       u.display_name AS challenger_display,
       c.topic, c.topic_interpretation, c.difficulty_requested,
       c.num_questions, c.format::text AS format, c.mode::text AS mode,
       c.time_per_question_s,
       c.status::text AS status, c.closed_at, c.max_players, c.auto_close_at,
       (SELECT COUNT(*) FROM challenge_participants cp WHERE cp.challenge_id = c.id) AS participant_count
     FROM challenges c
     JOIN users u ON u.id = c.challenger_id
     WHERE c.invite_token = $1`,
    [token]
  );
  return rows[0] ?? null;
}

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // If not signed in, redirect to sign-in and come back.
  const maybeUser = await getCurrentUser();
  if (!maybeUser) {
    redirect(`/sign-in?next=${encodeURIComponent(`/join/${token}`)}`);
  }
  await requireUser();

  const invite = await getInvite(token);
  if (!invite) notFound();

  // Auto-close if past deadline.
  await lazyCloseIfDue(invite.id);

  // If user is already a participant, go straight to the match.
  if (await isParticipant(invite.id, maybeUser.id)) {
    redirect(`/challenges/${invite.id}`);
  }

  // Record the view so it shows on their dashboard as a pending invite if they
  // don't click "Join" right now.
  await recordInviteView(maybeUser.id, invite.id);

  const participantCount = Number(invite.participant_count);
  const isClosed =
    invite.closed_at !== null ||
    invite.status === "completed" ||
    invite.status === "cancelled";
  const isFull =
    invite.max_players !== null && participantCount >= invite.max_players;
  const canJoin = !isClosed && !isFull;

  const hostName = invite.challenger_display ?? invite.challenger_username;

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-3 gap-1.5">
        <Link href="/dashboard">
          <ArrowLeft className="size-4" />
          Dashboard
        </Link>
      </Button>

      <Card className="border-2">
        <CardContent className="p-6 sm:p-8 space-y-5">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{hostName}</span>{" "}
              invited you to a trivia match.
            </p>
            <h1 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tighter">
              {invite.topic}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1.5">
              <Sparkles className="size-3.5" />
              {invite.format.replace("_", " ")}
            </Badge>
            <Badge variant="outline">{invite.mode}</Badge>
            <Badge variant="outline">D{invite.difficulty_requested}</Badge>
            <Badge variant="outline">{invite.num_questions} questions</Badge>
            {invite.time_per_question_s && (
              <Badge variant="outline" className="gap-1">
                <Clock className="size-3" />
                {invite.time_per_question_s}s/q
              </Badge>
            )}
            <Badge variant="outline" className="gap-1">
              <Users className="size-3" />
              {invite.max_players
                ? `${participantCount}/${invite.max_players}`
                : `${participantCount} joined`}
            </Badge>
          </div>

          {invite.topic_interpretation && (
            <div className="rounded-lg bg-muted/50 p-4 border border-muted">
              <p className="text-xs uppercase tracking-wider font-semibold text-primary mb-2">
                AI&rsquo;s interpretation
              </p>
              <p className="text-sm leading-relaxed">{invite.topic_interpretation}</p>
            </div>
          )}

          {invite.auto_close_at && canJoin && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Hourglass className="size-4" />
              Match closes <RelativeTime iso={invite.auto_close_at} />
            </div>
          )}

          {isClosed && (
            <div className="flex items-start gap-3 rounded-lg bg-destructive/10 border border-destructive/30 p-4">
              <Lock className="size-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-sm">This match is already closed.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {hostName} closed the match — no new players can join.
                </p>
              </div>
            </div>
          )}

          {!isClosed && isFull && (
            <div className="flex items-start gap-3 rounded-lg bg-accent/30 border border-accent p-4">
              <AlertTriangle className="size-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-sm">This match is full.</p>
                <p className="text-xs text-muted-foreground mt-1">
                  All {invite.max_players} player slots are taken.
                </p>
              </div>
            </div>
          )}

          <JoinButton token={token} disabled={!canJoin} />
        </CardContent>
      </Card>
    </div>
  );
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
  return <span>{future ? `in ${label}` : `${label} ago`}</span>;
}
