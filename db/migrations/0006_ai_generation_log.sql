-- Rate-limit ledger: one row per real-model AI call. Used by the atomic
-- reserve-or-reject query so concurrent requests can't both pass the count
-- check. Independent of question_sets so we still count attempts that
-- ultimately fail (a failed API call still cost us).

CREATE TABLE ai_generation_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_generation_log_user_recent
  ON ai_generation_log(user_id, created_at DESC);
