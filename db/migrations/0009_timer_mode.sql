-- Add explicit timer_mode so we can distinguish "off" (no timer at all) from
-- "stopwatch" (counting up, no cap, used as a tiebreaker). Previous design
-- inferred the mode from time_per_question_s and total_time_s being null,
-- which conflated "off" and "stopwatch".
--
-- 'off':          no timer in the UI; ties at top of leaderboard stay tied.
-- 'per_question': per-question countdown using time_per_question_s.
-- 'total':        whole-quiz countdown using total_time_s.
-- 'stopwatch':    UI shows a count-up timer; ties broken by total_time_ms.

CREATE TYPE timer_mode AS ENUM ('off', 'per_question', 'total', 'stopwatch');

ALTER TABLE challenges
  ADD COLUMN timer_mode timer_mode NOT NULL DEFAULT 'off';

-- Backfill: derive from existing columns. Order matters — per_question and
-- total are checked before defaulting to off.
UPDATE challenges SET timer_mode =
  CASE
    WHEN time_per_question_s IS NOT NULL THEN 'per_question'::timer_mode
    WHEN total_time_s IS NOT NULL        THEN 'total'::timer_mode
    ELSE 'off'::timer_mode
  END;
