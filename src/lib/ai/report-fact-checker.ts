import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { query } from "@/lib/db";
import { finalizeAllParticipants } from "@/lib/matches";
import { getAnthropicClient, parseStrictJson, PIPELINE_MODEL } from "./client";
import { validatorSearchTool } from "./web-search-config";

const REPORT_FACT_CHECK_MODEL = process.env.REPORT_FACT_CHECK_MODEL ?? PIPELINE_MODEL;
const SEARCH_TIMEOUT_MS = 45_000;
const FALLBACK_TIMEOUT_MS = 18_000;
const AUTO_HIDE_CONFIDENCE = 0.85;

const SYSTEM_PROMPT = `You are Trivlee's skeptical fact checker for player-reported trivia questions.

Decide whether the stated correct answer is accurate for the exact question as written.

Verdicts:
- supported: the question is clear and the stated answer is correct or an acceptable alias.
- wrong_answer: the question is clear, but the stated answer is incorrect.
- bad_question: the question is ambiguous, asks a false/unsupported premise, has multiple likely correct answers, or the source does not support the exact wording.
- uncertain: you cannot verify the exact question/answer with high confidence.

Rules:
- Do not trust the player's report reason by itself. Verify the question and stated answer.
- Search exact episode/book/song/quote/source wording when available.
- If a source supports a related fact but not a specific embellishment in the question, use bad_question.
- Use supported only when the exact answer is strongly backed.
- Be conservative: when evidence is thin or conflicting, use uncertain instead of supported.

Output strict JSON only:
{
  "verdict": "supported" | "wrong_answer" | "bad_question" | "uncertain",
  "confidence": number,
  "summary": "one concise admin-facing sentence",
  "evidence": "brief evidence summary, max 240 characters",
  "corrected_answer": "string or null",
  "sources": ["short source names or URLs"]
}`;

type FactCheckVerdict =
  | "supported"
  | "wrong_answer"
  | "bad_question"
  | "uncertain"
  | "error";

interface ReportFactCheckRow {
  id: string;
  question_id: string;
  challenge_id: string;
  challenge_status: string;
  bank_question_id: string | null;
  reason: string;
  question_text: string;
  correct_answer: string;
  answer_aliases: unknown;
  distractors: unknown;
  source_hint: string | null;
  type: string;
  per_question_format: string;
  challenge_topic: string;
  difficulty: number;
}

interface RawFactCheck {
  verdict?: unknown;
  confidence?: unknown;
  summary?: unknown;
  evidence?: unknown;
  corrected_answer?: unknown;
  sources?: unknown;
}

interface NormalizedFactCheck {
  verdict: Exclude<FactCheckVerdict, "error">;
  confidence: number;
  summary: string;
  evidence: string;
  correctedAnswer: string | null;
  sources: string[];
  model: string;
}

export async function factCheckReportedQuestion(reportId: string): Promise<void> {
  try {
    const report = await getReport(reportId);
    if (!report) return;

    if (process.env.USE_MOCK_AI === "true" || !process.env.ANTHROPIC_API_KEY) {
      await updateReportFactCheck(reportId, {
        verdict: "error",
        confidence: null,
        summary: "AI fact checker is not configured.",
        evidence: null,
        correctedAnswer: null,
        sources: [],
        model: null,
      });
      return;
    }

    const result = await runFactCheck(report);
    await updateReportFactCheck(reportId, result);

    if (
      report.bank_question_id &&
      result.confidence >= AUTO_HIDE_CONFIDENCE &&
      (result.verdict === "wrong_answer" || result.verdict === "bad_question")
    ) {
      await query(
        `UPDATE question_bank SET hidden = true WHERE id = $1`,
        [report.bank_question_id]
      );
      if (report.challenge_status === "completed") {
        await finalizeAllParticipants(report.challenge_id);
      }
    }
  } catch (err) {
    console.error("[report-fact-checker] failed:", err);
    await updateReportFactCheck(reportId, {
      verdict: "error",
      confidence: null,
      summary: "AI fact check failed before producing a verdict.",
      evidence: summarizeError(err),
      correctedAnswer: null,
      sources: [],
      model: REPORT_FACT_CHECK_MODEL,
    });
  }
}

async function getReport(reportId: string): Promise<ReportFactCheckRow | null> {
  const { rows } = await query<ReportFactCheckRow>(
    `SELECT
       qr.id,
       qr.question_id,
       qs.challenge_id,
       c.status::text AS challenge_status,
       qr.reason,
       q.bank_question_id,
       q.question_text,
       q.correct_answer,
       q.answer_aliases,
       q.distractors,
       q.source_hint,
       q.type::text AS type,
       q.per_question_format::text AS per_question_format,
       c.topic AS challenge_topic,
       qs.difficulty
     FROM question_reports qr
     JOIN questions q ON q.id = qr.question_id
     JOIN question_sets qs ON qs.id = q.set_id
     JOIN challenges c ON c.id = qs.challenge_id
     WHERE qr.id = $1`,
    [reportId]
  );
  return rows[0] ?? null;
}

async function runFactCheck(report: ReportFactCheckRow): Promise<NormalizedFactCheck> {
  try {
    return await callFactChecker(report, true);
  } catch (err) {
    console.warn("[report-fact-checker] search check failed; retrying without search:", err);
    return callFactChecker(report, false);
  }
}

async function callFactChecker(
  report: ReportFactCheckRow,
  withSearch: boolean
): Promise<NormalizedFactCheck> {
  const client = getAnthropicClient();
  const payload = JSON.stringify({
    topic: report.challenge_topic,
    difficulty: report.difficulty,
    question: report.question_text,
    stated_answer: report.correct_answer,
    aliases: asStringArray(report.answer_aliases),
    distractors: asStringArray(report.distractors),
    source_hint: report.source_hint,
    question_type: report.type,
    format: report.per_question_format,
    report_reason: report.reason,
  });

  const response = await client.messages.create(
    {
      model: REPORT_FACT_CHECK_MODEL,
      max_tokens: 900,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      ...(withSearch ? { tools: [validatorSearchTool(report.difficulty)] } : {}),
      messages: [{ role: "user", content: payload }],
    },
    {
      maxRetries: 0,
      timeout: withSearch ? SEARCH_TIMEOUT_MS : FALLBACK_TIMEOUT_MS,
    }
  );

  const textBlock = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .at(-1);
  if (!textBlock) {
    throw new Error("Fact checker returned no text block.");
  }

  return normalizeFactCheck(parseStrictJson(textBlock.text), REPORT_FACT_CHECK_MODEL);
}

function normalizeFactCheck(raw: unknown, model: string): NormalizedFactCheck {
  const parsed = (raw ?? {}) as RawFactCheck;
  const verdict = normalizeVerdict(parsed.verdict);
  const confidence =
    typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : verdict === "uncertain"
        ? 0.4
        : 0.7;

  return {
    verdict,
    confidence,
    summary: trimString(parsed.summary, 180) || "AI fact check completed.",
    evidence: trimString(parsed.evidence, 280),
    correctedAnswer: trimString(parsed.corrected_answer, 120) || null,
    sources: asStringArray(parsed.sources).slice(0, 4),
    model,
  };
}

function normalizeVerdict(value: unknown): NormalizedFactCheck["verdict"] {
  if (
    value === "supported" ||
    value === "wrong_answer" ||
    value === "bad_question" ||
    value === "uncertain"
  ) {
    return value;
  }
  return "uncertain";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function trimString(value: unknown, maxLength: number): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}...`;
}

async function updateReportFactCheck(
  reportId: string,
  result: {
    verdict: FactCheckVerdict;
    confidence: number | null;
    summary: string | null;
    evidence: string | null;
    correctedAnswer: string | null;
    sources: string[];
    model: string | null;
  }
): Promise<void> {
  await query(
    `UPDATE question_reports
        SET ai_fact_check_verdict = $2,
            ai_fact_check_confidence = $3,
            ai_fact_check_summary = $4,
            ai_fact_check_evidence = $5,
            ai_fact_check_corrected_answer = $6,
            ai_fact_check_sources = $7::jsonb,
            ai_fact_check_model = $8,
            ai_fact_checked_at = now()
      WHERE id = $1`,
    [
      reportId,
      result.verdict,
      result.confidence,
      result.summary,
      result.evidence,
      result.correctedAnswer,
      JSON.stringify(result.sources),
      result.model,
    ]
  );
}

function summarizeError(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    return `${err.status}: ${err.message}`.slice(0, 280);
  }
  if (err instanceof Error) {
    return err.message.slice(0, 280);
  }
  return "Unknown error";
}
