"use server";

import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  gradeFreeText,
  gradeMultipleChoice,
  type GradeResult,
} from "@/lib/grading";
import { finalizeAllParticipants, isParticipant } from "@/lib/matches";

export interface SubmitAnswerResult {
  ok: true;
  grade: GradeResult;
  correctAnswer: string;
  sourceHint: string | null;
  isLast: boolean;
}

export type SubmitAnswerError = { ok: false; error: string };

export async function submitAnswer(
  challengeId: string,
  questionId: string,
  userAnswer: string,
  timeTakenMs: number | null
): Promise<SubmitAnswerResult | SubmitAnswerError> {
  const user = await requireUser();

  // Load the question and challenge sanity bits
  const questionRow = await query<{
    id: string;
    challenge_id: string;
    question_text: string;
    correct_answer: string;
    answer_aliases: string[];
    distractors: string[];
    source_hint: string | null;
    per_question_format: string;
    num_questions: number;
    challenger_id: string;
    status: string;
    closed_at: string | null;
    max_players: number | null;
  }>(
    `SELECT
       q.id, qs.challenge_id, q.question_text, q.correct_answer, q.answer_aliases, q.distractors,
       q.source_hint, q.per_question_format::text AS per_question_format,
       c.num_questions, c.challenger_id, c.status::text AS status,
       c.closed_at, c.max_players
     FROM questions q
     JOIN question_sets qs ON qs.id = q.set_id
     JOIN challenges c ON c.id = qs.challenge_id
     WHERE q.id = $1 AND qs.challenge_id = $2`,
    [questionId, challengeId]
  );

  if (questionRow.rows.length === 0) {
    return { ok: false, error: "Question not found." };
  }
  const q = questionRow.rows[0];

  if (!(await isParticipant(challengeId, user.id))) {
    return { ok: false, error: "You aren't a participant in this match." };
  }

  if (q.closed_at !== null || q.status === "completed" || q.status === "cancelled") {
    return { ok: false, error: "This match is closed." };
  }

  // Mark in_progress if still pending
  if (q.status === "pending") {
    await query(
      `UPDATE challenges SET status = 'in_progress', started_at = COALESCE(started_at, now()) WHERE id = $1`,
      [challengeId]
    );
  }

  // Grade
  const grade =
    q.per_question_format === "multiple_choice"
      ? await gradeMultipleChoiceWithFallback({
          question: q.question_text,
          correctAnswer: q.correct_answer,
          aliases: q.answer_aliases ?? [],
          distractors: q.distractors ?? [],
          userAnswer,
        })
      : await gradeFreeText({
          question: q.question_text,
          correctAnswer: q.correct_answer,
          aliases: q.answer_aliases ?? [],
          userAnswer,
        });

  // Insert attempt (idempotent)
  try {
    await query(
      `INSERT INTO attempts
         (challenge_id, question_id, user_id, user_answer, is_correct, score, grade_method, grade_reason, time_taken_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        challengeId,
        questionId,
        user.id,
        userAnswer,
        grade.isCorrect,
        grade.score,
        grade.method,
        grade.reason ?? null,
        timeTakenMs,
      ]
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("attempts_challenge_id_question_id_user_id_key")) throw err;
  }

  // Check completion. A match auto-finalizes ONLY when:
  //   (a) the match has a player cap,
  //   (b) the cap is filled (participants_count === max_players), AND
  //   (c) every participant has answered all questions.
  // Otherwise: the host has to close it manually, or auto_close_at deadline
  // closes it. This prevents premature close when fewer joined than the cap
  // (e.g. cap=10 but only 2 joined and finished — match stays open in case
  // more players want to join).
  const { rows: progress } = await query<{
    my_count: string;
    total_unfinished: string;
    participant_count: string;
  }>(
    `SELECT
       (SELECT COUNT(*) FROM attempts a WHERE a.challenge_id = $1 AND a.user_id = $2) AS my_count,
       (
         SELECT COUNT(*)
         FROM challenge_participants cp
         WHERE cp.challenge_id = $1
           AND (SELECT COUNT(*) FROM attempts a WHERE a.challenge_id = $1 AND a.user_id = cp.user_id) < $3
       ) AS total_unfinished,
       (SELECT COUNT(*) FROM challenge_participants cp WHERE cp.challenge_id = $1) AS participant_count`,
    [challengeId, user.id, q.num_questions]
  );
  const myCount = Number(progress[0].my_count);
  const totalUnfinished = Number(progress[0].total_unfinished);
  const participantCount = Number(progress[0].participant_count);
  const myDone = myCount >= q.num_questions;

  // Auto-finalize only when the cap is fully filled AND everyone is done.
  if (
    myDone &&
    totalUnfinished === 0 &&
    q.max_players !== null &&
    participantCount >= q.max_players
  ) {
    await query(
      `UPDATE challenges
          SET status = 'completed',
              closed_at = COALESCE(closed_at, now()),
              completed_at = COALESCE(completed_at, now())
        WHERE id = $1 AND status <> 'completed'`,
      [challengeId]
    );
    await finalizeAllParticipants(challengeId);
  }

  return {
    ok: true,
    grade,
    correctAnswer: q.correct_answer,
    sourceHint: q.source_hint,
    isLast: myDone,
  };
}

interface MultipleChoiceGradeInput {
  question: string;
  correctAnswer: string;
  aliases: string[];
  distractors: string[];
  userAnswer: string;
}

async function gradeMultipleChoiceWithFallback(
  input: MultipleChoiceGradeInput
): Promise<GradeResult> {
  const mcGrade = gradeMultipleChoice(input.userAnswer, input.correctAnswer);
  if (mcGrade.isCorrect) return mcGrade;

  // If the UI had to render a malformed historical MC row as free text, the
  // submitted answer will not be one of the options. Grade that typed answer
  // with the normal free-text path so aliases and typo tolerance still work.
  const options = [input.correctAnswer, ...input.distractors];
  if (!options.includes(input.userAnswer)) {
    return gradeFreeText(input);
  }

  return mcGrade;
}
