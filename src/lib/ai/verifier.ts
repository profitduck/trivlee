import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { VERIFIER_WEB_SEARCH_TOOL } from "./web-search-config";

const VERIFIER_MODEL = "claude-sonnet-4-6";

const VERIFIER_SYSTEM_PROMPT = `You are a strict trivia fact-checker. You receive a candidate question with its claimed correct answer (and distractors, if multiple-choice) and the writer's stated source. Your job is to catch three failure modes:

1. **Fabrication.** The question references something that doesn't exist in canon — a character whose name was never given, an episode that doesn't exist, a quote misattributed, an invented fact.
2. **Cross-property conflation.** The question is supposedly about Topic X but the answer comes from Topic Y (different show, different book, different artist).
3. **Wrong specifics.** The question is on-topic but the specific detail is misremembered — wrong year, wrong character, wrong episode, wrong role assignment.

# Web search

You have access to a \`web_search\` tool restricted to reputable domains (Wikipedia, Britannica, Fandom, IMDB, major news outlets, official sports/music sites). Use it freely to check claims you're not certain about — that's why it's here. Prefer Wikipedia first when available. You have up to 2 searches per question; spend them on the highest-impact uncertainty.

Search whenever:
- The question references a specific episode title, year, name, role, or quote
- The topic is one you might have shallow training data on (niche shows, recent events, specific in-canon details)
- A distractor looks like it could plausibly be the right answer

Do NOT search for:
- Subjective trivia ("best episode") — those should already be rejected by the writer
- Trivially obvious facts you're 99% sure of (skip the search; it wastes the budget)

# Decision rules

Be STRICT. If you're not at least 85% confident the claimed correct answer is right (after searching, if you searched), mark it inaccurate.

Special cases:
- If the question presupposes a fact that was NEVER canonically established (e.g. asking the "real name" of a character whose name was never revealed in canon), mark inaccurate.
- If one of the distractors is actually a more correct answer than the labeled one, mark inaccurate and name which distractor.
- If no allowed source has clear information AND your own knowledge is uncertain, return confidence: "low" — the question will be dropped.

# Output

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
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: VERIFIER_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      tools: [VERIFIER_WEB_SEARCH_TOOL],
      messages: [{ role: "user", content: userPayload }],
    });

    // Find the LAST text block (after any web_search tool_use/result blocks).
    // Web search interleaves "let me search for X" preamble text with actual
    // search results before the final JSON answer.
    const textBlocks = response.content.filter(
      (b): b is Anthropic.TextBlock => b.type === "text"
    );
    const textBlock = textBlocks[textBlocks.length - 1];
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
