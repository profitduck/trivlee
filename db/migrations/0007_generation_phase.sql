-- Real-time generation progress: the challenge row carries the in-flight phase
-- so the client can poll for real status instead of guessing from elapsed time.
--
-- NULL  → not currently generating (either bank-only or already done)
-- text  → 'starting' | 'drafting' | 'verifying' | 'backfilling' | 'saving' | 'failed:<msg>'
--
-- phase_at lets us detect stuck generations: if the row hasn't been touched in
-- 10+ minutes the server worker probably died, and the UI can surface a retry.

ALTER TABLE challenges
  ADD COLUMN generation_phase    TEXT,
  ADD COLUMN generation_phase_at TIMESTAMPTZ;

CREATE INDEX idx_challenges_generation_phase
  ON challenges(generation_phase_at DESC)
  WHERE generation_phase IS NOT NULL;
