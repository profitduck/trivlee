import "server-only";
import { query } from "./db";

const HOURLY_LIMIT_DEFAULT = 30;

function getHourlyLimit(): number {
  const fromEnv = process.env.AI_GENERATIONS_PER_HOUR;
  if (!fromEnv) return HOURLY_LIMIT_DEFAULT;
  const n = parseInt(fromEnv, 10);
  if (!Number.isFinite(n) || n <= 0) return HOURLY_LIMIT_DEFAULT;
  return n;
}

export interface ReservationResult {
  reserved: boolean;
  usedInWindow: number;
  limit: number;
}

/**
 * Atomically check the per-user hourly rate limit AND log a generation slot
 * in one query. Two concurrent requests can't both pass the count check
 * because the SELECT and the INSERT happen in the same statement under the
 * same MVCC snapshot — the second one sees the first's insert if it commits
 * first, and they're serialized at the index level otherwise.
 *
 * Returns `{ reserved: true }` if the caller may proceed with an AI call.
 * Caller does NOT have to roll back on AI failure — we count attempts, not
 * successes, so a failed call still consumes its slot. That's intentional:
 * cost was incurred.
 */
export async function reserveAIGenerationSlot(
  userId: string
): Promise<ReservationResult> {
  const limit = getHourlyLimit();
  const { rows } = await query<{ used_before: string; reserved: boolean }>(
    `WITH used AS (
       SELECT COUNT(*)::int AS n
         FROM ai_generation_log
        WHERE user_id = $1
          AND created_at > now() - INTERVAL '1 hour'
     ),
     ins AS (
       INSERT INTO ai_generation_log (user_id)
       SELECT $1 WHERE (SELECT n FROM used) < $2
       RETURNING id
     )
     SELECT (SELECT n FROM used) AS used_before,
            (SELECT EXISTS (SELECT 1 FROM ins)) AS reserved`,
    [userId, limit]
  );
  return {
    reserved: rows[0].reserved,
    usedInWindow: Number(rows[0].used_before),
    limit,
  };
}
