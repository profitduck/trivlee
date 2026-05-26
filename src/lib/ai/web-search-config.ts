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
 * Difficulty-aware web search budgets for the 3-stage pipeline.
 *
 * The researcher's budget is small on purpose: the validator runs an
 * independent web-search pass on every fact, so most of the researcher's
 * lookup work would be redundant. The researcher's training data is good
 * enough for common topics; we give it 1 search at D1-7 and 2 at D8-10 as
 * an escape hatch for niche/obscure subjects where Sonnet's training data
 * is shallow.
 *
 * The validator gets the real search budget — that's where independent
 * verification happens, including the Q9-style embellishment catch:
 * search the EXACT phrase the claim states; if the underlying event is
 * documented but the specific detail isn't, mark unverified.
 *
 * Token cost dominates each search call (~1.5-3K tokens of page content
 * returned as fresh input), so a lower cap saves both the per-search fee
 * AND those input tokens — typically ~5-10s of wall time per cut search.
 */
export function researcherSearchTool(difficulty: number) {
  const max_uses = difficulty >= 8 ? 2 : 1;
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
