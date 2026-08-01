/** A PR reference resolved from a URL or the `owner/repo#123` shorthand. */
export interface ParsedPr {
  owner: string;
  repo: string;
  number: number;
}

/**
 * Parse a PR reference — a github.com PR URL or the `owner/repo#123` shorthand — into its parts.
 *
 * Null for anything else, including a bare number: `139` only means something against a repo to
 * resolve it with, which the CLI infers from the git remote (`inferRepoFromGit`) and the daemon,
 * having no cwd, cannot.
 *
 * Lives here rather than in `cli.ts` because two doors now take a PR reference: `dad <pr>` and the
 * command center's add-PR field (POST /api/units). One parser means a reference that works in the
 * terminal works in the browser.
 */
export function parsePrRef(input: string): ParsedPr | null {
  if (!input) return null;
  const trimmed = input.trim();

  // Full URL: https://github.com/owner/repo/pull/123 (tolerating /files, ?diff=, #discussion tails)
  const urlMatch = trimmed.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/i);
  if (urlMatch) {
    const [, owner, repo, num] = urlMatch;
    if (owner && repo && num) {
      return { owner, repo, number: Number(num) };
    }
  }

  // Shorthand: owner/repo#123
  const shortMatch = trimmed.match(/^([^/\s#]+)\/([^/\s#]+)#(\d+)$/);
  if (shortMatch) {
    const [, owner, repo, num] = shortMatch;
    if (owner && repo && num) {
      return { owner, repo, number: Number(num) };
    }
  }

  return null;
}
