import "server-only";
import { mockGenerate } from "./mock";
import { runPipeline, type PhaseHook } from "./pipeline";
import type { GenerationRequest, GenerationResponse } from "./types";

export type { PhaseHook, PipelinePhase } from "./pipeline";

/**
 * AI generation error. Thrown to the caller so the UI can show a real
 * failure instead of silently producing mock questions.
 */
export class AIGenerationError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = "AIGenerationError";
  }
}

/**
 * Generate a question set. Internally runs the 3-stage research → validate →
 * write pipeline. The optional `onPhase` callback lets the caller write the
 * current phase to the DB so the client can show real-time progress.
 */
export async function generateQuestions(
  req: GenerationRequest,
  onPhase?: PhaseHook
): Promise<GenerationResponse> {
  const useMock = process.env.USE_MOCK_AI !== "false";
  if (useMock) return mockGenerate(req);

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AIGenerationError(
      "USE_MOCK_AI is false but ANTHROPIC_API_KEY is not configured."
    );
  }

  try {
    return await runPipeline(req, onPhase);
  } catch (err) {
    console.error("[generator] runPipeline threw:", err);
    // Surface the pipeline's own message when it has one (e.g. timeout text
    // mentioning how long elapsed and what the user can do). Fall back to a
    // generic message for opaque SDK / network errors.
    const message =
      err instanceof Error && err.name === "PipelineTimeoutError"
        ? err.message
        : "The AI couldn't be reached. Please try again in a moment.";
    throw new AIGenerationError(message, err);
  }
}

export function normalizeTopic(topic: string): string {
  return topic
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
