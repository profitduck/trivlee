"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import {
  AIGenerationError,
  generateQuestions,
  normalizeTopic,
  type PipelinePhase,
} from "@/lib/ai/generator";
import { reserveAIGenerationSlot } from "@/lib/rate-limit";
import {
  addToBank,
  drawFromBank,
  markBankUse,
  type BankDraw,
} from "@/lib/ai/question-bank";
import type {
  ChallengeFormat,
  GeneratedQuestion,
  PerQuestionFormat,
} from "@/lib/ai/types";

/**
 * Visible generation phases for the client polling endpoint. The pipeline
 * stages (researching/validating/writing) match what the 3-stage pipeline is
 * actually doing on the server. `starting` and `saving` bookend the pipeline
 * (the lightweight setup before stage 1, and the DB writes after stage 3).
 */
export type GenerationPhase =
  | "starting"
  | "researching"
  | "validating"
  | "writing"
  | "saving";

async function setPhase(
  challengeId: string,
  phase: GenerationPhase | null,
  errorMsg?: string
) {
  // `failed:<message>` is the convention for surfacing errors via the same column.
  const value = phase === null && errorMsg ? `failed:${errorMsg}` : phase;
  await query(
    `UPDATE challenges
       SET generation_phase = $2,
           generation_phase_at = now()
     WHERE id = $1`,
    [challengeId, value]
  );
}

export type TimerMode = "off" | "per_question" | "total" | "stopwatch";

interface CreateChallengeInput {
  topic: string;
  difficulty: number;
  numQuestions: number;
  format: ChallengeFormat;
  mode: "async" | "live";
  timerMode: TimerMode;
  timePerQuestionS: number | null;
  totalTimeS: number | null;
  maxPlayers: number | null;
  autoCloseHours: number | null;
}

function generateInviteToken(): string {
  return randomBytes(16).toString("base64url");
}

function takeBalancedMixedBankDraw(
  multipleChoice: BankDraw,
  freeText: BankDraw,
  count: number
): BankDraw {
  const questions: GeneratedQuestion[] = [];
  const bankIds: string[] = [];
  const append = (draw: BankDraw, index: number) => {
    questions.push(draw.questions[index]);
    bankIds.push(draw.bankIds[index]);
  };

  let mcIndex = 0;
  let ftIndex = 0;
  const primaryMcCount = Math.min(Math.ceil(count / 2), multipleChoice.questions.length);
  const primaryFtCount = Math.min(Math.floor(count / 2), freeText.questions.length);

  while (questions.length < count && (mcIndex < primaryMcCount || ftIndex < primaryFtCount)) {
    if (mcIndex < primaryMcCount && questions.length < count) {
      append(multipleChoice, mcIndex);
      mcIndex++;
    }
    if (ftIndex < primaryFtCount && questions.length < count) {
      append(freeText, ftIndex);
      ftIndex++;
    }
  }

  while (
    questions.length < count &&
    (mcIndex < multipleChoice.questions.length || ftIndex < freeText.questions.length)
  ) {
    if (mcIndex < multipleChoice.questions.length && questions.length < count) {
      append(multipleChoice, mcIndex);
      mcIndex++;
    }
    if (ftIndex < freeText.questions.length && questions.length < count) {
      append(freeText, ftIndex);
      ftIndex++;
    }
  }

  return { questions, bankIds };
}

export async function createChallenge(input: CreateChallengeInput) {
  const user = await requireUser();

  const topic = input.topic.trim();
  if (topic.length < 2) {
    return { error: "Topic must be at least 2 characters." };
  }

  const topicNormalized = normalizeTopic(topic);
  const inviteToken = generateInviteToken();
  const autoCloseAt = input.autoCloseHours
    ? new Date(Date.now() + input.autoCloseHours * 3600 * 1000)
    : null;

  // ─── Phase A: try to fill from the question bank ─────────────────────────
  // Mixed draws from both per-question formats. Fetching up to the full count
  // for each side is still far cheaper than an AI call and lets the bank avoid
  // generation even if one format has sparse coverage.
  let bankQuestions: GeneratedQuestion[] = [];
  let bankIds: string[] = [];
  if (input.format === "mixed") {
    const [multipleChoice, freeText] = await Promise.all([
      drawFromBank(
        topicNormalized,
        input.difficulty,
        "multiple_choice",
        input.numQuestions,
        user.id
      ),
      drawFromBank(
        topicNormalized,
        input.difficulty,
        "free_text",
        input.numQuestions,
        user.id
      ),
    ]);
    const drawn = takeBalancedMixedBankDraw(multipleChoice, freeText, input.numQuestions);
    bankQuestions = drawn.questions;
    bankIds = drawn.bankIds;
  } else {
    const pqf = input.format as PerQuestionFormat;
    const drawn = await drawFromBank(
      topicNormalized,
      input.difficulty,
      pqf,
      input.numQuestions,
      user.id
    );
    bankQuestions = drawn.questions;
    bankIds = drawn.bankIds;
  }
  const needFromAI = input.numQuestions - bankQuestions.length;
  const willCallAI =
    needFromAI > 0 &&
    process.env.USE_MOCK_AI === "false" &&
    process.env.ANTHROPIC_API_KEY != null;

  // ─── Phase B: rate limit only if we actually need the AI ─────────────────
  // Atomic reserve-or-reject — concurrent requests can't both pass the check.
  if (willCallAI) {
    const rl = await reserveAIGenerationSlot(user.id);
    if (!rl.reserved) {
      return {
        error: `You've hit the hourly limit of ${rl.limit} matches (${rl.usedInWindow} used). Try again in an hour, or pick a topic with existing questions in the bank.`,
      };
    }
  }

  // ─── Phase C: insert the pending challenge + first participant ───────────
  // `generation_phase` is set up-front so the detail page can show the real
  // progress card the moment the redirect lands. NULL means "no work to do"
  // (a 100% bank hit) and we'll finish synchronously below.
  const initialPhase: GenerationPhase | null =
    needFromAI > 0 ? "starting" : null;
  const challengeInsert = await query<{ id: string }>(
    `INSERT INTO challenges
       (challenger_id, topic, topic_normalized,
        difficulty_requested, num_questions, format, mode,
        timer_mode, time_per_question_s, total_time_s,
        max_players, auto_close_at, invite_token, status,
        generation_phase, generation_phase_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timer_mode, $9, $10, $11, $12, $13, 'pending', $14, now())
     RETURNING id`,
    [
      user.id,
      topic,
      topicNormalized,
      input.difficulty,
      input.numQuestions,
      input.format,
      input.mode,
      input.timerMode,
      input.timePerQuestionS,
      input.totalTimeS,
      input.maxPlayers,
      autoCloseAt,
      inviteToken,
      initialPhase,
    ]
  );
  const challengeId = challengeInsert.rows[0].id;

  await query(
    `INSERT INTO challenge_participants (challenge_id, user_id, is_challenger)
     VALUES ($1, $2, true)
     ON CONFLICT DO NOTHING`,
    [challengeId, user.id]
  );

  // ─── Phase D: 100% bank hit — finalize synchronously, no progress UI ─────
  if (needFromAI <= 0) {
    const topicInterpretation = `Drawn from the question bank for "${topic}" at difficulty ${input.difficulty}.`;
    await persistQuestionSet({
      challengeId,
      topicNormalized,
      difficulty: input.difficulty,
      format: input.format,
      generatedBy: `bank (${bankQuestions.length}/${input.numQuestions})`,
      generationMeta: { bank_used: bankQuestions.length, api_calls: 0 },
      bankQuestions,
      bankIds,
      aiQuestions: [],
      requestedCount: input.numQuestions,
    });
    await query(
      `UPDATE challenges
         SET topic_interpretation = $2,
             difficulty_delivered = $3,
             generation_phase = NULL,
             generation_phase_at = now()
       WHERE id = $1`,
      [challengeId, topicInterpretation, input.difficulty]
    );
    redirect(`/challenges/${challengeId}`);
  }

  // ─── Phase E: detach the AI work so the response returns immediately ─────
  // The challenge row exists with phase='starting'; the client will redirect
  // to /challenges/[id] and poll for real phase updates. `after()` keeps the
  // worker alive past response send (Railway is long-running, so this is
  // safe). If we fail, we stamp phase='failed:<msg>' instead of throwing.
  after(async () => {
    try {
      await runPipelineForChallenge({
        challengeId,
        topic,
        topicNormalized,
        input,
        bankQuestions,
        bankIds,
      });
    } catch (err) {
      const msg =
        err instanceof AIGenerationError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Something went wrong generating questions.";
      console.error("[createChallenge] background generation failed:", err);
      await setPhase(challengeId, null, msg.slice(0, 200));
    }
  });

  redirect(`/challenges/${challengeId}`);
}

interface RunPipelineArgs {
  challengeId: string;
  topic: string;
  topicNormalized: string;
  input: CreateChallengeInput;
  bankQuestions: GeneratedQuestion[];
  bankIds: string[];
}

async function runPipelineForChallenge(args: RunPipelineArgs): Promise<void> {
  const { challengeId, topic, topicNormalized, input, bankQuestions, bankIds } = args;
  const requestedFromAI = input.numQuestions - bankQuestions.length;

  // Wire the pipeline stages to the challenge row so the client's polling
  // gets real phase updates as the work progresses.
  const phaseHook = async (p: PipelinePhase) => {
    await setPhase(challengeId, p);
  };

  // ─── Run the 3-stage pipeline ────────────────────────────────────────────
  // generateQuestions() internally orchestrates: researcher → validator → writer.
  // The pipeline oversamples facts (2.5x) so the writer typically has enough
  // verified material to hit the requested count without a backfill round.
  const result = await generateQuestions(
    {
      topic,
      difficulty: input.difficulty,
      format: input.format,
      count: requestedFromAI,
    },
    phaseHook
  );

  // ─── Handle pipeline outcomes ────────────────────────────────────────────
  let topicInterpretation: string;
  let knowledgeWarning: string | null = null;
  let difficultyDelivered = input.difficulty;
  let generationMeta: Record<string, unknown> = {};
  let generatedBy = `bank (${bankQuestions.length}/${input.numQuestions})`;
  let aiQuestions: GeneratedQuestion[] = [];

  if (!result.topic_safe || result.questions.length === 0) {
    // Pipeline produced nothing usable. If the bank had ANY questions, fall
    // back to a smaller bank-only match; otherwise cancel.
    if (bankQuestions.length === 0) {
      await query(
        `UPDATE challenges
           SET status = 'cancelled',
               topic_interpretation = $2,
               knowledge_warning = $3,
               generation_phase = NULL,
               generation_phase_at = now()
         WHERE id = $1`,
        [
          challengeId,
          result.topic_interpretation,
          result.rejection_reason ?? result.knowledge_warning ?? "Couldn't generate verified questions for this topic.",
        ]
      );
      return;
    }
    topicInterpretation = result.topic_interpretation;
    knowledgeWarning = `Only ${bankQuestions.length} questions available — the AI couldn't add more. ${result.rejection_reason ?? result.knowledge_warning ?? ""}`.trim();
    difficultyDelivered = result.difficulty_delivered;
    generationMeta = { latency_ms: result.meta.latency_ms, bank_used: bankQuestions.length };
  } else {
    aiQuestions = result.questions;
    topicInterpretation = result.topic_interpretation;
    knowledgeWarning = result.knowledge_warning;
    difficultyDelivered = result.difficulty_delivered;
    generationMeta = {
      latency_ms: result.meta.latency_ms,
      bank_used: bankQuestions.length,
      research_ms: result.meta.research_ms,
      validate_ms: result.meta.validate_ms,
      write_ms: result.meta.write_ms,
      facts_researched: result.meta.facts_researched,
      facts_validated: result.meta.facts_validated,
      repair_write_ms: result.meta.repair_write_ms,
    };
    generatedBy =
      bankQuestions.length > 0
        ? `mixed: ${result.meta.generated_by} + bank (${bankQuestions.length}/${input.numQuestions})`
        : result.meta.generated_by;

    const finalAvailable = bankQuestions.length + aiQuestions.length;
    if (finalAvailable < input.numQuestions) {
      const note = `Delivered ${finalAvailable} of ${input.numQuestions} requested — the rest didn't pass fact-checking.`;
      knowledgeWarning = knowledgeWarning ? `${knowledgeWarning} ${note}` : note;
    }
  }

  // Safety net — pipeline gave nothing AND bank had nothing.
  if (aiQuestions.length === 0 && bankQuestions.length === 0) {
    await query(
      `UPDATE challenges
         SET status = 'cancelled',
             topic_interpretation = $2,
             knowledge_warning = $3,
             generation_phase = NULL,
             generation_phase_at = now()
       WHERE id = $1`,
      [
        challengeId,
        topicInterpretation,
        "No verified questions could be produced. Try a different topic or lower difficulty.",
      ]
    );
    return;
  }

  // ─── Persist ─────────────────────────────────────────────────────────────
  await setPhase(challengeId, "saving");
  await persistQuestionSet({
    challengeId,
    topicNormalized,
    difficulty: difficultyDelivered,
    format: input.format,
    generatedBy,
    generationMeta,
    bankQuestions,
    bankIds,
    aiQuestions,
    requestedCount: input.numQuestions,
  });

  await query(
    `UPDATE challenges
       SET topic_interpretation = $2,
           knowledge_warning = $3,
           difficulty_delivered = $4,
           generation_phase = NULL,
           generation_phase_at = now()
     WHERE id = $1`,
    [challengeId, topicInterpretation, knowledgeWarning, difficultyDelivered]
  );
}

interface PersistArgs {
  challengeId: string;
  topicNormalized: string;
  difficulty: number;
  format: ChallengeFormat;
  generatedBy: string;
  generationMeta: Record<string, unknown>;
  bankQuestions: GeneratedQuestion[];
  bankIds: string[];
  aiQuestions: GeneratedQuestion[];
  requestedCount: number;
}

async function persistQuestionSet(a: PersistArgs): Promise<void> {
  const setInsert = await query<{ id: string }>(
    `INSERT INTO question_sets (challenge_id, topic_normalized, difficulty, format, generated_by, generation_meta)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      a.challengeId,
      a.topicNormalized,
      a.difficulty,
      a.format,
      a.generatedBy,
      JSON.stringify(a.generationMeta),
    ]
  );
  const setId = setInsert.rows[0].id;

  // Add ALL verified AI questions to the bank — including any extras the
  // pipeline produced beyond the requested count.
  const newBankIds = await addToBank(a.topicNormalized, a.difficulty, a.aiQuestions);

  // Trim AI questions for THIS match. Bank-drawn questions all stay.
  const aiKeepCount = Math.max(0, a.requestedCount - a.bankQuestions.length);
  const aiForMatch = a.aiQuestions.slice(0, aiKeepCount);
  const aiBankIdsForMatch = newBankIds.slice(0, aiKeepCount);

  // Interleave bank-drawn and freshly-generated for a varied feel.
  const combined: { q: GeneratedQuestion; bankId: string | null }[] = [];
  let bi = 0;
  let ai = 0;
  while (bi < a.bankQuestions.length || ai < aiForMatch.length) {
    if (bi < a.bankQuestions.length) {
      combined.push({ q: a.bankQuestions[bi], bankId: a.bankIds[bi] });
      bi++;
    }
    if (ai < aiForMatch.length) {
      combined.push({ q: aiForMatch[ai], bankId: aiBankIdsForMatch[ai] ?? null });
      ai++;
    }
  }

  for (let i = 0; i < combined.length; i++) {
    const { q, bankId } = combined[i];
    await query(
      `INSERT INTO questions
         (set_id, position, question_text, correct_answer, answer_aliases, distractors,
          source_hint, type, per_question_format, bank_question_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        setId,
        i + 1,
        q.question,
        q.correct_answer,
        JSON.stringify(q.answer_aliases),
        JSON.stringify(q.distractors),
        q.source_hint,
        q.type,
        q.per_question_format,
        bankId,
      ]
    );
  }

  await markBankUse(a.bankIds);
}
