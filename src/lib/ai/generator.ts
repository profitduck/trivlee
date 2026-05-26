import "server-only";
import { mockGenerate } from "./mock";
import { anthropicGenerate } from "./anthropic";
import type { GenerationRequest, GenerationResponse } from "./types";

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

export async function generateQuestions(
  req: GenerationRequest
): Promise<GenerationResponse> {
  const useMock = process.env.USE_MOCK_AI !== "false";
  if (useMock) return mockGenerate(req);

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AIGenerationError(
      "USE_MOCK_AI is false but ANTHROPIC_API_KEY is not configured."
    );
  }

  try {
    return await anthropicGenerate(req);
  } catch (err) {
    console.error("[generator] anthropicGenerate threw:", err);
    throw new AIGenerationError(
      "The AI couldn't be reached. Please try again in a moment.",
      err
    );
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
