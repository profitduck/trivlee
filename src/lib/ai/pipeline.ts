import "server-only";
import { researchFacts } from "./researcher";
import { validateFacts } from "./validator";
import { writeQuestions } from "./writer";
import type {
  FactCandidate,
  GenerationRequest,
  GenerationResponse,
  ValidatedFact,
} from "./types";

/**
 * Optional progress hook so the caller can update generation_phase as each
 * stage starts. Synchronous and lightweight — the caller writes to DB.
 */
export type PipelinePhase = "researching" | "validating" | "writing";
export type PhaseHook = (phase: PipelinePhase) => Promise<void> | void;

/**
 * The 3-stage pipeline: researcher gathers a wide fact pool, validator
 * confirms each one, writer builds questions from the verified subset.
 *
 * Replaces the old generator→verifier flow. The key win: the writer can't
 * embellish details around real events because it only sees facts that the
 * validator independently confirmed — embellishments fail validation before
 * the writer ever sees them.
 */
export async function runPipeline(
  req: GenerationRequest,
  onPhase?: PhaseHook
): Promise<GenerationResponse> {
  const overallStart = performance.now();

  // ─── Stage 1: research ───────────────────────────────────────────────────
  await onPhase?.("researching");
  const research = await researchFacts(req);

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

  // ─── Stage 2: validate ───────────────────────────────────────────────────
  // Pass research.difficulty_delivered (may be capped from req.difficulty) so
  // the validator's web search budget matches the actual difficulty of the
  // facts in hand, not the originally requested difficulty.
  await onPhase?.("validating");
  const { validated, latencyMs: validate_ms } = await validateFacts(
    req.topic,
    research.facts,
    research.difficulty_delivered
  );

  // Keep only high-confidence verified facts. Anything else is a hallucination
  // risk regardless of how the validator categorized it.
  const verifiedFacts: ValidatedFact[] = validated.filter(
    (f) => f.verified && f.confidence === "high"
  );

  // Log drops for visibility during dev. In prod this is just a debug breadcrumb.
  const dropped = validated.filter((f) => !verifiedFacts.includes(f));
  if (dropped.length > 0) {
    console.log(
      `[pipeline] validator dropped ${dropped.length}/${validated.length} facts. Examples:`,
      dropped.slice(0, 3).map((f) => ({ claim: f.claim.slice(0, 80), notes: f.notes }))
    );
  }

  // If validation gutted the pool below the requested count, we'll still try
  // to write — the writer is told it can return fewer questions and explain.
  let knowledge_warning_so_far = research.knowledge_warning;
  if (verifiedFacts.length === 0) {
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
        facts_researched: research.facts.length,
        facts_validated: 0,
      },
    };
  }
  if (verifiedFacts.length < req.count) {
    const note = `Only ${verifiedFacts.length} of ${research.facts.length} researched facts passed validation.`;
    knowledge_warning_so_far = knowledge_warning_so_far
      ? `${knowledge_warning_so_far} ${note}`
      : note;
  }

  // ─── Stage 3: write ──────────────────────────────────────────────────────
  await onPhase?.("writing");
  const writerOut = await writeQuestions({
    ...req,
    topic_interpretation: research.topic_interpretation,
    difficulty_delivered: research.difficulty_delivered,
    facts: verifiedFacts,
    knowledge_warning_so_far,
  });

  // ─── Assemble final response ─────────────────────────────────────────────
  const latency_ms = Math.round(performance.now() - overallStart);
  return {
    topic_interpretation: writerOut.topic_interpretation,
    topic_safe: writerOut.topic_safe,
    rejection_reason: writerOut.rejection_reason,
    difficulty_delivered: writerOut.difficulty_delivered,
    knowledge_warning: writerOut.knowledge_warning,
    questions: writerOut.questions,
    meta: {
      generated_by: `${writerOut.meta.model} (3-stage pipeline)`,
      latency_ms,
      research_ms: research.meta.latency_ms,
      validate_ms,
      write_ms: writerOut.meta.latency_ms,
      facts_researched: research.facts.length,
      facts_validated: verifiedFacts.length,
    },
  };
}

// Re-export so callers can plug fact arrays into other flows (e.g. tests).
export type { FactCandidate, ValidatedFact };
