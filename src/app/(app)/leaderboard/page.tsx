import Link from "next/link";
import { ArrowLeft, Trophy, Crown, Medal, Target, Flame } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { cn } from "@/lib/utils";

/**
 * The leaderboard page aggregates results across all completed matches. We
 * compute the same metrics for everyone, then render a single ranked list.
 *
 * Definitions:
 *   total_points   — sum of total_score across all results (partial credit included)
 *   correct        — sum of correct_count
 *   matches_played — number of result rows
 *   wins           — number of matches where this user had top score AND
 *                    there was at least one other player (single-player
 *                    matches don't count as "wins")
 *   accuracy       — correct / questions_answered (only counts answered Qs)
 */
interface LeaderRow {
  user_id: string;
  username: string;
  display_name: string | null;
  total_points: number;
  correct: number;
  questions_answered: number;
  matches_played: number;
  wins: number;
  accuracy_pct: number;
}

interface TopicChip {
  topic_normalized: string;
  topic_display: string;
  match_count: number;
}

/**
 * Pull the most-played topics so the leaderboard page can show quick-filter
 * chips. Display name comes from the most recent challenge with that
 * normalized topic — they're usually identical except for caps/punctuation.
 */
async function getTopTopics(limit: number): Promise<TopicChip[]> {
  const { rows } = await query<{ topic_normalized: string; topic_display: string; match_count: string }>(
    `SELECT
       c.topic_normalized,
       (SELECT topic FROM challenges
         WHERE topic_normalized = c.topic_normalized
         ORDER BY created_at DESC LIMIT 1) AS topic_display,
       COUNT(*)::text AS match_count
     FROM challenges c
     JOIN results r ON r.challenge_id = c.id
     GROUP BY c.topic_normalized
     ORDER BY COUNT(*) DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    topic_normalized: r.topic_normalized,
    topic_display: r.topic_display,
    match_count: Number(r.match_count),
  }));
}

async function getGlobalLeaderboard(
  limit: number,
  topicNormalized: string | null
): Promise<LeaderRow[]> {
  // When a topic filter is active, restrict the result set to matches on
  // that exact topic_normalized. Otherwise aggregate over everything.
  const topicJoin = topicNormalized
    ? `JOIN challenges c ON c.id = r.challenge_id AND c.topic_normalized = $2`
    : `JOIN challenges c ON c.id = r.challenge_id`;
  const params: (string | number)[] = topicNormalized ? [limit, topicNormalized] : [limit];

  const { rows } = await query<{
    user_id: string;
    username: string;
    display_name: string | null;
    total_points: string;
    correct: string;
    questions_answered: string;
    matches_played: string;
    wins: string;
  }>(
    `WITH scoped_results AS (
       SELECT r.*
         FROM results r
         ${topicJoin}
     ),
     match_max AS (
       SELECT challenge_id, MAX(total_score) AS max_score, COUNT(*) AS player_count
         FROM scoped_results
        GROUP BY challenge_id
     )
     SELECT
       u.id AS user_id, u.username, u.display_name,
       COALESCE(SUM(r.total_score), 0)::numeric AS total_points,
       COALESCE(SUM(r.correct_count), 0)::int  AS correct,
       (SELECT COUNT(*) FROM attempts a
          ${topicNormalized ? "JOIN challenges c2 ON c2.id = a.challenge_id AND c2.topic_normalized = $2" : ""}
          WHERE a.user_id = u.id AND a.user_answer IS NOT NULL) AS questions_answered,
       COUNT(r.challenge_id)::int AS matches_played,
       SUM(
         CASE
           WHEN mm.max_score = r.total_score AND mm.player_count > 1 THEN 1
           ELSE 0
         END
       )::int AS wins
     FROM users u
     LEFT JOIN scoped_results r ON r.user_id = u.id
     LEFT JOIN match_max mm    ON mm.challenge_id = r.challenge_id
     GROUP BY u.id, u.username, u.display_name
     HAVING COUNT(r.challenge_id) > 0
     ORDER BY total_points DESC, correct DESC, u.created_at ASC
     LIMIT $1`,
    params
  );
  return rows.map((r) => {
    const correct = Number(r.correct);
    const answered = Number(r.questions_answered);
    return {
      user_id: r.user_id,
      username: r.username,
      display_name: r.display_name,
      total_points: Number(r.total_points),
      correct,
      questions_answered: answered,
      matches_played: Number(r.matches_played),
      wins: Number(r.wins),
      accuracy_pct: answered > 0 ? Math.round((correct / answered) * 100) : 0,
    };
  });
}

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string }>;
}) {
  const user = await requireUser();
  const { topic: topicFilter } = await searchParams;
  const [board, topics] = await Promise.all([
    getGlobalLeaderboard(100, topicFilter ?? null),
    getTopTopics(10),
  ]);
  const myIdx = board.findIndex((r) => r.user_id === user.id);
  const me = myIdx >= 0 ? board[myIdx] : null;
  const activeTopic = topicFilter
    ? topics.find((t) => t.topic_normalized === topicFilter)
    : null;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" asChild className="-ml-3 gap-1.5">
        <Link href="/dashboard">
          <ArrowLeft className="size-4" />
          Back
        </Link>
      </Button>

      <header className="space-y-3">
        <div className="flex items-center gap-2">
          <Trophy className="size-7 text-primary" />
          <h1 className="font-display text-4xl font-extrabold tracking-tighter">
            Leaderboard
          </h1>
        </div>
        <p className="text-muted-foreground text-sm">
          {activeTopic
            ? <>Top players for <strong className="text-foreground">{activeTopic.topic_display}</strong>.</>
            : "Top players by lifetime points (sum of every match's score)."}
        </p>

        {(topics.length > 0 || activeTopic) && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Link
              href="/leaderboard"
              className={cn(
                "text-xs px-3 py-1.5 rounded-full border transition",
                topicFilter
                  ? "border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40"
                  : "border-primary bg-primary text-primary-foreground font-medium"
              )}
            >
              All topics
            </Link>
            {topics.map((t) => {
              const active = t.topic_normalized === topicFilter;
              return (
                <Link
                  key={t.topic_normalized}
                  href={`/leaderboard?topic=${encodeURIComponent(t.topic_normalized)}`}
                  className={cn(
                    "text-xs px-3 py-1.5 rounded-full border transition inline-flex items-center gap-1.5",
                    active
                      ? "border-primary bg-primary text-primary-foreground font-medium"
                      : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40"
                  )}
                >
                  {t.topic_display}
                  <span className={cn("text-[10px] tabular-nums", active ? "opacity-80" : "opacity-60")}>
                    · {t.match_count}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </header>

      {me && (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="p-5 flex items-center gap-4">
            <RankBadge rank={myIdx + 1} highlight />
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">
                Your rank
              </p>
              <p className="font-display text-lg font-bold mt-0.5">
                {me.total_points.toFixed(1)} pts · {me.wins} wins · {me.accuracy_pct}% accuracy
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          {board.length === 0 ? (
            <div className="p-10 text-center text-muted-foreground">
              No completed matches yet. Be the first!
            </div>
          ) : (
            <ol className="divide-y">
              {board.map((r, i) => (
                <LeaderboardRow
                  key={r.user_id}
                  row={r}
                  rank={i + 1}
                  isYou={r.user_id === user.id}
                />
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function LeaderboardRow({
  row,
  rank,
  isYou,
}: {
  row: LeaderRow;
  rank: number;
  isYou: boolean;
}) {
  const initials = (row.display_name ?? row.username).slice(0, 2).toUpperCase();
  return (
    <li className={cn("flex items-center gap-3 px-5 py-3.5", isYou && "bg-primary/5")}>
      <div className="w-8 text-center shrink-0">
        <RankBadge rank={rank} />
      </div>
      <Avatar className="size-9 shrink-0">
        <AvatarFallback
          className={cn(
            "font-medium text-xs",
            isYou ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          )}
        >
          {initials}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium truncate">
            {isYou ? "You" : (row.display_name ?? row.username)}
          </span>
          {!isYou && (
            <span className="text-xs text-muted-foreground">@{row.username}</span>
          )}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5 flex-wrap">
          <span className="inline-flex items-center gap-1">
            <Trophy className="size-3" /> {row.wins} {row.wins === 1 ? "win" : "wins"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Target className="size-3" /> {row.accuracy_pct}%
          </span>
          <span className="inline-flex items-center gap-1">
            <Flame className="size-3" /> {row.matches_played} {row.matches_played === 1 ? "match" : "matches"}
          </span>
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className="font-display text-xl font-bold leading-none tabular-nums">
          {row.total_points.toFixed(0)}
        </p>
        <p className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider font-semibold">
          pts
        </p>
      </div>
    </li>
  );
}

function RankBadge({ rank, highlight }: { rank: number; highlight?: boolean }) {
  if (rank === 1) {
    return (
      <div className="inline-flex items-center justify-center size-7 rounded-full bg-gradient-to-br from-primary to-primary/70 text-primary-foreground">
        <Crown className="size-3.5" />
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div className="inline-flex items-center justify-center size-7 rounded-full bg-gradient-to-br from-chart-2 to-chart-2/70 text-primary-foreground">
        <Medal className="size-3.5" />
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div className="inline-flex items-center justify-center size-7 rounded-full bg-gradient-to-br from-accent to-accent/70 text-accent-foreground">
        <Medal className="size-3.5" />
      </div>
    );
  }
  return (
    <span
      className={cn(
        "inline-block font-display text-base font-bold tabular-nums",
        highlight && rank <= 10 ? "text-primary" : "text-muted-foreground"
      )}
    >
      {rank}
    </span>
  );
}
