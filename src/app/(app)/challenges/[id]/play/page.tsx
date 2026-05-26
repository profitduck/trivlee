import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { isParticipant, lazyCloseIfDue } from "@/lib/matches";
import { validQuestionPredicate } from "@/lib/question-validity";
import { PlayCard } from "./play-card";

interface NextQuestion {
  challenge_id: string;
  topic: string;
  num_questions: number;
  time_per_question_s: number | null;
  total_time_s: number | null;
  timer_mode: string;
  status: string;
  closed_at: string | null;
  play_started_at: string | null;
  position: number;
  question_id: string;
  question_text: string;
  correct_answer: string;
  distractors: string[];
  per_question_format: string;
}

type RenderFormat = "multiple_choice" | "free_text";

async function getNextQuestion(
  challengeId: string,
  userId: string
): Promise<NextQuestion | null> {
  const validQuestion = validQuestionPredicate("q", "qb");
  const { rows } = await query<NextQuestion>(
    `WITH valid_questions AS (
       SELECT
         c.id AS challenge_id, c.topic,
         COUNT(*) OVER()::int AS num_questions,
         c.time_per_question_s, c.total_time_s, c.timer_mode::text AS timer_mode,
         c.status::text AS status, c.closed_at,
         cp.play_started_at,
         ROW_NUMBER() OVER (ORDER BY q.position)::int AS position,
         q.id AS question_id, q.question_text, q.correct_answer,
         q.distractors, q.per_question_format::text AS per_question_format
       FROM challenges c
       JOIN challenge_participants cp ON cp.challenge_id = c.id AND cp.user_id = $2
       JOIN question_sets qs ON qs.challenge_id = c.id
       JOIN questions q ON q.set_id = qs.id
       LEFT JOIN question_bank qb ON qb.id = q.bank_question_id
       WHERE c.id = $1
         AND ${validQuestion}
     )
     SELECT *
       FROM valid_questions vq
      WHERE NOT EXISTS (
        SELECT 1 FROM attempts a
         WHERE a.question_id = vq.question_id AND a.user_id = $2
      )
      ORDER BY vq.position
      LIMIT 1`,
    [challengeId, userId]
  );
  return rows[0] ?? null;
}

async function stampPlayStartedAt(challengeId: string, userId: string): Promise<Date> {
  const { rows } = await query<{ play_started_at: string }>(
    `UPDATE challenge_participants
        SET play_started_at = COALESCE(play_started_at, now())
      WHERE challenge_id = $1 AND user_id = $2
      RETURNING play_started_at`,
    [challengeId, userId]
  );
  return new Date(rows[0].play_started_at);
}

/**
 * Record that the user has seen this question. Used by the bank-draw filter
 * so a user who bails on a match before submitting an answer is still never
 * re-served the same question in a future match.
 *
 * Idempotent via the (user_id, question_id) primary key — refreshing the
 * play page on the same question is a no-op.
 */
async function logQuestionView(questionId: string, userId: string): Promise<void> {
  await query(
    `INSERT INTO question_views (user_id, question_id)
     VALUES ($1, $2)
     ON CONFLICT (user_id, question_id) DO NOTHING`,
    [userId, questionId]
  );
}

export default async function PlayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  await lazyCloseIfDue(id);

  if (!(await isParticipant(id, user.id))) notFound();

  const next = await getNextQuestion(id, user.id);

  if (!next) {
    // No unanswered questions for this user. Either they finished or the match closed.
    const { rows } = await query<{ status: string }>(
      `SELECT status::text AS status FROM challenges WHERE id = $1`,
      [id]
    );
    if (rows.length === 0) notFound();
    if (rows[0].status === "completed") redirect(`/challenges/${id}/results`);
    redirect(`/challenges/${id}`);
  }

  // Match closed mid-play → kick back to detail.
  if (next.closed_at !== null || next.status === "completed" || next.status === "cancelled") {
    redirect(`/challenges/${id}`);
  }

  // Record that the user has now seen this question. Bank-draw filter uses
  // this to never re-serve a question even if they bail before submitting.
  await logQuestionView(next.question_id, user.id);

  // Stamp play_started_at on first question render so timers anchor when the
  // user actually opens their first question, not at match creation. Both
  // the total-time countdown and the stopwatch use this anchor.
  let totalDeadlineMs: number | null = null;
  let stopwatchStartedMs: number | null = null;
  const needsStartStamp = next.total_time_s !== null || next.timer_mode === "stopwatch";
  if (needsStartStamp) {
    const startedAt = next.play_started_at
      ? new Date(next.play_started_at)
      : await stampPlayStartedAt(id, user.id);
    if (next.total_time_s !== null) {
      totalDeadlineMs = startedAt.getTime() + next.total_time_s * 1000;
    }
    if (next.timer_mode === "stopwatch") {
      stopwatchStartedMs = startedAt.getTime();
    }
  }

  // Shuffle distractors with correct answer for MC. Deterministic per question
  // so reloading the page doesn't reshuffle.
  let options: string[] | null = null;
  let renderFormat: RenderFormat = next.per_question_format as RenderFormat;
  if (next.per_question_format === "multiple_choice") {
    const candidateOptions = [next.correct_answer, ...next.distractors];
    if (hasValidMultipleChoiceOptions(candidateOptions)) {
      options = shuffleDeterministic(candidateOptions, next.question_id);
    } else {
      console.warn(
        `[play] falling back to free text for malformed MC question ${next.question_id}`
      );
      renderFormat = "free_text";
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <PlayCard
        key={next.question_id}
        challengeId={id}
        topic={next.topic}
        questionId={next.question_id}
        position={next.position}
        total={next.num_questions}
        questionText={next.question_text}
        perQuestionFormat={renderFormat}
        timeLimitS={next.time_per_question_s}
        totalDeadlineMs={totalDeadlineMs}
        stopwatchStartedMs={stopwatchStartedMs}
        options={options}
      />
    </div>
  );
}

function normalizeOptionForKey(option: string): string {
  return option
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasValidMultipleChoiceOptions(options: string[]): boolean {
  if (options.length !== 4) return false;
  const normalized = options.map(normalizeOptionForKey);
  return normalized.every((option) => option.length > 0) &&
    new Set(normalized).size === normalized.length;
}

function shuffleDeterministic<T>(arr: T[], seed: string): T[] {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const out = [...arr];
  let state = Math.abs(hash) || 1;
  for (let i = out.length - 1; i > 0; i--) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const j = state % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
