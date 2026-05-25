-- Add per-participant play start time so the whole-quiz timer can compute
-- remaining seconds from a stable anchor (set when the user opens the first
-- question, not when the match was created).
ALTER TABLE challenge_participants
  ADD COLUMN play_started_at TIMESTAMPTZ;

-- Drop the deprecated single-opponent column. The participants table fully
-- replaces it; we backfilled it in migration 0002 and no production code reads
-- it anymore. Indexes that referenced it go too.
DROP INDEX IF EXISTS idx_challenges_opponent;
ALTER TABLE challenges
  DROP COLUMN IF EXISTS opponent_id;
