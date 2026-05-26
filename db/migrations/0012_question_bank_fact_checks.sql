-- Persistent fact-check verdicts for reusable generated questions.
-- This lets us audit the existing bank and prevent bad questions from being
-- reused even when nobody has reported them yet.

ALTER TABLE question_bank
  ADD COLUMN fact_check_verdict report_fact_check_verdict NOT NULL DEFAULT 'pending',
  ADD COLUMN fact_check_confidence NUMERIC(3, 2),
  ADD COLUMN fact_check_summary TEXT,
  ADD COLUMN fact_check_evidence TEXT,
  ADD COLUMN fact_check_corrected_answer TEXT,
  ADD COLUMN fact_check_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN fact_check_model TEXT,
  ADD COLUMN fact_checked_at TIMESTAMPTZ;

CREATE INDEX idx_question_bank_fact_check_queue
  ON question_bank(fact_check_verdict, created_at)
  WHERE fact_check_verdict IN ('pending', 'error');

CREATE INDEX idx_question_bank_fact_check_bad
  ON question_bank(fact_check_verdict, fact_check_confidence DESC)
  WHERE fact_check_verdict IN ('wrong_answer', 'bad_question');
