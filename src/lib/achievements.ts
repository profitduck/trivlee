import "server-only";
import { query } from "./db";

export interface Achievement {
  id: string;
  name: string;
  description: string;
  /** Lucide icon name. Renderer maps these to actual icon components. */
  icon: string;
  /** Tier shown next to the achievement — common / rare / legendary. */
  tier: "common" | "rare" | "legendary";
}

/**
 * All achievement definitions in one place. The order here is the display
 * order on the /achievements page. Each id is stable so we can later add
 * "newly unlocked" notifications without breaking anything.
 */
export const ACHIEVEMENTS: Achievement[] = [
  {
    id: "first_steps",
    name: "First Steps",
    description: "Complete your first match.",
    icon: "Sparkles",
    tier: "common",
  },
  {
    id: "marathoner_10",
    name: "Marathoner",
    description: "Play 10 matches.",
    icon: "Flame",
    tier: "common",
  },
  {
    id: "marathoner_50",
    name: "Iron Will",
    description: "Play 50 matches.",
    icon: "Mountain",
    tier: "rare",
  },
  {
    id: "globetrotter_5",
    name: "Globetrotter",
    description: "Play matches on 5 different topics.",
    icon: "Globe",
    tier: "common",
  },
  {
    id: "topic_master_5",
    name: "Topic Master",
    description: "Play 5 matches on the same topic.",
    icon: "BookOpen",
    tier: "rare",
  },
  {
    id: "first_win",
    name: "First Victory",
    description: "Win your first multi-player match.",
    icon: "Trophy",
    tier: "common",
  },
  {
    id: "hot_streak_3",
    name: "Hot Streak",
    description: "Win 3 multi-player matches in a row.",
    icon: "Zap",
    tier: "rare",
  },
  {
    id: "sharpshooter",
    name: "Sharpshooter",
    description: "Get 100% on a multi-player match.",
    icon: "Target",
    tier: "rare",
  },
  {
    id: "speed_demon",
    name: "Speed Demon",
    description: "Win a stopwatch match in under 2 minutes.",
    icon: "Timer",
    tier: "rare",
  },
  {
    id: "points_500",
    name: "Quiz Whiz",
    description: "Reach 500 lifetime points.",
    icon: "Crown",
    tier: "common",
  },
  {
    id: "points_2000",
    name: "Grand Champion",
    description: "Reach 2,000 lifetime points.",
    icon: "Award",
    tier: "legendary",
  },
  {
    id: "polyglot",
    name: "Polyglot",
    description: "Play matches on 15 different topics.",
    icon: "BookOpen",
    tier: "legendary",
  },
];

export interface UserAchievementState {
  unlocked: Achievement[];
  locked: Achievement[];
  /** Achievement IDs unlocked in the last 24 hours. Useful for "new!" badges. */
  recentlyUnlocked: Set<string>;
}

/**
 * Aggregated per-user stats used by the achievement evaluators. One query
 * to compute everything we need; achievements then check thresholds locally.
 */
interface UserAggregates {
  total_matches: number;
  total_points: number;
  unique_topics: number;
  max_same_topic: number;
  perfect_multiplayer_matches: number;
  has_multiplayer_win: boolean;
  longest_win_streak: number;
  fast_stopwatch_win_ms: number | null;
  first_match_completed_at: string | null;
  last_match_completed_at: string | null;
}

async function getUserAggregates(userId: string): Promise<UserAggregates> {
  // Pull a wide row of per-user metrics in one round-trip. Each subquery is
  // independent so the planner parallelizes them where it can.
  const { rows } = await query<{
    total_matches: string;
    total_points: string;
    unique_topics: string;
    max_same_topic: string;
    perfect_multiplayer_matches: string;
    has_multiplayer_win: boolean;
    fast_stopwatch_win_ms: number | null;
    first_match_completed_at: string | null;
    last_match_completed_at: string | null;
  }>(
    `WITH my_results AS (
       SELECT r.challenge_id, r.total_score, r.correct_count, r.total_time_ms,
              r.completed_at, c.topic_normalized, c.num_questions, c.timer_mode,
              (SELECT MAX(other.total_score) FROM results other WHERE other.challenge_id = r.challenge_id) AS top_score,
              (SELECT COUNT(*) FROM results r3 WHERE r3.challenge_id = r.challenge_id) AS player_count
         FROM results r
         JOIN challenges c ON c.id = r.challenge_id
        WHERE r.user_id = $1
     ),
     topic_counts AS (
       SELECT topic_normalized, COUNT(*) AS n
         FROM my_results
        GROUP BY topic_normalized
     )
     SELECT
       (SELECT COUNT(*) FROM my_results)::text                                   AS total_matches,
       (SELECT COALESCE(SUM(total_score), 0) FROM my_results)::text              AS total_points,
       (SELECT COUNT(*) FROM topic_counts)::text                                 AS unique_topics,
       (SELECT COALESCE(MAX(n), 0) FROM topic_counts)::text                      AS max_same_topic,
       (SELECT COUNT(*) FROM my_results
         WHERE correct_count = num_questions AND player_count > 1)::text         AS perfect_multiplayer_matches,
       EXISTS(SELECT 1 FROM my_results
               WHERE total_score = top_score AND player_count > 1)               AS has_multiplayer_win,
       (SELECT MIN(total_time_ms) FROM my_results
         WHERE total_score = top_score AND player_count > 1
           AND timer_mode = 'stopwatch')                                         AS fast_stopwatch_win_ms,
       (SELECT MIN(completed_at) FROM my_results)::text                          AS first_match_completed_at,
       (SELECT MAX(completed_at) FROM my_results)::text                          AS last_match_completed_at`,
    [userId]
  );
  const r = rows[0];

  // Compute longest win-streak (consecutive multi-player wins in chronological
  // order). Pulled in a separate query because it doesn't fit cleanly into the
  // aggregates above.
  const { rows: winRows } = await query<{ won: boolean }>(
    `SELECT (r.total_score = (
              SELECT MAX(total_score) FROM results r2 WHERE r2.challenge_id = r.challenge_id
            ) AND (
              SELECT COUNT(*) FROM results r3 WHERE r3.challenge_id = r.challenge_id
            ) > 1) AS won
       FROM results r
      WHERE r.user_id = $1
      ORDER BY r.completed_at ASC`,
    [userId]
  );
  let longestStreak = 0;
  let current = 0;
  for (const w of winRows) {
    if (w.won) {
      current++;
      if (current > longestStreak) longestStreak = current;
    } else {
      current = 0;
    }
  }

  return {
    total_matches: Number(r?.total_matches ?? 0),
    total_points: Number(r?.total_points ?? 0),
    unique_topics: Number(r?.unique_topics ?? 0),
    max_same_topic: Number(r?.max_same_topic ?? 0),
    perfect_multiplayer_matches: Number(r?.perfect_multiplayer_matches ?? 0),
    has_multiplayer_win: Boolean(r?.has_multiplayer_win),
    longest_win_streak: longestStreak,
    fast_stopwatch_win_ms: r?.fast_stopwatch_win_ms ? Number(r.fast_stopwatch_win_ms) : null,
    first_match_completed_at: r?.first_match_completed_at ?? null,
    last_match_completed_at: r?.last_match_completed_at ?? null,
  };
}

/**
 * Check which achievements the given user has unlocked. Returns sorted
 * unlocked + locked lists plus a recently-unlocked set for "new!" hints.
 *
 * Achievement state is computed entirely from existing tables — there's no
 * achievement_unlocks ledger. That keeps the model simple but means we
 * approximate "recently unlocked" by looking at the user's last completed
 * match: if it was within 24 hours, any achievement they hold MIGHT have
 * just unlocked. Good enough for surfacing fresh wins without needing a
 * new table.
 */
export async function getUserAchievements(userId: string): Promise<UserAchievementState> {
  const agg = await getUserAggregates(userId);
  const unlockedIds = new Set<string>();

  if (agg.total_matches >= 1) unlockedIds.add("first_steps");
  if (agg.total_matches >= 10) unlockedIds.add("marathoner_10");
  if (agg.total_matches >= 50) unlockedIds.add("marathoner_50");
  if (agg.unique_topics >= 5) unlockedIds.add("globetrotter_5");
  if (agg.unique_topics >= 15) unlockedIds.add("polyglot");
  if (agg.max_same_topic >= 5) unlockedIds.add("topic_master_5");
  if (agg.has_multiplayer_win) unlockedIds.add("first_win");
  if (agg.longest_win_streak >= 3) unlockedIds.add("hot_streak_3");
  if (agg.perfect_multiplayer_matches >= 1) unlockedIds.add("sharpshooter");
  if (agg.fast_stopwatch_win_ms !== null && agg.fast_stopwatch_win_ms < 120_000)
    unlockedIds.add("speed_demon");
  if (agg.total_points >= 500) unlockedIds.add("points_500");
  if (agg.total_points >= 2000) unlockedIds.add("points_2000");

  const unlocked = ACHIEVEMENTS.filter((a) => unlockedIds.has(a.id));
  const locked = ACHIEVEMENTS.filter((a) => !unlockedIds.has(a.id));

  // "Recently" = the user's last match was in the last 24h. We don't track
  // per-achievement unlock timestamps, so this is an upper bound: every
  // currently-unlocked achievement gets the "new!" hint if the user just
  // finished a match. Cheap heuristic; can promote to a real ledger later.
  const recentlyUnlocked = new Set<string>();
  if (agg.last_match_completed_at) {
    const ageMs = Date.now() - new Date(agg.last_match_completed_at).getTime();
    if (ageMs < 24 * 60 * 60 * 1000) {
      for (const id of unlockedIds) recentlyUnlocked.add(id);
    }
  }

  return { unlocked, locked, recentlyUnlocked };
}
