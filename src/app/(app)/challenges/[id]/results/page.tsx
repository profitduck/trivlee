import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Crown, Medal, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { cn } from "@/lib/utils";
import { QuestionFeedback } from "./question-feedback";

interface MatchView {
  challenge_id: string;
  topic: string;
  num_questions: number;
  challenger_id: string;
}

interface LeaderboardRow {
  user_id: string;
  username: string;
  display_name: string | null;
  is_challenger: boolean;
  total_score: string;
  correct_count: string;
  answered_count: string;
}

interface QuestionDetail {
  question_id: string;
  position: number;
  question_text: string;
  correct_answer: string;
  source_hint: string | null;
  my_answer: string | null;
  my_correct: boolean | null;
  my_score: number;
  my_quality_rating: number | null;
  my_report_status: string | null;
}

async function getMatch(id: string, userId: string): Promise<MatchView | null> {
  const { rows } = await query<MatchView>(
    `SELECT c.id AS challenge_id, c.topic, c.num_questions, c.challenger_id
       FROM challenges c
       JOIN challenge_participants cp ON cp.challenge_id = c.id AND cp.user_id = $2
      WHERE c.id = $1 AND c.status = 'completed'`,
    [id, userId]
  );
  return rows[0] ?? null;
}

async function getLeaderboard(challengeId: string): Promise<LeaderboardRow[]> {
  const { rows } = await query<LeaderboardRow>(
    `SELECT
       cp.user_id, u.username, u.display_name, cp.is_challenger,
       COALESCE(r.total_score, 0) AS total_score,
       COALESCE(r.correct_count, 0) AS correct_count,
       (SELECT COUNT(*) FROM attempts a WHERE a.challenge_id = cp.challenge_id AND a.user_id = cp.user_id) AS answered_count
     FROM challenge_participants cp
     JOIN users u ON u.id = cp.user_id
     LEFT JOIN results r ON r.challenge_id = cp.challenge_id AND r.user_id = cp.user_id
     WHERE cp.challenge_id = $1
     ORDER BY total_score DESC, correct_count DESC, cp.joined_at ASC`,
    [challengeId]
  );
  return rows;
}

async function getMyBreakdown(
  challengeId: string,
  userId: string
): Promise<QuestionDetail[]> {
  const { rows } = await query<QuestionDetail>(
    `SELECT
       q.id AS question_id, q.position, q.question_text,
       q.correct_answer, q.source_hint,
       am.user_answer AS my_answer, am.is_correct AS my_correct, COALESCE(am.score, 0) AS my_score,
       qr.quality_rating AS my_quality_rating,
       qrep.status::text AS my_report_status
     FROM question_sets qs
     JOIN questions q ON q.set_id = qs.id
     LEFT JOIN attempts am ON am.question_id = q.id AND am.user_id = $2
     LEFT JOIN question_ratings qr ON qr.question_id = q.id AND qr.user_id = $2
     LEFT JOIN question_reports qrep ON qrep.question_id = q.id AND qrep.reporter_id = $2
     WHERE qs.challenge_id = $1
     ORDER BY q.position`,
    [challengeId, userId]
  );
  return rows;
}

export default async function ResultsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();
  const match = await getMatch(id, user.id);
  if (!match) notFound();

  const [board, breakdown] = await Promise.all([
    getLeaderboard(id),
    getMyBreakdown(id, user.id),
  ]);

  const top = board[0];
  const myRow = board.find((r) => r.user_id === user.id);
  const myRank = board.findIndex((r) => r.user_id === user.id) + 1;
  const youWin = top?.user_id === user.id && board.length > 1;
  const totalQs = match.num_questions;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <Button variant="ghost" size="sm" asChild className="-ml-3 gap-1.5">
        <Link href="/dashboard">
          <ArrowLeft className="size-4" />
          Back to dashboard
        </Link>
      </Button>

      <header className="text-center space-y-3">
        <Badge variant="secondary">{match.topic}</Badge>
        <h1 className="font-display text-5xl font-extrabold tracking-tighter">
          {youWin ? (
            <span className="inline-flex items-center gap-3">
              <Crown className="size-10 text-primary" />
              You win!
            </span>
          ) : board.length === 1 ? (
            "Match complete"
          ) : (
            `${displayName(top)} wins.`
          )}
        </h1>
        {myRow && board.length > 1 && (
          <p className="text-muted-foreground">
            You finished {ordinal(myRank)} of {board.length}.
          </p>
        )}
      </header>

      <section>
        <h2 className="font-display text-xl font-bold mb-4">Leaderboard</h2>
        <Card>
          <CardContent className="p-0">
            <ol className="divide-y">
              {board.map((row, idx) => (
                <LeaderboardItem
                  key={row.user_id}
                  row={row}
                  rank={idx + 1}
                  isYou={row.user_id === user.id}
                  total={totalQs}
                />
              ))}
            </ol>
          </CardContent>
        </Card>
      </section>

      <section>
        <h2 className="font-display text-2xl font-bold mb-4">Your answers</h2>
        <div className="space-y-3">
          {breakdown.map((q) => (
            <Card key={q.question_id}>
              <CardContent className="p-5 space-y-3">
                <p className="font-medium leading-snug">
                  <span className="text-muted-foreground mr-2">Q{q.position}.</span>
                  {q.question_text}
                </p>
                <p className="text-sm">
                  <span className="text-muted-foreground">Answer:</span>{" "}
                  <span className="font-semibold">{q.correct_answer}</span>
                </p>
                <YourAttempt answer={q.my_answer} correct={q.my_correct} score={Number(q.my_score)} />
                {q.source_hint && (
                  <p className="text-xs text-muted-foreground border-t pt-2">
                    <span className="font-medium">Source:</span> {q.source_hint}
                  </p>
                )}
                <QuestionFeedback
                  questionId={q.question_id}
                  challengeId={id}
                  existingQuality={q.my_quality_rating}
                  existingReportStatus={q.my_report_status}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <Button asChild size="lg" className="gap-2">
          <Link href="/challenges/new">
            <RotateCcw className="size-5" />
            New match
          </Link>
        </Button>
        <Button variant="outline" asChild size="lg">
          <Link href="/dashboard">Dashboard</Link>
        </Button>
      </div>
    </div>
  );
}

function LeaderboardItem({
  row,
  rank,
  isYou,
  total,
}: {
  row: LeaderboardRow;
  rank: number;
  isYou: boolean;
  total: number;
}) {
  const score = Number(row.total_score);
  const correct = Number(row.correct_count);
  const answered = Number(row.answered_count);
  const initials = (row.display_name ?? row.username).slice(0, 2).toUpperCase();
  const incomplete = answered < total;
  return (
    <li
      className={cn(
        "flex items-center gap-4 px-5 py-4",
        isYou && "bg-primary/5"
      )}
    >
      <div className="w-8 text-center">
        <RankBadge rank={rank} />
      </div>
      <Avatar className="size-10 shrink-0">
        <AvatarFallback
          className={cn(
            "font-medium",
            isYou
              ? "bg-primary text-primary-foreground"
              : "bg-muted text-muted-foreground"
          )}
        >
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium truncate">
            {isYou ? "You" : displayName(row)}
          </span>
          {row.is_challenger && (
            <Crown className="size-3.5 text-primary shrink-0" />
          )}
          {incomplete && (
            <Badge variant="outline" className="text-[10px]">
              {answered}/{total} answered
            </Badge>
          )}
        </div>
      </div>
      <div className="text-right">
        <p className="font-display text-2xl font-bold leading-none tabular-nums">
          {score.toFixed(1)}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          {correct}/{total} correct
        </p>
      </div>
    </li>
  );
}

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return <Medal className="size-5 text-primary mx-auto" />;
  if (rank === 2) return <Medal className="size-5 text-chart-2 mx-auto" />;
  if (rank === 3) return <Medal className="size-5 text-accent-foreground mx-auto" />;
  return <span className="text-sm text-muted-foreground font-medium">{rank}</span>;
}

function YourAttempt({
  answer,
  correct,
  score,
}: {
  answer: string | null;
  correct: boolean | null;
  score: number;
}) {
  const bg = correct ? "bg-chart-5/15" : score > 0 ? "bg-accent/30" : "bg-muted";
  return (
    <div className={`rounded-lg p-3 ${bg}`}>
      <p className="text-xs text-muted-foreground">You answered</p>
      <p className="font-medium leading-snug">
        {answer ?? <em className="text-muted-foreground">— (not answered)</em>}
      </p>
    </div>
  );
}

function displayName(row: { username: string; display_name: string | null }): string {
  return row.display_name ?? row.username;
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
