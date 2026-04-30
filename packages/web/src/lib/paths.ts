/**
 * Normalize a file path so that GitHub comment paths and diff/narrative
 * paths can be compared safely. Strips git-style `a/`/`b/` prefixes and
 * leading slashes. Lowercases nothing — paths are case-sensitive on most
 * platforms — but trims whitespace.
 */
export function normalizePath(p: string | undefined | null): string {
  if (!p) return "";
  return p.trim().replace(/^[ab]\//, "").replace(/^\/+/, "");
}
