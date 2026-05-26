import "server-only";

/**
 * Reputable-source allowlist for the web_search tool used by both the
 * generator and the verifier. We've pruned domains that block Anthropic's
 * crawler (NYT, BBC, Reuters, AP, Guardian, Stack Overflow, Genius) — those
 * cause a 400 invalid_request_error when listed in allowed_domains.
 *
 * Tighter list = more reliable answers but more questions get dropped when
 * no allowed source backs them. After 50+ matches we'll have data to widen
 * carefully.
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

export const VERIFIER_WEB_SEARCH_TOOL = {
  type: "web_search_20260209" as const,
  name: "web_search" as const,
  allowed_domains: WEB_SEARCH_ALLOWED_DOMAINS,
  max_uses: 2,
};

export const GENERATOR_WEB_SEARCH_TOOL = {
  type: "web_search_20260209" as const,
  name: "web_search" as const,
  allowed_domains: WEB_SEARCH_ALLOWED_DOMAINS,
  max_uses: 5,
};
