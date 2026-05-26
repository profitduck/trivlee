-- Track which questions each user has actually SEEN in the play UI (not just
-- answered). The bank-draw filter previously excluded only ANSWERED questions
-- — but a user who opened the play page, glanced at question N, and bailed
-- before submitting could still be re-served question N in a future match.
--
-- This table is upserted on every play-page render. The (user_id, question_id)
-- primary key dedupes naturally — viewing the same question twice is still
-- one row.

CREATE TABLE question_views (
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  viewed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id)
);

-- The bank-draw filter joins question_views → questions → question_bank
-- by question.bank_question_id. We want fast lookups by user_id, with the
-- question_id available for the join. The PK (user_id, question_id) serves
-- this directly — no extra index needed.

-- Also need an index on questions(bank_question_id) so the JOIN from
-- question_views to question_bank doesn't full-scan. attempts has a similar
-- access pattern and already benefits from this if it exists; create it
-- conditionally so we don't fail on a fresh DB that's already added one.
CREATE INDEX IF NOT EXISTS idx_questions_bank_lookup
  ON questions(bank_question_id) WHERE bank_question_id IS NOT NULL;
