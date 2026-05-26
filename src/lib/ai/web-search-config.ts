import "server-only";

/**
 * Reputable-source allowlist for the web_search tool used by the pipeline
 * researcher and validator. Domains that block Anthropic's crawler are
 * excluded (NYT, BBC, Reuters, AP, Guardian, Stack Overflow, Genius) —
 * including them returns 400 invalid_request_error.
 *
 * Tighter list = more reliable answers but more questions get dropped when
 * no allowed source backs them.
 */
export const WEB_SEARCH_ALLOWED_DOMAINS = [
  // Encyclopedias — accessible
  "wikipedia.org",
  "britannica.com",
  // Entertainment / fictional canon — accessible
  "fandom.com",
  "imdb.com",
  "metacritic.com",
  "rottentomatoes.com",
  // Music — accessible
  "musicbrainz.org",
  "discogs.com",
  // Books — accessible
  "goodreads.com",
  // News (current events) — only NPR is reliably crawlable; most large news
  // sites have blocked Anthropic's user agent.
  "npr.org",
  // Sports — accessible
  "espn.com",
  "nba.com",
  "mlb.com",
  "nfl.com",
  "nhl.com",
  "fifa.com",
  "olympics.com",
  // Tech / programming — accessible (Stack Overflow is blocked)
  "developer.mozilla.org",
  "python.org",
  "docs.python.org",
];

/**
 * Difficulty-aware web search budgets for the 3-stage pipeline. The model
 * self-rations searches when confident, so common-topic generations rarely
 * use the full budget anyway. Trimming caps for D1-7 (most matches) saves
 * both the per-search fee ($0.01) and the input tokens for returned page
 * content (~1.5-3K tokens per result). D8-10 keeps the full budget because
 * niche/obscure facts genuinely need more lookups.
 *
 * Token cost dominates: at D1-7 the savings come almost entirely from
 * fewer pages of search content flowing into the conversation as input.
 */
export function researcherSearchTool(difficulty: number) {
  const max_uses = difficulty >= 8 ? 5 : 3;
  return {
    type: "web_search_20260209" as const,
    name: "web_search" as const,
    allowed_domains: WEB_SEARCH_ALLOWED_DOMAINS,
    max_uses,
  };
}

export function validatorSearchTool(difficulty: number) {
  const max_uses = difficulty >= 8 ? 8 : 5;
  return {
    type: "web_search_20260209" as const,
    name: "web_search" as const,
    allowed_domains: WEB_SEARCH_ALLOWED_DOMAINS,
    max_uses,
  };
}
