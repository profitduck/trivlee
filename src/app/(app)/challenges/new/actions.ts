"use server";

import { randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
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

  // ─── Phase B: rate limit only if we actually need the AI ─────────────────
  // Atomic reserve-or-reject — concurrent requests can't both pass the check.
  if (
    needFromAI > 0 &&
    process.env.USE_MOCK_AI === "false" &&
    process.env.ANTHROPIC_API_KEY
  ) {
    const rl = await reserveAIGenerationSlot(user.id);
    if (!rl.reserved) {
      return {
        error: `You've hit the hourly limit of ${rl.limit} matches (${rl.usedInWindow} used). Try again in an hour, or pick a topic with existing questions in the bank.`,
      };
    }
  }

  // ─── Phase C: insert the pending challenge + first participant ───────────
  const challengeInsert = await query<{ id: string }>(
    `INSERT INTO challenges
       (challenger_id, topic, topic_normalized,
        difficulty_requested, num_questions, format, mode,
        time_per_question_s, total_time_s,
        max_players, auto_close_at, invite_token, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending')
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
    ]
  );
  const challengeId = challengeInsert.rows[0].id;

  await query(
    `INSERT INTO challenge_participants (challenge_id, user_id, is_challenger)
     VALUES ($1, $2, true)
     ON CONFLICT DO NOTHING`,
    [challengeId, user.id]
  );

  // ─── Phase D: call AI for the remainder, if needed ───────────────────────
  let aiQuestions: GeneratedQuestion[] = [];
  let topicInterpretation: string;
  let knowledgeWarning: string | null = null;
  let difficultyDelivered = input.difficulty;
  let generationMeta: Record<string, unknown> = {};
  let generatedBy = `bank (${bankQuestions.length}/${input.numQuestions})`;

  if (needFromAI > 0) {
    let result;
    try {
      result = await generateQuestions({
        topic,
        difficulty: input.difficulty,
        format: input.format,
        count: needFromAI,
      });
    } catch (err) {
      // Roll back the pending challenge so the user can retry cleanly.
      await query(`DELETE FROM challenges WHERE id = $1`, [challengeId]);
      const msg =
        err instanceof AIGenerationError
          ? err.message
          : "Something went wrong generating questions.";
      return { error: msg };
    }

    if (!result.topic_safe || result.questions.length === 0) {
      // AI couldn't produce anything. If we have ANY bank questions, run with
      // them; otherwise cancel.
      if (bankQuestions.length === 0) {
        await query(
          `UPDATE challenges SET status = 'cancelled', topic_interpretation = $2, knowledge_warning = $3 WHERE id = $1`,
          [challengeId, result.topic_interpretation, result.rejection_reason]
        );
        return {
          error: result.rejection_reason ?? "Could not generate questions for this topic.",
          challengeId,
        };
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
      generationMeta = { latency_ms: result.meta.latency_ms, bank_used: bankQuestions.length };
      generatedBy = bankQuestions.length > 0
        ? `mixed: ${result.meta.generated_by} + bank (${bankQuestions.length}/${input.numQuestions})`
        : result.meta.generated_by;

      // ─── Verification pass — Haiku fact-checks each generated question ──
      // Drop ones that fail (accurate: false) or that the verifier isn't
      // confident about (confidence: low). Bank questions skip this — they've
      // already been through it once.
      const verifyStart = performance.now();
      const verifications = await Promise.all(
        aiQuestions.map((q) =>
          verifyQuestion({
            topic,
            question: q.question,
            correctAnswer: q.correct_answer,
            distractors: q.distractors,
            sourceHint: q.source_hint,
          })
        )
      );
      const dropped: { question: string; reason: string }[] = [];
      aiQuestions = aiQuestions.filter((q, i) => {
        const v = verifications[i];
        if (v === null) return true; // verifier unavailable, pass-through
        // Strict mode: only keep questions the verifier rates accurate AND high-confidence.
        // Medium/low confidence both get dropped — we'd rather show fewer questions
        // than ship something the verifier wasn't sure about.
        if (!v.accurate || v.confidence !== "high") {
          dropped.push({ question: q.question.slice(0, 80), reason: v.reason });
          console.warn(
            `[verifier] dropped (accurate=${v.accurate}, confidence=${v.confidence}): "${q.question.slice(0, 60)}…" — ${v.reason}`
          );
          return false;
        }
        return true;
      });
      generationMeta = {
        ...generationMeta,
        verifier_dropped: dropped.length,
        verifier_latency_ms: Math.round(performance.now() - verifyStart),
      };
      if (dropped.length > 0) {
        const note = `Fact-checker dropped ${dropped.length} question${dropped.length === 1 ? "" : "s"}.`;
        knowledgeWarning = knowledgeWarning ? `${knowledgeWarning} ${note}` : note;
      }
    }
  } else {
    // 100% bank hit — no AI call at all.
    topicInterpretation = `Drawn from the question bank for "${topic}" at difficulty ${input.difficulty}.`;
    generationMeta = { bank_used: bankQuestions.length, api_calls: 0 };
  }

  // Safety net — verification may have dropped every AI question. If that
  // happens AND the bank had nothing for us, the match would be empty.
  if (aiQuestions.length === 0 && bankQuestions.length === 0) {
    await query(
      `UPDATE challenges SET status = 'cancelled', topic_interpretation = $2, knowledge_warning = $3 WHERE id = $1`,
      [
        challengeId,
        topicInterpretation,
        "Every generated question failed fact-checking. Try a different topic, lower difficulty, or come back later.",
      ]
    );
    return {
      error:
        "Couldn't produce any verified questions for this topic. Try a different topic or lower difficulty.",
      challengeId,
    };
  }

  // ─── Phase E: insert question_set + questions ────────────────────────────
  const setInsert = await query<{ id: string }>(
    `INSERT INTO question_sets (challenge_id, topic_normalized, difficulty, format, generated_by, generation_meta)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      challengeId,
      topicNormalized,
      difficultyDelivered,
      input.format,
      generatedBy,
      JSON.stringify(generationMeta),
    ]
  );
  const setId = setInsert.rows[0].id;

  // Add fresh AI questions to the bank first so we have IDs for backref.
  const newBankIds = await addToBank(topicNormalized, difficultyDelivered, aiQuestions);

  // Interleave bank-drawn and freshly-generated so position 1 isn't always
  // cached and position N isn't always fresh — just gives a varied feel.
  const combined: { q: GeneratedQuestion; bankId: string | null }[] = [];
  let bi = 0;
  let ai = 0;
  while (bi < bankQuestions.length || ai < aiQuestions.length) {
    if (bi < bankQuestions.length) {
      combined.push({ q: bankQuestions[bi], bankId: bankIds[bi] });
      bi++;
    }
    if (ai < aiQuestions.length) {
      combined.push({ q: aiQuestions[ai], bankId: newBankIds[ai] ?? null });
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

  // Bump times_used for the bank rows we just drew from.
  await markBankUse(bankIds);

  // ─── Phase F: stamp interpretation + finalize ────────────────────────────
  await query(
    `UPDATE challenges
       SET topic_interpretation = $2,
           knowledge_warning = $3,
           difficulty_delivered = $4
     WHERE id = $1`,
    [challengeId, topicInterpretation, knowledgeWarning, difficultyDelivered]
  );

  redirect(`/challenges/${challengeId}`);
}
