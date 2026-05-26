import Link from "next/link";
import { Plus, Inbox, Trophy, Users, MailOpen, ArrowRight, AlertTriangle, Target, Flame, Crown, Award, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  failStuckGenerationsForUser,
  getPendingInvites,
  sweepAutoCloseForUser,
  type PendingInvite,
} from "@/lib/matches";
import { getUserAchievements } from "@/lib/achievements";

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
  /** Non-null while generation is in flight; "failed:..." after the stuck-sweep flips it. */
  generation_phase: string | null;
}

interface LifetimeStats {
  total_points: number;
  matches_played: number;
  wins: number;
  accuracy_pct: number;
  global_rank: number | null;
}

/**
 * Compute the user's lifetime stats and their global rank in a single query.
 *
 * `wins` counts matches where this user had the top total_score AND there was
 * at least one other participant (single-player matches don't count). The
 * match_max CTE materializes per-match aggregates so we can join against it
 * without nested subqueries that explode when a user has multiple wins.
 *
 * Rank uses RANK() so ties share a rank.
 */
async function getLifetimeStats(userId: string): Promise<LifetimeStats> {
  const { rows } = await query<{
    total_points: string;
    correct: string;
    answered: string;
    matches_played: string;
    wins: string;
    global_rank: string | null;
  }>(
    `WITH match_max AS (
       SELECT challenge_id,
              MAX(total_score) AS max_score,
              COUNT(*)         AS player_count
         FROM results
        GROUP BY challenge_id
     ),
     per_user AS (
       SELECT
         u.id,
         COALESCE(SUM(r.total_score), 0)::numeric AS pts,
         COUNT(r.challenge_id)::int               AS matches_played,
         COALESCE(SUM(r.correct_count), 0)::int   AS correct,
         (SELECT COUNT(*) FROM attempts a
            WHERE a.user_id = u.id AND a.user_answer IS NOT NULL) AS answered,
         COALESCE(SUM(
           CASE WHEN mm.max_score = r.total_score AND mm.player_count > 1
                THEN 1 ELSE 0 END
         ), 0)::int AS wins
       FROM users u
       LEFT JOIN results r    ON r.user_id = u.id
       LEFT JOIN match_max mm ON mm.challenge_id = r.challenge_id
       GROUP BY u.id
     ),
     ranks AS (
       SELECT id, RANK() OVER (ORDER BY pts DESC) AS rnk
         FROM per_user
        WHERE matches_played > 0
     )
     SELECT
       pu.pts            AS total_points,
       pu.correct        AS correct,
       pu.answered       AS answered,
       pu.matches_played,
       pu.wins,
       r.rnk::int        AS global_rank
     FROM per_user pu
     LEFT JOIN ranks r ON r.id = pu.id
     WHERE pu.id = $1`,
    [userId]
  );
  const row = rows[0];
  if (!row) {
    return { total_points: 0, matches_played: 0, wins: 0, accuracy_pct: 0, global_rank: null };
  }
  const correct = Number(row.correct);
  const answered = Number(row.answered);
  return {
    total_points: Number(row.total_points),
    matches_played: Number(row.matches_played),
    wins: Number(row.wins),
    accuracy_pct: answered > 0 ? Math.round((correct / answered) * 100) : 0,
    global_rank: row.global_rank ? Number(row.global_rank) : null,
  };
}

async function getMyChallenges(userId: string): Promise<ChallengeRow[]> {
  const { rows } = await query<ChallengeRow>(
    `SELECT
       c.id, c.topic, c.difficulty_requested, c.num_questions,
       c.mode::text AS mode, c.status::text AS status, c.created_at,
       c.max_players, c.generation_phase,
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
  // Two passive sweeps before fetching the list:
  //   1. Fail any matches stuck in generation > 5 min (Railway-restart casualties)
  //   2. Close any matches past their auto_close_at deadline
  // Both are debounced per-user; no-op when called frequently.
  await Promise.all([
    failStuckGenerationsForUser(user.id),
    sweepAutoCloseForUser(user.id),
  ]);
  const [challenges, pendingInvites, stats, achievements] = await Promise.all([
    getMyChallenges(user.id),
    getPendingInvites(user.id),
    getLifetimeStats(user.id),
    getUserAchievements(user.id),
  ]);

  // Stuck/failed matches are status='cancelled' AND generation_phase starts with
  // 'failed:'. Surface them in their own section so they don't clutter the main
  // matches list and the user knows action is needed.
  const failedGen = challenges.filter(
    (c) => c.generation_phase !== null && c.generation_phase.startsWith("failed:")
  );
  const failedGenIds = new Set(failedGen.map((c) => c.id));
  const activeChallenges = challenges.filter((c) => !failedGenIds.has(c.id));
  const pending = activeChallenges.filter((c) => c.status === "pending");
  const inProgress = activeChallenges.filter((c) => c.status === "in_progress");
  const completed = activeChallenges.filter((c) => c.status === "completed");

  return (
    <div className="space-y-10">
      <section className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm uppercase tracking-wider text-muted-foreground font-semibold">
            {greetingLabel(stats.matches_played)}
          </p>
          <h1 className="font-display text-4xl sm:text-5xl font-extrabold tracking-tighter mt-1">
            {greetingHeadline(user.display_name ?? user.username, stats.matches_played, stats.wins)}
          </h1>
        </div>
        <Button asChild size="lg" className="gap-2 shadow-lg hover:shadow-primary/40 transition-shadow">
          <Link href="/challenges/new">
            <Plus className="size-5" />
            New match
          </Link>
        </Button>
      </section>

      {stats.matches_played > 0 && (
        <section>
          <Link href="/leaderboard" className="block group">
            <Card className="border-2 border-primary/20 bg-gradient-to-br from-primary/5 via-card to-card transition hover:border-primary/40 hover:shadow-lg">
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                    Your stats
                  </p>
                  <span className="text-xs text-primary group-hover:underline inline-flex items-center gap-1">
                    Leaderboard <ArrowRight className="size-3" />
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <StatPill
                    icon={<Crown className="size-4" />}
                    label="Points"
                    value={stats.total_points.toFixed(0)}
                  />
                  <StatPill
                    icon={<Trophy className="size-4" />}
                    label="Wins"
                    value={String(stats.wins)}
                  />
                  <StatPill
                    icon={<Target className="size-4" />}
                    label="Accuracy"
                    value={`${stats.accuracy_pct}%`}
                  />
                  <StatPill
                    icon={<Flame className="size-4" />}
                    label="Matches"
                    value={String(stats.matches_played)}
                  />
                </div>
                {stats.global_rank !== null && (
                  <p className="mt-3 pt-3 border-t text-xs text-muted-foreground">
                    Currently ranked <strong className="text-foreground">#{stats.global_rank}</strong> globally.
                  </p>
                )}
              </CardContent>
            </Card>
          </Link>
        </section>
      )}

      {achievements.unlocked.length > 0 && (
        <section>
          <Link href="/achievements" className="block group">
            <Card className="transition hover:shadow-md hover:border-primary/40">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="size-10 rounded-xl bg-primary/10 grid place-items-center shrink-0">
                  <Award className="size-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-display font-bold">
                    {achievements.unlocked.length} achievement{achievements.unlocked.length === 1 ? "" : "s"} unlocked
                    {achievements.recentlyUnlocked.size > 0 && (
                      <span className="inline-flex items-center gap-1 ml-2 text-xs font-medium text-primary">
                        <Sparkles className="size-3" />
                        new!
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {achievements.locked.length > 0
                      ? `${achievements.locked.length} more to go.`
                      : "You unlocked them all. Wild."}
                  </p>
                </div>
                <ArrowRight className="size-4 text-muted-foreground shrink-0" />
              </CardContent>
            </Card>
          </Link>
        </section>
      )}

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

      {failedGen.length > 0 && (
        <section>
          <h2 className="font-display text-2xl font-bold mb-4 flex items-center gap-2">
            <AlertTriangle className="size-5 text-destructive" />
            Failed generations
            <Badge variant="destructive">{failedGen.length}</Badge>
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            These matches couldn&rsquo;t finish generating. Click one to retry or delete it.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {failedGen.map((c) => (
              <FailedChallengeCard key={c.id} c={c} />
            ))}
          </div>
        </section>
      )}

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
        {activeChallenges.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="p-10 text-center space-y-3">
              <div className="size-14 mx-auto rounded-2xl bg-primary/10 grid place-items-center">
                <Plus className="size-7 text-primary" />
              </div>
              <div className="space-y-1">
                <p className="font-display text-lg font-bold">
                  {pendingInvites.length > 0
                    ? "Join an invite above, or start your own."
                    : "Your dojo awaits."}
                </p>
                <p className="text-sm text-muted-foreground">
                  Pick a topic, dial the difficulty, send the link.
                </p>
              </div>
              <Button asChild size="lg">
                <Link href="/challenges/new">Start your first match</Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {activeChallenges.map((c) => (
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

/**
 * Pick a greeting label + headline based on the user's current state. New
 * users see encouragement; returning users get a slight tease that scales
 * with their wins. Deterministic per day so the page doesn't keep
 * shuffling on every refresh.
 */
function greetingLabel(matchesPlayed: number): string {
  if (matchesPlayed === 0) return "Welcome to Trivlee";
  if (matchesPlayed < 5) return "Welcome back";
  return pickByDay(["Welcome back", "Look who's back", "Ready for round two?", "Game on"]);
}

function greetingHeadline(name: string, matchesPlayed: number, wins: number): string {
  if (matchesPlayed === 0) return `Let's go, ${name}.`;
  if (wins === 0) return `Time for your first win, ${name}?`;
  return pickByDay([
    `Ready for a match, ${name}?`,
    `What's the topic today, ${name}?`,
    `Pick a topic, ${name}.`,
    `Let's see what you've got, ${name}.`,
  ]);
}

function pickByDay<T>(arr: readonly T[]): T {
  // Deterministic by calendar day (UTC) so the page doesn't reshuffle on
  // every render; new options surface as the day rolls over.
  const day = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  return arr[day % arr.length];
}

/**
 * Compact stat tile for the lifetime-stats card. Different shape from
 * StatCard — denser, no card chrome, intended for use inside the gradient
 * highlight card.
 */
function StatPill({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="space-y-1">
      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {icon}
        {label}
      </span>
      <p className="font-display text-2xl font-bold leading-none tabular-nums">{value}</p>
    </div>
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

/**
 * Special render for matches whose generation failed. Visually distinct
 * (destructive border + tint) so the user immediately sees these need action.
 * Click navigates to the detail page where they can retry or delete.
 */
function FailedChallengeCard({ c }: { c: ChallengeRow }) {
  return (
    <Link href={`/challenges/${c.id}`} className="block">
      <Card className="border-destructive/40 bg-destructive/5 transition hover:shadow-md hover:border-destructive/70 h-full">
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-base font-display">{c.topic}</CardTitle>
            <span className="text-xs uppercase tracking-wider px-2 py-0.5 rounded-full bg-destructive/15 text-destructive font-semibold inline-flex items-center gap-1">
              <AlertTriangle className="size-3" /> Failed
            </span>
          </div>
          <CardDescription className="flex items-center gap-3 flex-wrap">
            <span>{c.num_questions} questions · D{c.difficulty_requested}</span>
            <span className="text-destructive/80">Generation didn&rsquo;t finish</span>
          </CardDescription>
        </CardHeader>
      </Card>
    </Link>
  );
}
