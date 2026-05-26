import Anthropic from "@anthropic-ai/sdk";
import pg from "pg";

const MODEL = process.env.REPORT_FACT_CHECK_MODEL ?? "claude-sonnet-4-6";
const SEARCH_TIMEOUT_MS = Number(process.env.FACT_CHECK_SEARCH_TIMEOUT_MS ?? 45_000);
const FALLBACK_TIMEOUT_MS = Number(process.env.FACT_CHECK_FALLBACK_TIMEOUT_MS ?? 18_000);
const AUTO_HIDE_CONFIDENCE = Number(process.env.FACT_CHECK_AUTO_HIDE_CONFIDENCE ?? 0.85);

const WEB_SEARCH_ALLOWED_DOMAINS = [
  "wikipedia.org",
  "britannica.com",
  "wikiquote.org",
  "fandom.com",
  "imdb.com",
  "metacritic.com",
  "rottentomatoes.com",
  "musicbrainz.org",
  "discogs.com",
  "goodreads.com",
  "npr.org",
  "espn.com",
  "nba.com",
  "mlb.com",
  "nfl.com",
  "nhl.com",
  "fifa.com",
  "olympics.com",
  "developer.mozilla.org",
  "python.org",
  "docs.python.org",
];

const SYSTEM_PROMPT = `You are Trivlee's skeptical fact checker for generated trivia questions.

Decide whether the stated correct answer is accurate for the exact question as written.

Verdicts:
- supported: the question is clear and the stated answer is correct or an acceptable alias.
- wrong_answer: the question is clear, but the stated answer is incorrect.
- bad_question: the question is ambiguous, asks a false/unsupported premise, has multiple likely correct answers, or the source does not support the exact wording.
- uncertain: you cannot verify the exact question/answer with high confidence.

Rules:
- Verify the exact question and stated answer, not just a related fact.
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

const args = parseArgs(process.argv.slice(2));
const dryRun = args.has("dry-run");
const recheck = args.has("recheck");
const noSearch = args.has("no-search");
const skipHidden = args.has("skip-hidden");
const limit = positiveInt(args.get("limit") ?? process.env.FACT_CHECK_LIMIT);
const concurrency = Math.max(
  1,
  Math.min(5, positiveInt(args.get("concurrency") ?? process.env.FACT_CHECK_CONCURRENCY) ?? 2)
);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

if (!dryRun && !process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is not set. Use --dry-run to count only.");
  process.exit(1);
}

const ssl =
  process.env.NODE_ENV === "production" && process.env.PGSSL !== "false"
    ? { rejectUnauthorized: false }
    : undefined;

const db = new pg.Client({ connectionString, ssl });
await db.connect();

try {
  const candidates = await getCandidates();
  console.log(
    `Question-bank fact check: ${candidates.length} candidate(s)` +
      `${limit ? `, limit ${limit}` : ""}` +
      `${recheck ? ", rechecking existing verdicts" : ""}` +
      `${skipHidden ? ", skipping hidden rows" : ""}` +
      `${noSearch ? ", no web search" : ""}`
  );

  if (dryRun || candidates.length === 0) {
    process.exit(0);
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const stats = {
    supported: 0,
    wrong_answer: 0,
    bad_question: 0,
    uncertain: 0,
    error: 0,
    hidden: 0,
  };
  let next = 0;

  async function worker(workerId) {
    while (next < candidates.length) {
      const current = next++;
      const row = candidates[current];
      const label = `[${current + 1}/${candidates.length} w${workerId}]`;
      try {
        const result = await factCheck(client, row);
        const autoHide =
          result.confidence >= AUTO_HIDE_CONFIDENCE &&
          (result.verdict === "wrong_answer" || result.verdict === "bad_question");
        await saveResult(row.id, result, autoHide);
        stats[result.verdict]++;
        if (autoHide) stats.hidden++;
        console.log(
          `${label} ${result.verdict} ${Math.round(result.confidence * 100)}%` +
            `${autoHide ? " hidden" : ""} - ${row.topic_normalized}: ${row.question_text}`
        );
      } catch (err) {
        const summary = summarizeError(err);
        await saveResult(
          row.id,
          {
            verdict: "error",
            confidence: null,
            summary: "Fact check failed before producing a verdict.",
            evidence: summary,
            corrected_answer: null,
            sources: [],
            model: MODEL,
          },
          false
        );
        stats.error++;
        console.warn(`${label} error - ${row.topic_normalized}: ${summary}`);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, candidates.length) }, (_, i) => worker(i + 1))
  );

  console.log(
    `Done. supported=${stats.supported}, wrong_answer=${stats.wrong_answer}, ` +
      `bad_question=${stats.bad_question}, uncertain=${stats.uncertain}, ` +
      `error=${stats.error}, newly_hidden=${stats.hidden}`
  );
} finally {
  await db.end();
}

async function getCandidates() {
  const filters = [];
  if (!recheck) {
    filters.push("(fact_check_verdict = 'pending' OR fact_checked_at IS NULL)");
  }
  if (skipHidden) {
    filters.push("hidden = false");
  }
  const where = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";
  const limitClause = limit ? "LIMIT $1" : "";
  const params = limit ? [limit] : [];

  const { rows } = await db.query(
    `SELECT
       id,
       topic_normalized,
       difficulty,
       per_question_format::text AS per_question_format,
       question_text,
       correct_answer,
       answer_aliases,
       distractors,
       source_hint,
       type::text AS type,
       hidden,
       report_count,
       times_used
     FROM question_bank
     ${where}
     ORDER BY
       hidden ASC,
       report_count DESC,
       times_used DESC,
       created_at ASC
     ${limitClause}`,
    params
  );
  return rows;
}

async function factCheck(client, row) {
  try {
    return await callFactChecker(client, row, !noSearch);
  } catch (err) {
    if (noSearch) throw err;
    console.warn(`Search fact check failed for ${row.id}; retrying without search: ${summarizeError(err)}`);
    return callFactChecker(client, row, false);
  }
}

async function callFactChecker(client, row, withSearch) {
  const payload = JSON.stringify({
    topic: row.topic_normalized,
    difficulty: row.difficulty,
    question: row.question_text,
    stated_answer: row.correct_answer,
    aliases: asStringArray(row.answer_aliases),
    distractors: asStringArray(row.distractors),
    source_hint: row.source_hint,
    question_type: row.type,
    format: row.per_question_format,
    bank_usage_count: row.times_used,
    report_count: row.report_count,
  });

  const response = await client.messages.create(
    {
      model: MODEL,
      max_tokens: 900,
      system: [
        {
          type: "text",
          text: SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      ...(withSearch
        ? {
            tools: [
              {
                type: "web_search_20260209",
                name: "web_search",
                allowed_domains: WEB_SEARCH_ALLOWED_DOMAINS,
                max_uses: row.difficulty >= 8 ? 3 : 2,
              },
            ],
          }
        : {}),
      messages: [{ role: "user", content: payload }],
    },
    {
      maxRetries: 0,
      timeout: withSearch ? SEARCH_TIMEOUT_MS : FALLBACK_TIMEOUT_MS,
    }
  );

  const textBlock = response.content.filter((block) => block.type === "text").at(-1);
  if (!textBlock) {
    throw new Error("Fact checker returned no text block.");
  }
  return normalizeFactCheck(parseStrictJson(textBlock.text));
}

function normalizeFactCheck(raw) {
  const verdict = normalizeVerdict(raw?.verdict);
  const confidence =
    typeof raw?.confidence === "number"
      ? Math.max(0, Math.min(1, raw.confidence))
      : verdict === "uncertain"
        ? 0.4
        : 0.7;

  return {
    verdict,
    confidence,
    summary: trimString(raw?.summary, 180) || "AI fact check completed.",
    evidence: trimString(raw?.evidence, 280),
    corrected_answer: trimString(raw?.corrected_answer, 120) || null,
    sources: asStringArray(raw?.sources).slice(0, 4),
    model: MODEL,
  };
}

async function saveResult(bankQuestionId, result, autoHide) {
  await db.query(
    `UPDATE question_bank
        SET fact_check_verdict = $2,
            fact_check_confidence = $3,
            fact_check_summary = $4,
            fact_check_evidence = $5,
            fact_check_corrected_answer = $6,
            fact_check_sources = $7::jsonb,
            fact_check_model = $8,
            fact_checked_at = now(),
            hidden = CASE WHEN $9 THEN true ELSE hidden END
      WHERE id = $1`,
    [
      bankQuestionId,
      result.verdict,
      result.confidence,
      result.summary,
      result.evidence,
      result.corrected_answer,
      JSON.stringify(result.sources),
      result.model,
      autoHide,
    ]
  );
}

function parseArgs(rawArgs) {
  const out = new Map();
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (!arg.startsWith("--")) continue;
    const withoutPrefix = arg.slice(2);
    const eq = withoutPrefix.indexOf("=");
    if (eq >= 0) {
      out.set(withoutPrefix.slice(0, eq), withoutPrefix.slice(eq + 1));
    } else if (rawArgs[i + 1] && !rawArgs[i + 1].startsWith("--")) {
      out.set(withoutPrefix, rawArgs[i + 1]);
      i++;
    } else {
      out.set(withoutPrefix, "true");
    }
  }
  return out;
}

function positiveInt(value) {
  if (!value) return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeVerdict(value) {
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

function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function trimString(value, maxLength) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}...`;
}

function parseStrictJson(raw) {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const firstBrace = trimmed.search(/[{\[]/);
    const lastBrace = Math.max(trimmed.lastIndexOf("}"), trimmed.lastIndexOf("]"));
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    }
    throw new Error(`Model returned non-JSON output. First 200 chars: ${raw.slice(0, 200)}`);
  }
}

function summarizeError(err) {
  if (err instanceof Anthropic.APIError) {
    return `${err.status}: ${err.message}`.slice(0, 280);
  }
  if (err instanceof Error) {
    return err.message.slice(0, 280);
  }
  return "Unknown error";
}
