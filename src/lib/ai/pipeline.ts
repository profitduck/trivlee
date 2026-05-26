import "server-only";
import { generateFastQuestions } from "./fast-generator";
import { researchFacts } from "./researcher";
import { validateFacts } from "./validator";
import { writeQuestions, type SpeculativeQuestion } from "./writer";
import type {
  FactCandidate,
  GeneratedQuestion,
  GenerationRequest,
  GenerationResponse,
  ValidatedFact,
} from "./types";

// Hard ceiling on total pipeline wall time. Past this we surface a clean
// failure instead of letting the user stare at the spinner indefinitely.
// Individual Anthropic calls also have request-level caps in each stage.
//
// Tuned against observed runs:
//   - Healthy D1-7 match: ~30-60s
//   - Healthy D1-7 match: ~25-55s
//   - Healthy D8-10 or niche topic: ~55-100s
// 125s gives headroom for one no-search fallback while keeping mobile users
// out of the three-minute dead zone.
const PIPELINE_TIMEOUT_MS = 125_000;

class PipelineTimeoutError extends Error {
  constructor(elapsedMs: number) {
    super(
      `Pipeline exceeded ${Math.round(PIPELINE_TIMEOUT_MS / 1000)}s timeout (${Math.round(elapsedMs / 1000)}s elapsed). ` +
      `Try a more well-known topic or lower difficulty.`
    );
    this.name = "PipelineTimeoutError";
  }
}

/**
 * Wrap a promise with a deadline. If it doesn't resolve in `ms`, reject with
 * PipelineTimeoutError. The underlying work keeps running (no AbortSignal)
 * but the caller stops waiting and surfaces failure to the user.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, startedAt: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => {
      reject(new PipelineTimeoutError(performance.now() - startedAt));
    }, ms);
    promise.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

/**
 * Optional progress hook so the caller can update generation_phase as each
 * stage starts. Synchronous and lightweight — the caller writes to DB.
 *
 * Note: with the speculative-writer optimization, validation and writing
 * happen in parallel. The hook fires "validating" once at the start of the
 * parallel block; the writer's work is invisible to the UI (it finishes
 * during the validator's runtime).
 */
export type PipelinePhase = "researching" | "validating" | "writing";
export type PhaseHook = (phase: PipelinePhase) => Promise<void> | void;

/**
 * The 3-stage pipeline: researcher gathers a wide fact pool, validator and
 * writer run concurrently (writer speculates on questions; validator verifies
 * facts), then questions whose source fact failed validation are dropped.
 *
 * Why parallel: the writer (Haiku, no web search) is much faster than the
 * validator (Sonnet, web search). Running them sequentially wastes ~15-20s
 * per match while the writer waits for validation. Running concurrently and
 * filtering post-hoc gives us most of the writer's work for free.
 *
 * The fact_index tag on each question makes this safe: every question is
 * pinned to one input fact, so we drop the question iff that fact failed
 * validation. The writer is prompted to use exactly one fact per question
 * (no synthesis), eliminating cross-pollution risk.
 */
export async function runPipeline(
  req: GenerationRequest,
  onPhase?: PhaseHook
): Promise<GenerationResponse> {
  const overallStart = performance.now();
  if (process.env.AI_PIPELINE_MODE !== "verified") {
    await onPhase?.("writing");
    return generateFastQuestions(req);
  }
  return withTimeout(runPipelineInner(req, onPhase, overallStart), PIPELINE_TIMEOUT_MS, overallStart);
}

async function runPipelineInner(
  req: GenerationRequest,
  onPhase: PhaseHook | undefined,
  overallStart: number
): Promise<GenerationResponse> {
  // Per-stage logging breadcrumbs. Visible in Railway logs so we can diagnose
  // future stuck matches by reading where the time went.
  const log = (msg: string) =>
    console.log(`[pipeline] +${Math.round(performance.now() - overallStart)}ms ${msg}`);

  log(`start topic="${req.topic.slice(0, 40)}" diff=${req.difficulty} count=${req.count}`);

  // ─── Stage 1: research ───────────────────────────────────────────────────
  await onPhase?.("researching");
  const research = await researchFacts(req);
  log(`research done in ${research.meta.latency_ms}ms, ${research.facts.length} facts`);

  // Researcher said no — surface that to the caller cleanly.
  if (!research.topic_safe || research.facts.length === 0) {
    return {
      topic_interpretation: research.topic_interpretation,
      topic_safe: research.topic_safe,
      rejection_reason: research.rejection_reason,
      difficulty_delivered: research.difficulty_delivered,
      knowledge_warning: research.knowledge_warning,
      questions: [],
      meta: {
        generated_by: `${research.meta.model} (3-stage pipeline)`,
        latency_ms: Math.round(performance.now() - overallStart),
        research_ms: research.meta.latency_ms,
        facts_researched: 0,
        facts_validated: 0,
      },
    };
  }

  // ─── Stages 2 + 3: validate & write IN PARALLEL ──────────────────────────
  // The validator confirms each fact independently; the writer speculatively
  // builds questions from all researched facts in parallel. After both finish
  // we drop questions whose source fact didn't pass validation.
  await onPhase?.("validating");
  const [validateResult, writerOut] = await Promise.all([
    validateFacts(req.topic, research.facts, research.difficulty_delivered),
    writeQuestions({
      ...req,
      topic_interpretation: research.topic_interpretation,
      difficulty_delivered: research.difficulty_delivered,
      facts: research.facts,
      knowledge_warning_so_far: research.knowledge_warning,
      oversample: true, // produce ~30% extra so post-validator drops don't shortfall
    }),
  ]);

  const { validated, latencyMs: validate_ms } = validateResult;
  let totalWriteMs = writerOut.meta.latency_ms;
  let repairWriteMs: number | undefined;
  log(`validate done in ${validate_ms}ms, write done in ${writerOut.meta.latency_ms}ms (parallel block)`);

  // Build the verified-fact-index set. Only high-confidence verifications
  // survive — anything less is treated as a hallucination risk.
  const verifiedIndices = new Set<number>();
  validated.forEach((f, i) => {
    if (f.verified && f.confidence === "high") verifiedIndices.add(i);
  });

  const dropped = validated.filter((_, i) => !verifiedIndices.has(i));
  if (dropped.length > 0) {
    console.log(
      `[pipeline] validator dropped ${dropped.length}/${validated.length} facts. Examples:`,
      dropped.slice(0, 3).map((f) => ({ claim: f.claim.slice(0, 80), notes: f.notes }))
    );
  }

  if (verifiedIndices.size === 0) {
    return {
      topic_interpretation: research.topic_interpretation,
      topic_safe: true,
      rejection_reason: null,
      difficulty_delivered: research.difficulty_delivered,
      knowledge_warning:
        "Couldn't verify any facts about this topic. Try a different topic, lower difficulty, or come back later.",
      questions: [],
      meta: {
        generated_by: "3-stage pipeline (zero verified facts)",
        latency_ms: Math.round(performance.now() - overallStart),
        research_ms: research.meta.latency_ms,
        validate_ms,
        write_ms: writerOut.meta.latency_ms,
        facts_researched: research.facts.length,
        facts_validated: 0,
      },
    };
  }

  // ─── Filter writer's questions by validated set ──────────────────────────
  // Drop any question whose fact_index points to a rejected (or out-of-range)
  // fact. The writer is prompted to use exactly one fact per question, so this
  // filter is safe — we don't have to worry about questions partially derived
  // from rejected facts.
  const filtered: SpeculativeQuestion[] = writerOut.questions.filter((q) => {
    if (q.fact_index < 0 || q.fact_index >= validated.length) {
      console.warn(`[pipeline] dropping question with invalid fact_index ${q.fact_index}`);
      return false;
    }
    return verifiedIndices.has(q.fact_index);
  });

  // Dedupe in case the writer re-used the same fact across multiple questions
  // (prompt forbids it, but be defensive).
  const seenFactIndices = new Set<number>();
  const deduped = filtered.filter((q) => {
    if (seenFactIndices.has(q.fact_index)) {
      console.warn(`[pipeline] dropping duplicate question on fact ${q.fact_index}`);
      return false;
    }
    seenFactIndices.add(q.fact_index);
    return true;
  });

  // Trim to the requested count (we asked the writer to oversample).
  let finalSpec = deduped.slice(0, req.count);

  // Cheap repair pass: if the speculative writer came up short but validation
  // found more high-confidence facts, ask Haiku to write only the missing
  // questions from the unused verified facts. No web search, no Sonnet.
  let writerWarning = writerOut.knowledge_warning;
  if (finalSpec.length < req.count) {
    const usedFactIndices = new Set(finalSpec.map((q) => q.fact_index));
    const repairFacts = [...verifiedIndices]
      .filter((i) => !usedFactIndices.has(i))
      .map((i) => research.facts[i])
      .filter((f): f is FactCandidate => f != null);
    const repairCount = Math.min(req.count - finalSpec.length, repairFacts.length);

    if (repairCount > 0) {
      await onPhase?.("writing");
      const repairOut = await writeQuestions({
        ...req,
        count: repairCount,
        topic_interpretation: research.topic_interpretation,
        difficulty_delivered: research.difficulty_delivered,
        facts: repairFacts,
        knowledge_warning_so_far: null,
        oversample: false,
      });
      totalWriteMs += repairOut.meta.latency_ms;
      repairWriteMs = repairOut.meta.latency_ms;
      writerWarning = combineWarnings(writerWarning, repairOut.knowledge_warning);
      log(`repair pass done in ${repairOut.meta.latency_ms}ms, added ${repairOut.questions.length} questions`);

      const seenRepairFactIndices = new Set<number>();
      const seenQuestionKeys = new Set(finalSpec.map(questionKey));
      const repairSpec = repairOut.questions.filter((q) => {
        if (q.fact_index < 0 || q.fact_index >= repairFacts.length) return false;
        if (seenRepairFactIndices.has(q.fact_index)) return false;
        const key = questionKey(q);
        if (seenQuestionKeys.has(key)) return false;
        seenRepairFactIndices.add(q.fact_index);
        seenQuestionKeys.add(key);
        return true;
      });
      finalSpec = [...finalSpec, ...repairSpec].slice(0, req.count);
    }
  }

  // Strip fact_index — it's internal to the pipeline, not part of the public type.
  const finalQuestions: GeneratedQuestion[] = finalSpec.map(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ({ fact_index, ...rest }) => rest
  );

  // Knowledge warning: tell the user if we fell short of the requested count.
  let knowledge_warning = writerWarning;
  if (finalQuestions.length < req.count) {
    const note = `Delivered ${finalQuestions.length} of ${req.count} requested — some questions didn't pass fact-checking.`;
    knowledge_warning = knowledge_warning ? `${knowledge_warning} ${note}` : note;
  }

  const latency_ms = Math.round(performance.now() - overallStart);
  log(`pipeline complete in ${latency_ms}ms, delivered ${finalQuestions.length}/${req.count} questions`);
  return {
    topic_interpretation: writerOut.topic_interpretation,
    topic_safe: writerOut.topic_safe,
    rejection_reason: writerOut.rejection_reason,
    difficulty_delivered: writerOut.difficulty_delivered,
    knowledge_warning,
    questions: finalQuestions,
    meta: {
      generated_by: `${writerOut.meta.model} (3-stage pipeline, parallel validate+write)`,
      latency_ms,
      research_ms: research.meta.latency_ms,
      validate_ms,
      write_ms: totalWriteMs,
      repair_write_ms: repairWriteMs,
      facts_researched: research.facts.length,
      facts_validated: verifiedIndices.size,
    },
  };
}

function questionKey(q: GeneratedQuestion): string {
  return `${q.question}|${q.correct_answer}`
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function combineWarnings(...warnings: (string | null | undefined)[]): string | null {
  const parts = warnings
    .flatMap((warning) => warning?.split(/\s+(?=Delivered \d+ of \d+ requested\b)/) ?? [])
    .map((warning) => warning.trim())
    .filter((warning) => warning.length > 0);
  const unique = [...new Set(parts)];
  return unique.length > 0 ? unique.join(" ") : null;
}

// Re-export so callers can plug fact arrays into other flows (e.g. tests).
export type { FactCandidate, ValidatedFact };
