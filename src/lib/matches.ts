import "server-only";
import { query } from "./db";
import { validQuestionPredicate } from "./question-validity";

export interface Participant {
  user_id: string;
  username: string;
  display_name: string | null;
  is_challenger: boolean;
  joined_at: string;
  answered_count: number;
  total_score: number;
  is_correct_count: number;
}

// Per-user in-process debounce. Dashboard hits this on every load — without
// throttling we'd hammer Postgres for every refresh. In-memory is fine since
// even a missed sweep just gets caught on the next page load (or by the
// per-match lazyCloseIfDue on the detail page).
const SWEEP_DEBOUNCE_MS = 60_000;
const lastSweepAt = new Map<string, number>();

// Stuck-generation sweep: matches whose `after()` background worker died
// (Railway process restart, crashed thread) leave generation_phase set with
// no one to clear it. This sweep marks them failed so the dashboard can
// surface them and the user can retry or delete.
//
// Threshold matches the polling-endpoint detector (5 minutes). Per-user
// debounced like the auto-close sweep.
const STUCK_PHASE_THRESHOLD = "5 minutes";
const lastStuckSweepAt = new Map<string, number>();

const STUCK_ERROR_MSG =
  "Generation timed out. The server may have restarted mid-job — please try again.";

/**
 * Mark any of this user's matches whose generation_phase has been stale for
 * >5 minutes as failed. Sets status='cancelled' (so they drop out of the
 * "pending" stat and list) while keeping the generation_phase as 'failed:...'
 * so the match detail page can render the right card.
 *
 * Returns the number of matches flipped to failed.
 */
export async function failStuckGenerationsForUser(userId: string): Promise<number> {
  const now = Date.now();
  const last = lastStuckSweepAt.get(userId);
  if (last !== undefined && now - last < SWEEP_DEBOUNCE_MS) return 0;
  lastStuckSweepAt.set(userId, now);

  const { rows } = await query<{ id: string }>(
    `UPDATE challenges
        SET generation_phase = $2,
            generation_phase_at = now(),
            status = 'cancelled',
            knowledge_warning = COALESCE(knowledge_warning, $3)
      WHERE challenger_id = $1
        AND generation_phase IS NOT NULL
        AND generation_phase NOT LIKE 'failed:%'
        AND generation_phase_at < now() - interval '${STUCK_PHASE_THRESHOLD}'
      RETURNING id`,
    [userId, `failed:${STUCK_ERROR_MSG}`, STUCK_ERROR_MSG]
  );
  if (rows.length > 0) {
    console.warn(
      `[matches] failed ${rows.length} stuck generation(s) for user ${userId}: ${rows.map((r) => r.id).join(", ")}`
    );
  }
  return rows.length;
}

/**
 * Sweep all open matches the user participates in for past auto_close_at
 * deadlines. Runs on dashboard load so abandoned matches close without needing
 * a visit to each individual match page. Returns the number of matches closed
 * (0 when the call was debounced).
 */
export async function sweepAutoCloseForUser(userId: string): Promise<number> {
  const now = Date.now();
  const last = lastSweepAt.get(userId);
  if (last !== undefined && now - last < SWEEP_DEBOUNCE_MS) return 0;
  lastSweepAt.set(userId, now);

  const { rows } = await query<{ id: string }>(
    `UPDATE challenges c
        SET status = 'completed',
            closed_at = now(),
            completed_at = COALESCE(c.completed_at, now())
      FROM challenge_participants cp
      WHERE cp.challenge_id = c.id
        AND cp.user_id = $1
        AND c.closed_at IS NULL
        AND c.auto_close_at IS NOT NULL
        AND c.auto_close_at < now()
        AND c.status <> 'completed'
      RETURNING c.id`,
    [userId]
  );
  for (const r of rows) {
    await finalizeAllParticipants(r.id);
  }
  return rows.length;
}

/**
 * Lazy close: if a match is past its auto_close_at, close it and finalize results.
 * Returns true if it just closed (caller may want to refresh).
 */
export async function lazyCloseIfDue(challengeId: string): Promise<boolean> {
  const { rows } = await query<{ id: string }>(
    `UPDATE challenges
        SET status = 'completed',
            closed_at = now(),
            completed_at = COALESCE(completed_at, now())
      WHERE id = $1
        AND closed_at IS NULL
        AND auto_close_at IS NOT NULL
        AND auto_close_at < now()
        AND status <> 'completed'
      RETURNING id`,
    [challengeId]
  );
  if (rows.length === 0) return false;
  await finalizeAllParticipants(challengeId);
  return true;
}

/**
 * Manually close a match. Caller must verify the user is the challenger.
 */
export async function closeChallenge(challengeId: string): Promise<void> {
  await query(
    `UPDATE challenges
        SET status = 'completed',
            closed_at = now(),
            completed_at = COALESCE(completed_at, now())
      WHERE id = $1 AND status <> 'completed'`,
    [challengeId]
  );
  await finalizeAllParticipants(challengeId);
}

/**
 * Write/update a `results` row for every participant. Used both at close time
 * (with partial credit for non-finishers) and at normal match-end.
 */
export async function finalizeAllParticipants(challengeId: string): Promise<void> {
  const validAttempt = `a.id IS NOT NULL AND q.id IS NOT NULL AND ${validQuestionPredicate("q", "qb")}`;
  await query(
    `INSERT INTO results (challenge_id, user_id, total_score, correct_count, total_time_ms, completed_at)
     SELECT cp.challenge_id, cp.user_id,
            COALESCE(SUM(CASE WHEN ${validAttempt} THEN a.score ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN ${validAttempt} AND a.is_correct THEN 1 ELSE 0 END), 0),
            COALESCE(SUM(CASE WHEN ${validAttempt} THEN a.time_taken_ms ELSE 0 END), 0),
            now()
       FROM challenge_participants cp
       LEFT JOIN attempts a
         ON a.challenge_id = cp.challenge_id AND a.user_id = cp.user_id
       LEFT JOIN questions q
         ON q.id = a.question_id
       LEFT JOIN question_bank qb
         ON qb.id = q.bank_question_id
      WHERE cp.challenge_id = $1
      GROUP BY cp.challenge_id, cp.user_id
        ON CONFLICT (challenge_id, user_id) DO UPDATE
        SET total_score = EXCLUDED.total_score,
            correct_count = EXCLUDED.correct_count,
            total_time_ms = EXCLUDED.total_time_ms,
            completed_at = EXCLUDED.completed_at`,
    [challengeId]
  );
}

/**
 * Is the user a participant in this match?
 */
export async function isParticipant(
  challengeId: string,
  userId: string
): Promise<boolean> {
  const { rows } = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM challenge_participants
        WHERE challenge_id = $1 AND user_id = $2
     ) AS "exists"`,
    [challengeId, userId]
  );
  return rows[0]?.exists === true;
}

/**
 * Try to add a user as a participant. Returns:
 *   { ok: true } — joined (or already was)
 *   { ok: false, reason: ... } — couldn't join
 */
export async function tryJoinChallenge(
  challengeId: string,
  userId: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { rows } = await query<{
    status: string;
    closed_at: string | null;
    max_players: number | null;
    participant_count: string;
    already_in: boolean;
  }>(
    `SELECT
       c.status::text AS status,
       c.closed_at,
       c.max_players,
       (SELECT COUNT(*) FROM challenge_participants cp WHERE cp.challenge_id = c.id) AS participant_count,
       EXISTS (SELECT 1 FROM challenge_participants cp WHERE cp.challenge_id = c.id AND cp.user_id = $2) AS already_in
     FROM challenges c
     WHERE c.id = $1`,
    [challengeId, userId]
  );
  if (rows.length === 0) return { ok: false, reason: "Match not found." };
  const row = rows[0];

  if (row.already_in) return { ok: true };

  if (row.closed_at !== null || row.status === "completed" || row.status === "cancelled") {
    return { ok: false, reason: "This match is already closed." };
  }

  if (row.max_players !== null) {
    const count = Number(row.participant_count);
    if (count >= row.max_players) {
      return { ok: false, reason: `This match is full (${row.max_players} players).` };
    }
  }

  await query(
    `INSERT INTO challenge_participants (challenge_id, user_id, is_challenger)
     VALUES ($1, $2, false)
     ON CONFLICT DO NOTHING`,
    [challengeId, userId]
  );
  return { ok: true };
}

/**
 * Record (or refresh) that a user looked at a /join/[token] page without joining.
 * Surfaces on their dashboard as a pending invite.
 */
export async function recordInviteView(
  userId: string,
  challengeId: string
): Promise<void> {
  await query(
    `INSERT INTO invite_views (user_id, challenge_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, challenge_id)
       DO UPDATE SET last_viewed_at = now()`,
    [userId, challengeId]
  );
}

/**
 * Clear an invite_view once the user actually joins, so it stops showing as pending.
 */
export async function clearInviteView(
  userId: string,
  challengeId: string
): Promise<void> {
  await query(
    `DELETE FROM invite_views WHERE user_id = $1 AND challenge_id = $2`,
    [userId, challengeId]
  );
}

export interface PendingInvite {
  challenge_id: string;
  invite_token: string;
  topic: string;
  difficulty_requested: number;
  num_questions: number;
  format: string;
  mode: string;
  max_players: number | null;
  participant_count: number;
  challenger_username: string;
  challenger_display: string | null;
  last_viewed_at: string;
  auto_close_at: string | null;
}

/**
 * Pending invites for a user: matches they viewed but didn't join, that are
 * still open and accepting players. Excludes matches they're already in.
 */
export async function getPendingInvites(userId: string): Promise<PendingInvite[]> {
  const { rows } = await query<PendingInvite & { participant_count: string }>(
    `SELECT
       c.id AS challenge_id, c.invite_token, c.topic, c.difficulty_requested,
       c.num_questions, c.format::text AS format, c.mode::text AS mode,
       c.max_players, c.auto_close_at,
       u.username AS challenger_username, u.display_name AS challenger_display,
       iv.last_viewed_at,
       (SELECT COUNT(*) FROM challenge_participants cp WHERE cp.challenge_id = c.id) AS participant_count
     FROM invite_views iv
     JOIN challenges c ON c.id = iv.challenge_id
     JOIN users u ON u.id = c.challenger_id
     WHERE iv.user_id = $1
       AND c.closed_at IS NULL
       AND c.status NOT IN ('completed', 'cancelled')
       AND NOT EXISTS (
         SELECT 1 FROM challenge_participants cp
          WHERE cp.challenge_id = c.id AND cp.user_id = $1
       )
       AND (
         c.max_players IS NULL OR
         (SELECT COUNT(*) FROM challenge_participants cp WHERE cp.challenge_id = c.id) < c.max_players
       )
     ORDER BY iv.last_viewed_at DESC
     LIMIT 20`,
    [userId]
  );
  return rows.map((r) => ({ ...r, participant_count: Number(r.participant_count) }));
}

/**
 * Fetch all participants in a match, ordered by score desc (for leaderboard).
 */
export async function getParticipants(challengeId: string): Promise<Participant[]> {
  const validQuestion = validQuestionPredicate("q", "qb");
  const { rows } = await query<{
    user_id: string;
    username: string;
    display_name: string | null;
    is_challenger: boolean;
    joined_at: string;
    answered_count: string;
    total_score: string;
    is_correct_count: string;
  }>(
    `SELECT
       cp.user_id, u.username, u.display_name, cp.is_challenger, cp.joined_at,
       COALESCE((
         SELECT COUNT(*)
           FROM attempts a
           JOIN questions q ON q.id = a.question_id
           LEFT JOIN question_bank qb ON qb.id = q.bank_question_id
          WHERE a.challenge_id = cp.challenge_id
            AND a.user_id = cp.user_id
            AND ${validQuestion}
       ), 0) AS answered_count,
       COALESCE((
         SELECT SUM(a.score)
           FROM attempts a
           JOIN questions q ON q.id = a.question_id
           LEFT JOIN question_bank qb ON qb.id = q.bank_question_id
          WHERE a.challenge_id = cp.challenge_id
            AND a.user_id = cp.user_id
            AND ${validQuestion}
       ), 0) AS total_score,
       COALESCE((
         SELECT SUM(CASE WHEN a.is_correct THEN 1 ELSE 0 END)
           FROM attempts a
           JOIN questions q ON q.id = a.question_id
           LEFT JOIN question_bank qb ON qb.id = q.bank_question_id
          WHERE a.challenge_id = cp.challenge_id
            AND a.user_id = cp.user_id
            AND ${validQuestion}
       ), 0) AS is_correct_count
     FROM challenge_participants cp
     JOIN users u ON u.id = cp.user_id
     WHERE cp.challenge_id = $1
     ORDER BY total_score DESC, answered_count DESC, cp.joined_at ASC`,
    [challengeId]
  );
  return rows.map((r) => ({
    ...r,
    answered_count: Number(r.answered_count),
    total_score: Number(r.total_score),
    is_correct_count: Number(r.is_correct_count),
  }));
}
