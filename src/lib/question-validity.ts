import "server-only";

/**
 * SQL predicate for questions that should count competitively. Historical
 * attempts stay in the database, but questions later proven bad are excluded
 * from score totals, completion counts, and result breakdowns.
 */
export function validQuestionPredicate(questionAlias: string, bankAlias: string): string {
  return `(
    (
      ${bankAlias}.id IS NULL
      OR NOT (
        ${bankAlias}.fact_check_verdict IN ('wrong_answer', 'bad_question')
        AND COALESCE(${bankAlias}.fact_check_confidence, 0) >= 0.85
      )
    )
    AND NOT EXISTS (
      SELECT 1
        FROM question_reports qvalid_reports
       WHERE qvalid_reports.question_id = ${questionAlias}.id
         AND (
           qvalid_reports.status = 'reviewed_removed'
           OR (
             qvalid_reports.ai_fact_check_verdict IN ('wrong_answer', 'bad_question')
             AND COALESCE(qvalid_reports.ai_fact_check_confidence, 0) >= 0.85
           )
         )
    )
  )`;
}
