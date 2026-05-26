import "server-only";
import Anthropic from "@anthropic-ai/sdk";

const VERIFIER_MODEL = "claude-sonnet-4-6";

const VERIFIER_SYSTEM_PROMPT = `You are a strict trivia fact-checker. You receive a candidate question with its claimed correct answer (and distractors, if multiple-choice) and the writer's stated source. Your job is to catch three failure modes:

1. **Fabrication.** The question references something that doesn't exist in canon — a character whose name was never given, an episode that doesn't exist, a quote misattributed, an invented fact.
2. **Cross-property conflation.** The question is supposedly about Topic X but the answer comes from Topic Y (different show, different book, different artist).
3. **Wrong specifics.** The question is on-topic but the specific detail is misremembered — wrong year, wrong character, wrong episode, wrong role assignment.

Be STRICT. If you're not at least 85% confident the claimed correct answer is right, mark it inaccurate.

Special cases:
- If the question presupposes a fact that was NEVER canonically established (e.g. asking the "real name" of a character whose name was never revealed in canon), mark inaccurate.
- If one of the distractors is actually a more correct answer than the labeled one, mark inaccurate and name which distractor.
- If you genuinely don't know enough about the topic to verify (e.g. obscure indie game, paywalled book), return confidence: "low" — the question will be dropped.

Output strict JSON only. No prose, no code fences:

{
  "accurate": boolean,
  "confidence": "high" | "medium" | "low",
  "reason": "string (≤ 18 words; empty string if accurate)"
}

Be terse. If you reject, name the specific problem ("Dennis's role was 'The Looks', not 'The Useless Piece'"). Don't editorialize.`;

export interface VerifyInput {
  topic: string;
  question: string;
  correctAnswer: string;
  distractors: string[];
  sourceHint: string;
}

export interface VerifyOutput {
  accurate: boolean;
  confidence: "high" | "medium" | "low";
  reason: string;
}

const globalForAnthropic = globalThis as unknown as { __verifierClient?: Anthropic };

function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!globalForAnthropic.__verifierClient) {
    globalForAnthropic.__verifierClient = new Anthropic({ apiKey });
  }
  return globalForAnthropic.__verifierClient;
}

/**
 * Fact-check a generated question with Sonnet. Returns null when the verifier
 * isn't available (no API key, mock mode); callers should treat that as a
 * pass-through (no extra filtering).
 *
 * Cost: ~$0.005 per question (Sonnet 4.6, ~400 input + ~50 output tokens with
 * prompt caching on the system prompt). Roughly 5x Haiku but with materially
 * stronger knowledge — fewer false-pass and false-fail decisions.
 */
export async function verifyQuestion(
  input: VerifyInput
): Promise<VerifyOutput | null> {
  if (process.env.USE_MOCK_AI === "true") return null;
  const client = getClient();
  if (!client) return null;

  const userPayload = JSON.stringify({
    topic: input.topic,
    question: input.question,
    correct_answer: input.correctAnswer,
    distractors: input.distractors,
    source_hint: input.sourceHint,
  });

  try {
    const response = await client.messages.create({
      model: VERIFIER_MODEL,
      max_tokens: 200,
      system: [
        {
          type: "text",
          text: VERIFIER_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userPayload }],
    });

    const textBlock = response.content.find(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );
    if (!textBlock) return null;

    const cleaned = textBlock.text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "");
    const parsed = JSON.parse(cleaned) as Partial<VerifyOutput>;

    if (typeof parsed.accurate !== "boolean") return null;
    const confidence =
      parsed.confidence === "high" ||
      parsed.confidence === "medium" ||
      parsed.confidence === "low"
        ? parsed.confidence
        : "low";
    return {
      accurate: parsed.accurate,
      confidence,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
    };
  } catch (err) {
    console.warn("Verifier failed; passing question through:", err);
    return null;
  }
}
