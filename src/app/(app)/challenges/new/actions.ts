"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireUser } from "@/lib/auth";
import { query } from "@/lib/db";
import { AIGenerationError, generateQuestions, normalizeTopic } from "@/lib/ai/generator";
import { verifyQuestion } from "@/lib/ai/verifier";
import { reserveAIGenerationSlot } from "@/lib/rate-limit";
import {
  addToBank,
  drawFromBank,
  markBankUse,
} from "@/lib/ai/question-bank";
import type {
  ChallengeFormat,
  GeneratedQuestion,
  PerQuestionFormat,
} from "@/lib/ai/types";

export type GenerationPhase =
  | "starting"
  | "drafting"
  | "verifying"
  | "backfilling"
  | "saving";

async function setPhase(challengeId: string, phase: GenerationPhase | null, errorMsg?: string) {
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

interface CreateChallengeInput {
  topic: string;
  difficulty: number;
  numQuestions: number;
  format: ChallengeFormat;
  mode: "async" | "live";
  timePerQuestionS: number | null;
  totalTimeS: number | null;
  maxPlayers: number | null;
  autoCloseHours: number | null;
}

function generateInviteToken(): string {
  return randomBytes(16).toString("base64url");
}

const OVERSAMPLE_RATIO = 1.3; // request 30% more than the target to absorb verifier drops
const MAX_OVERSAMPLE = 25;
const MAX_BACKFILL_ROUNDS = 1;

function computeOversample(target: number): number {
  return Math.min(MAX_OVERSAMPLE, Math.ceil(target * OVERSAMPLE_RATIO));
}

/**
 * Verify a batch of generated questions against the Sonnet verifier.
 * Returns the survivors (accurate=true, confidence=high) and the dropped ones.
 */
async function verifyBatch(
  questions: GeneratedQuestion[],
  topic: string
): Promise<{
  survivors: GeneratedQuestion[];
  dropped: { question: string; reason: string }[];
  latencyMs: number;
}> {
  const start = performance.now();
  const verifications = await Promise.all(
    questions.map((q) =>
      verifyQuestion({
        topic,
        question: q.question,
        correctAnswer: q.correct_answer,
        distractors: q.distractors,
        sourceHint: q.source_hint,
      })
    )
  );
  const survivors: GeneratedQuestion[] = [];
  const dropped: { question: string; reason: string }[] = [];
  questions.forEach((q, i) => {
    const v = verifications[i];
    if (v === null) {
      survivors.push(q);
      return;
    }
    if (!v.accurate || v.confidence !== "high") {
      dropped.push({ question: q.question.slice(0, 80), reason: v.reason });
      console.warn(
        `[verifier] dropped (accurate=${v.accurate}, confidence=${v.confidence}): "${q.question.slice(0, 60)}…" — ${v.reason}`
      );
      return;
    }
    survivors.push(q);
  });
  return {
    survivors,
    dropped,
    latencyMs: Math.round(performance.now() - start),
  };
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
  // Mixed format bypasses bank for now — single-format only, since the bank
  // keys on per_question_format.
  let bankQuestions: GeneratedQuestion[] = [];
  let bankIds: string[] = [];
  if (input.format !== "mixed") {
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
        time_per_question_s, total_time_s,
        max_players, auto_close_at, invite_token, status,
        generation_phase, generation_phase_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending', $13, now())
     RETURNING id`,
    [
      user.id,
      topic,
      topicNormalized,
      input.difficulty,
      input.numQuestions,
      input.format,
      input.mode,
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
      await runAIGeneration({
        challengeId,
        topic,
        topicNormalized,
        input,
        bankQuestions,
        bankIds,
        needFromAI,
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

interface RunAIGenerationArgs {
  challengeId: string;
  topic: string;
  topicNormalized: string;
  input: CreateChallengeInput;
  bankQuestions: GeneratedQuestion[];
  bankIds: string[];
  needFromAI: number;
}

async function runAIGeneration(args: RunAIGenerationArgs): Promise<void> {
  const { challengeId, topic, topicNormalized, input, bankQuestions, bankIds } = args;

  // Oversample by ~30% so the verifier's drops usually leave us with enough.
  const oversampleCount = computeOversample(args.needFromAI);

  await setPhase(challengeId, "drafting");
  const result = await generateQuestions({
    topic,
    difficulty: input.difficulty,
    format: input.format,
    count: oversampleCount,
  });

  let topicInterpretation: string;
  let knowledgeWarning: string | null = null;
  let difficultyDelivered = input.difficulty;
  let generationMeta: Record<string, unknown> = {};
  let generatedBy = `bank (${bankQuestions.length}/${input.numQuestions})`;
  let aiQuestions: GeneratedQuestion[] = [];

  if (!result.topic_safe || result.questions.length === 0) {
    if (bankQuestions.length === 0) {
      await query(
        `UPDATE challenges
           SET status = 'cancelled',
               topic_interpretation = $2,
               knowledge_warning = $3,
               generation_phase = NULL,
               generation_phase_at = now()
         WHERE id = $1`,
        [challengeId, result.topic_interpretation, result.rejection_reason]
      );
      return;
    }
    // Soft fallback: use just the bank questions and tell the user.
    topicInterpretation = result.topic_interpretation;
    knowledgeWarning = `Only ${bankQuestions.length} questions available — the AI couldn't add more. ${result.rejection_reason ?? ""}`;
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
      oversample_target: oversampleCount,
      oversample_received: result.questions.length,
    };
    generatedBy = bankQuestions.length > 0
      ? `mixed: ${result.meta.generated_by} + bank (${bankQuestions.length}/${input.numQuestions})`
      : result.meta.generated_by;

    // ─── Verification pass ──────────────────────────────────────────────
    await setPhase(challengeId, "verifying");
    const initial = await verifyBatch(aiQuestions, topic);
    aiQuestions = initial.survivors;
    let totalDropped = initial.dropped.length;
    let totalVerifyLatencyMs = initial.latencyMs;
    let backfillsAttempted = 0;
    let backfillsRecovered = 0;

    // ─── Backfill if oversampling wasn't enough ────────────────────────
    while (
      bankQuestions.length + aiQuestions.length < input.numQuestions &&
      backfillsAttempted < MAX_BACKFILL_ROUNDS
    ) {
      const shortfall =
        input.numQuestions - bankQuestions.length - aiQuestions.length;
      const refillCount = computeOversample(shortfall);
      backfillsAttempted++;
      await setPhase(challengeId, "backfilling");
      try {
        const refillResult = await generateQuestions({
          topic,
          difficulty: input.difficulty,
          format: input.format,
          count: refillCount,
        });
        if (refillResult.topic_safe && refillResult.questions.length > 0) {
          const refillVerify = await verifyBatch(refillResult.questions, topic);
          aiQuestions = [...aiQuestions, ...refillVerify.survivors];
          backfillsRecovered += refillVerify.survivors.length;
          totalDropped += refillVerify.dropped.length;
          totalVerifyLatencyMs += refillVerify.latencyMs;
        }
      } catch (err) {
        console.warn("Backfill round failed; continuing with current questions:", err);
        break;
      }
    }

    generationMeta = {
      ...generationMeta,
      verifier_dropped: totalDropped,
      verifier_latency_ms: totalVerifyLatencyMs,
      backfills_attempted: backfillsAttempted,
      backfills_recovered: backfillsRecovered,
    };

    const finalAvailable = bankQuestions.length + aiQuestions.length;
    if (finalAvailable < input.numQuestions) {
      const note = `Fact-checker kept only ${finalAvailable} of ${input.numQuestions} requested questions.`;
      knowledgeWarning = knowledgeWarning ? `${knowledgeWarning} ${note}` : note;
    }
  }

  // Safety net — verification may have dropped every AI question. If that
  // happens AND the bank had nothing, cancel the match.
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
        "Every generated question failed fact-checking. Try a different topic, lower difficulty, or come back later.",
      ]
    );
    return;
  }

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

  // ─── Finalize: clear the phase so the page renders the normal match view.
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

  // Add ALL verified AI questions to the bank — including oversample extras.
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
