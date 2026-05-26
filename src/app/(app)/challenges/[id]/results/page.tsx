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
import { WinConfetti } from "./win-confetti";

interface MatchView {
  challenge_id: string;
  topic: string;
  num_questions: number;
  challenger_id: string;
  timer_mode: string;
}

interface LeaderboardRow {
  user_id: string;
  username: string;
  display_name: string | null;
  is_challenger: boolean;
  total_score: string;
  correct_count: string;
  answered_count: string;
  total_time_ms: string | null;
}

/**
 * Competition-style ranking: tied players share a rank, and the next rank
 * skips by the size of the tie group. E.g. two-way tie for 1st → next is 3rd.
 * Two players tie iff total_score AND correct_count both match; joined_at
 * isn't a fair tiebreaker so we ignore it for tie detection.
 */
interface RankedRow {
  row: LeaderboardRow;
  rank: number;
  tied: boolean; // true when at least one other row shares this rank
}

function rankLeaderboard(board: LeaderboardRow[], useTimeTiebreak: boolean): RankedRow[] {
  const out: RankedRow[] = [];
  for (let i = 0; i < board.length; i++) {
    const cur = board[i];
    const prev = i > 0 ? board[i - 1] : null;
    // In stopwatch mode, total_time_ms also factors into the rank — fastest
    // wins a score tie, so two rows are "truly tied" only when score, correct,
    // AND time all match. In other modes, just score + correct_count.
    const sameAsPrev =
      prev !== null &&
      prev.total_score === cur.total_score &&
      prev.correct_count === cur.correct_count &&
      (!useTimeTiebreak || prev.total_time_ms === cur.total_time_ms);
    const rank = sameAsPrev ? out[i - 1].rank : i + 1;
    out.push({ row: cur, rank, tied: false });
  }
  // Second pass: mark `tied` true for any rank shared by >1 row.
  const counts = new Map<number, number>();
  for (const r of out) counts.set(r.rank, (counts.get(r.rank) ?? 0) + 1);
  for (const r of out) if ((counts.get(r.rank) ?? 0) > 1) r.tied = true;
  return out;
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
    `SELECT c.id AS challenge_id, c.topic, c.num_questions, c.challenger_id,
            c.timer_mode::text AS timer_mode
       FROM challenges c
       JOIN challenge_participants cp ON cp.challenge_id = c.id AND cp.user_id = $2
      WHERE c.id = $1 AND c.status = 'completed'`,
    [id, userId]
  );
  return rows[0] ?? null;
}

async function getLeaderboard(
  challengeId: string,
  useTimeTiebreak: boolean
): Promise<LeaderboardRow[]> {
  // In stopwatch mode, ties on (total_score, correct_count) are broken by
  // total_time_ms ASC (fastest wins). In all other modes, joined_at is just a
  // stable secondary sort — it does NOT determine winner.
  const tiebreakSql = useTimeTiebreak
    ? `r.total_time_ms ASC NULLS LAST, cp.joined_at ASC`
    : `cp.joined_at ASC`;
  const { rows } = await query<LeaderboardRow>(
    `SELECT
       cp.user_id, u.username, u.display_name, cp.is_challenger,
       COALESCE(r.total_score, 0) AS total_score,
       COALESCE(r.correct_count, 0) AS correct_count,
       r.total_time_ms,
       (SELECT COUNT(*) FROM attempts a WHERE a.challenge_id = cp.challenge_id AND a.user_id = cp.user_id) AS answered_count
     FROM challenge_participants cp
     JOIN users u ON u.id = cp.user_id
     LEFT JOIN results r ON r.challenge_id = cp.challenge_id AND r.user_id = cp.user_id
     WHERE cp.challenge_id = $1
     ORDER BY total_score DESC, correct_count DESC, ${tiebreakSql}`,
    [challengeId]
  );
  return rows;
}

interface PeerAttempt {
  question_id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  user_answer: string | null;
  is_correct: boolean | null;
  score: number;
}

/**
 * Fetch every participant's attempt for every question in the match, so the
 * results page can show "Alice picked Cricket, Bob picked Doolan" under each
 * question. Includes the current user too — caller decides whether to render
 * the self row separately.
 */
async function getAllAttempts(challengeId: string): Promise<PeerAttempt[]> {
  const { rows } = await query<PeerAttempt & { score: string }>(
    `SELECT
       a.question_id, a.user_id, u.username, u.display_name,
       a.user_answer, a.is_correct, a.score
     FROM attempts a
     JOIN users u ON u.id = a.user_id
     WHERE a.challenge_id = $1
     ORDER BY a.question_id, a.created_at ASC`,
    [challengeId]
  );
  return rows.map((r) => ({ ...r, score: Number(r.score) }));
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

  const useTimeTiebreak = match.timer_mode === "stopwatch";
  const [board, breakdown, peerAttempts] = await Promise.all([
    getLeaderboard(id, useTimeTiebreak),
    getMyBreakdown(id, user.id),
    getAllAttempts(id),
  ]);

  // Group peer attempts by question for fast per-question lookup in render.
  const attemptsByQuestion = new Map<string, PeerAttempt[]>();
  for (const a of peerAttempts) {
    const list = attemptsByQuestion.get(a.question_id) ?? [];
    list.push(a);
    attemptsByQuestion.set(a.question_id, list);
  }

  const ranked = rankLeaderboard(board, useTimeTiebreak);
  const topRow = ranked[0];
  const winners = ranked.filter((r) => r.rank === 1);
  const isTopTied = winners.length > 1;
  const myEntry = ranked.find((r) => r.row.user_id === user.id);
  const myRank = myEntry?.rank ?? 0;
  const youAreInTopTie = isTopTied && winners.some((w) => w.row.user_id === user.id);
  const youWinSolo = !isTopTied && topRow?.row.user_id === user.id && board.length > 1;
  const totalQs = match.num_questions;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      {(youWinSolo || youAreInTopTie) && <WinConfetti />}
      <Button variant="ghost" size="sm" asChild className="-ml-3 gap-1.5">
        <Link href="/dashboard">
          <ArrowLeft className="size-4" />
          Back to dashboard
        </Link>
      </Button>

      <header className="text-center space-y-3 anim-fade-up">
        <Badge variant="secondary" className="text-xs uppercase tracking-widest font-bold">{match.topic}</Badge>
        <h1 className="font-display text-5xl sm:text-6xl font-extrabold tracking-tighter leading-[1.05]">
          {youAreInTopTie ? (
            <span className="inline-flex items-center gap-3 text-gradient-warm">
              <Crown className="size-12 text-primary drop-shadow-md" />
              {winners.length === 2 ? "You tied for first!" : `Tied ${winners.length}-way for first!`}
            </span>
          ) : isTopTied ? (
            <span>
              {winners.length === 2 ? "Tied" : `${winners.length}-way tie`}:{" "}
              {winners.map((w) => displayName(w.row)).join(" & ")}
            </span>
          ) : youWinSolo ? (
            <span className="inline-flex items-center gap-3 text-gradient-warm">
              <Crown className="size-12 text-primary drop-shadow-md" />
              You win!
            </span>
          ) : board.length === 1 ? (
            "Match complete"
          ) : (
            <>
              <span className="text-gradient-warm">{displayName(topRow.row)}</span> wins.
            </>
          )}
        </h1>
        {myEntry && board.length > 1 && !youAreInTopTie && (
          <p className="text-muted-foreground text-base">
            You finished{" "}
            <strong className="text-foreground font-display text-lg">
              {ordinal(myRank)}
            </strong>{" "}
            of {board.length}
            {myEntry.tied && " (tied)"}.
          </p>
        )}
      </header>

      <section>
        <h2 className="font-display text-xl font-bold mb-4">Leaderboard</h2>
        <Card>
          <CardContent className="p-0">
            <ol className="divide-y">
              {ranked.map((entry) => (
                <LeaderboardItem
                  key={entry.row.user_id}
                  row={entry.row}
                  rank={entry.rank}
                  tied={entry.tied}
                  isYou={entry.row.user_id === user.id}
                  total={totalQs}
                  showTime={useTimeTiebreak}
                />
              ))}
            </ol>
          </CardContent>
        </Card>
      </section>

      <section>
        <h2 className="font-display text-2xl font-bold mb-4">
          {board.length > 1 ? "Question breakdown" : "Your answers"}
        </h2>
        <div className="space-y-3">
          {breakdown.map((q) => {
            const peers = (attemptsByQuestion.get(q.question_id) ?? []).filter(
              (a) => a.user_id !== user.id
            );
            return (
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
                  {peers.length > 0 && (
                    <PeerAnswers attempts={peers} correctAnswer={q.correct_answer} />
                  )}
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
            );
          })}
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
  tied,
  isYou,
  total,
  showTime,
}: {
  row: LeaderboardRow;
  rank: number;
  tied: boolean;
  isYou: boolean;
  total: number;
  showTime: boolean;
}) {
  const score = Number(row.total_score);
  const correct = Number(row.correct_count);
  const answered = Number(row.answered_count);
  const initials = (row.display_name ?? row.username).slice(0, 2).toUpperCase();
  const incomplete = answered < total;
  const timeMs = row.total_time_ms ? Number(row.total_time_ms) : null;
  return (
    <li
      className={cn(
        "flex items-center gap-4 px-5 py-4",
        isYou && "bg-primary/5"
      )}
    >
      <div className="w-8 text-center">
        <RankBadge rank={rank} tied={tied} />
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
        {showTime && timeMs !== null && (
          <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
            {formatTotalTime(timeMs)}
          </p>
        )}
      </div>
    </li>
  );
}

function formatTotalTime(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function RankBadge({ rank, tied }: { rank: number; tied: boolean }) {
  if (rank === 1) {
    return (
      <div className="flex flex-col items-center gap-0.5">
        <Medal className="size-5 text-primary" />
        {tied && <span className="text-[9px] uppercase tracking-wider font-bold text-primary">T</span>}
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div className="flex flex-col items-center gap-0.5">
        <Medal className="size-5 text-chart-2" />
        {tied && <span className="text-[9px] uppercase tracking-wider font-bold text-chart-2">T</span>}
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div className="flex flex-col items-center gap-0.5">
        <Medal className="size-5 text-accent-foreground" />
        {tied && <span className="text-[9px] uppercase tracking-wider font-bold">T</span>}
      </div>
    );
  }
  return (
    <span className="text-sm text-muted-foreground font-medium">
      {rank}
      {tied && <span className="text-[10px] ml-0.5">T</span>}
    </span>
  );
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

/**
 * Compact "who picked what" panel under each question, showing every other
 * participant's answer. For MC the answer is the picked option; for free-text
 * it's whatever they typed. Skipped/timed-out attempts show as "— (no answer)".
 *
 * Each row is colored by correctness so you can scan and see at a glance who
 * got it right and who didn't.
 */
function PeerAnswers({
  attempts,
  correctAnswer,
}: {
  attempts: PeerAttempt[];
  correctAnswer: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
        Others answered
      </p>
      <ul className="space-y-1.5">
        {attempts.map((a) => {
          const initials = (a.display_name ?? a.username).slice(0, 2).toUpperCase();
          const correct = a.is_correct === true;
          const partial = !correct && a.score > 0;
          const noAnswer = a.user_answer === null;
          const matchesCorrect =
            !noAnswer &&
            a.user_answer?.toLowerCase().trim() === correctAnswer.toLowerCase().trim();
          return (
            <li key={a.user_id} className="flex items-center gap-2.5 text-sm">
              <Avatar className="size-7 shrink-0">
                <AvatarFallback className="text-[10px] bg-muted text-muted-foreground font-medium">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="font-medium text-sm">
                {a.display_name ?? a.username}
              </span>
              <span className="text-muted-foreground text-xs">·</span>
              <span
                className={cn(
                  "flex-1 min-w-0 truncate text-sm",
                  noAnswer && "italic text-muted-foreground",
                  correct && "text-chart-5 font-medium",
                  partial && "text-accent-foreground"
                )}
                title={a.user_answer ?? "no answer"}
              >
                {noAnswer ? "— (no answer)" : a.user_answer}
              </span>
              {(correct || matchesCorrect) && (
                <span
                  className="inline-flex items-center justify-center size-5 rounded-full bg-chart-5/20 shrink-0"
                  title="Correct"
                >
                  <Crown className="size-3 text-chart-5" />
                </span>
              )}
              {!correct && !noAnswer && (
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {partial ? `+${a.score.toFixed(1)}` : "0"}
                </span>
              )}
            </li>
          );
        })}
      </ul>
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
