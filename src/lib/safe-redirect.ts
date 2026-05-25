/**
 * Validate a `next` redirect target. Only allow same-origin relative paths.
 * Reject anything that could be an open-redirect (absolute URLs, `//host`,
 * `javascript:` etc.).
 */
export function safeNextPath(raw: string | undefined | null, fallback = "/dashboard"): string {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  // Must start with a single forward slash.
  if (!trimmed.startsWith("/")) return fallback;
  // Reject protocol-relative URLs like //evil.com or backslash variants.
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\") || trimmed.includes("\\")) return fallback;
  // Reject schemes (javascript:, data:, etc.) — paranoid since startsWith("/") should already block these.
  if (/^\/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return fallback;
  return trimmed;
}
