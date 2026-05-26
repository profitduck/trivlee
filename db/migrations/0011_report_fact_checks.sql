-- AI fact-check verdicts for player-reported questions.
-- Reports stay open for admin review, but high-confidence failures can hide
-- bank entries before they are reused in another match.

CREATE TYPE report_fact_check_verdict AS ENUM (
  'pending',
  'supported',
  'wrong_answer',
  'bad_question',
  'uncertain',
  'error'
);

ALTER TABLE question_reports
  ADD COLUMN ai_fact_check_verdict report_fact_check_verdict NOT NULL DEFAULT 'pending',
  ADD COLUMN ai_fact_check_confidence NUMERIC(3, 2),
  ADD COLUMN ai_fact_check_summary TEXT,
  ADD COLUMN ai_fact_check_evidence TEXT,
  ADD COLUMN ai_fact_check_corrected_answer TEXT,
  ADD COLUMN ai_fact_check_sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN ai_fact_check_model TEXT,
  ADD COLUMN ai_fact_checked_at TIMESTAMPTZ;

CREATE INDEX idx_question_reports_ai_fact_check
  ON question_reports(ai_fact_check_verdict, created_at DESC)
  WHERE status = 'open';

-- Known-bad generated question: Nick and Jess break up in S03E20
-- "Mars Landing", not at the end of S03E23 "Cruise", and the moving-out
-- premise is not a citeable source fact.
UPDATE question_bank
   SET hidden = true
 WHERE hidden = false
   AND question_text = 'At the end of Season 3, which couple breaks up, with one of them moving out of the loft?';
