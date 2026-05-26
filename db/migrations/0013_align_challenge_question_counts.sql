-- Older partial generations could persist fewer questions than requested while
-- challenges.num_questions still showed the requested number. Align historical
-- rows to the number of stored questions so progress/summary UI is truthful.

WITH stored_counts AS (
  SELECT qs.challenge_id, COUNT(q.id)::int AS stored_count
    FROM question_sets qs
    JOIN questions q ON q.set_id = qs.id
   GROUP BY qs.challenge_id
)
UPDATE challenges c
   SET num_questions = sc.stored_count
  FROM stored_counts sc
 WHERE c.id = sc.challenge_id
   AND sc.stored_count > 0
   AND c.num_questions <> sc.stored_count;
