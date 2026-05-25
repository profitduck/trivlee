import "server-only";
import Anthropic from "@anthropic-ai/sdk";

const JUDGE_MODEL = "claude-haiku-4-5";

const JUDGE_SYSTEM_PROMPT = `You are a strict but fair grader for short trivia answers.

You receive:
- the question
- the canonical correct answer
- a list of acceptable variants (aliases)
- the user's typed answer

Score from 0.0 to 1.0:
- 1.0: Correct. Same as the canonical answer or an obvious variant, even if phrased differently. Forgive typos, missing articles ("the"), word order, capitalization, and minor spelling errors.
- 0.7-0.9: Substantively correct but missing a key qualifier, or named at a slightly less specific level than asked. Example: question asks for the album, user answers the artist's name correctly but for the wrong album in their catalog → 0.0. User answers the right album but spells one word wrong → 1.0.
- 0.4-0.6: Partial credit. The user shows knowledge of the right area but the specific answer is wrong or incomplete. Example: question asks for a specific character; user names a different character from the same show.
- 0.0-0.3: Wrong, off-topic, or empty.

Rules of thumb:
- If the question asks for ONE specific thing (a name, a year, a title), the user must name THAT thing. Don't accept a parent category or a sibling item.
- If the user types something that's a real fact in the same domain but answers a DIFFERENT question, score 0.0-0.2.
- Empty or whitespace-only answers always score 0.0.
- If the user names a different real entity that could plausibly answer a similar question, score 0.1-0.3.

Output strict JSON only (no prose, no code fences):
{
  "score": number,        // 0.0 to 1.0 with one decimal
  "is_correct": boolean,  // true only if score >= 0.9
  "reason": "string"      // one short sentence, max 15 words, no meta-commentary
}`;

export interface JudgeInput {
  question: string;
  correctAnswer: string;
  aliases: string[];
  userAnswer: string;
}

export interface JudgeOutput {
  score: number;
  isCorrect: boolean;
  reason: string;
}

const globalForAnthropic = globalThis as unknown as { __judgeClient?: Anthropic };

function getClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  if (!globalForAnthropic.__judgeClient) {
    globalForAnthropic.__judgeClient = new Anthropic({ apiKey });
  }
  return globalForAnthropic.__judgeClient;
}

/**
 * Grade a free-text answer using a small Claude model. Returns null when the
 * judge isn't available (no API key, mock mode); callers should fall back to
 * the local heuristic grader in those cases.
 */
export async function llmJudge(input: JudgeInput): Promise<JudgeOutput | null> {
  if (process.env.USE_MOCK_AI === "true") return null;
  const client = getClient();
  if (!client) return null;

  const userPayload = JSON.stringify({
    question: input.question,
    correct_answer: input.correctAnswer,
    aliases: input.aliases,
    user_answer: input.userAnswer,
  });

  try {
    const response = await client.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 200,
      system: [
        {
          type: "text",
          text: JUDGE_SYSTEM_PROMPT,
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
    const parsed = JSON.parse(cleaned) as Partial<{
      score: number;
      is_correct: boolean;
      reason: string;
    }>;

    if (typeof parsed.score !== "number") return null;
    const score = Math.max(0, Math.min(1, parsed.score));
    return {
      score,
      isCorrect: parsed.is_correct === true || score >= 0.9,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
    };
  } catch (err) {
    console.warn("LLM judge failed; falling back to local grader:", err);
    return null;
  }
}
