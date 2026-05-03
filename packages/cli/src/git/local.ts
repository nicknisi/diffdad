import { createHash } from 'crypto';
import { resolve } from 'path';

export type LocalCommit = {
  sha: string;
  shortSha: string;
  subject: string;
  body: string;
  author: { name: string; email: string };
  date: string;
  parents: string[];
};

export class GitError extends Error {
  constructor(
    message: string,
    public readonly stderr?: string,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

async function run(args: string[], cwd?: string): Promise<string> {
  const proc = Bun.spawn(['git', ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    cwd,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new GitError(`git ${args.join(' ')} failed (exit ${exitCode}): ${stderr.trim()}`, stderr);
  }
  return stdout;
}

async function tryRun(args: string[], cwd?: string): Promise<string | null> {
  try {
    return await run(args, cwd);
  } catch {
    return null;
  }
}

export async function findRepoRoot(cwd: string = process.cwd()): Promise<string> {
  const out = await run(['rev-parse', '--show-toplevel'], cwd);
  return out.trim();
}

export async function getCurrentBranch(cwd?: string): Promise<string> {
  const out = await run(['symbolic-ref', '--short', 'HEAD'], cwd);
  return out.trim();
}

export async function getHeadSha(branch?: string, cwd?: string): Promise<string> {
  const ref = branch ?? 'HEAD';
  const out = await run(['rev-parse', ref], cwd);
  return out.trim();
}

export async function branchExists(branch: string, cwd?: string): Promise<boolean> {
  const out = await tryRun(['rev-parse', '--verify', '--quiet', branch], cwd);
  return out !== null && out.trim().length > 0;
}

/**
 * Detect the base branch this branch should be compared against.
 * Order:
 *   1. origin/HEAD symbolic ref (the conventional default)
 *   2. main, then master, if they exist locally or on origin
 */
export async function detectBaseBranch(cwd?: string): Promise<string> {
  const symbolic = await tryRun(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], cwd);
  if (symbolic) {
    const ref = symbolic.trim();
    if (ref.length > 0) return ref;
  }

  for (const candidate of ['origin/main', 'main', 'origin/master', 'master']) {
    if (await branchExists(candidate, cwd)) return candidate;
  }

  throw new GitError(
    "Couldn't detect a base branch (tried origin/HEAD, main, master). Pass --base <ref> to specify one.",
  );
}

export async function mergeBase(base: string, head: string, cwd?: string): Promise<string> {
  const out = await run(['merge-base', base, head], cwd);
  return out.trim();
}

const COMMIT_FIELD_SEP = '\x1f';
const COMMIT_RECORD_SEP = '\x1e';

/**
 * List commits in `base..head` from oldest to newest.
 * Skips merge commits — narration of merge diffs is brittle and rarely
 * tells a useful story.
 */
export async function listCommits(base: string, head: string, cwd?: string): Promise<LocalCommit[]> {
  const format = ['%H', '%h', '%s', '%b', '%an', '%ae', '%aI', '%P'].join(COMMIT_FIELD_SEP) + COMMIT_RECORD_SEP;
  const out = await run(['log', '--no-merges', '--reverse', `--format=${format}`, `${base}..${head}`], cwd);

  if (!out.trim()) return [];

  const records = out.split(COMMIT_RECORD_SEP).filter((r) => r.trim().length > 0);
  return records.map((record) => {
    const fields = record.replace(/^\n/, '').split(COMMIT_FIELD_SEP);
    const [sha, shortSha, subject, body, authorName, authorEmail, date, parents] = fields;
    return {
      sha: (sha ?? '').trim(),
      shortSha: (shortSha ?? '').trim(),
      subject: (subject ?? '').trim(),
      body: (body ?? '').trim(),
      author: { name: (authorName ?? '').trim(), email: (authorEmail ?? '').trim() },
      date: (date ?? '').trim(),
      parents: (parents ?? '').trim().split(/\s+/).filter(Boolean),
    };
  });
}

/**
 * Get the diff for a single commit. Uses `<sha>^..<sha>` for non-root
 * commits, and falls back to `git show --format=` for root commits where
 * `<sha>^` doesn't resolve.
 */
export async function getDiffForCommit(sha: string, cwd?: string): Promise<string> {
  const parent = await tryRun(['rev-parse', '--verify', '--quiet', `${sha}^`], cwd);
  if (parent && parent.trim().length > 0) {
    return await run(['diff', `${sha}^..${sha}`], cwd);
  }
  // Root commit: emit the whole thing as a diff against the empty tree.
  return await run(['show', '--format=', sha], cwd);
}

export async function getDiffForRange(base: string, head: string, cwd?: string): Promise<string> {
  return await run(['diff', `${base}...${head}`], cwd);
}

/**
 * Compute commit-level totals (additions, deletions, files changed) for a
 * range, used to populate the synthetic PR metadata in watch mode.
 */
export async function getRangeStats(
  base: string,
  head: string,
  cwd?: string,
): Promise<{ additions: number; deletions: number; changedFiles: number }> {
  const out = await run(['diff', '--numstat', `${base}...${head}`], cwd);
  let additions = 0;
  let deletions = 0;
  let files = 0;
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [a, d] = line.split('\t');
    if (a === '-' || d === '-') {
      // binary file
      files += 1;
      continue;
    }
    const an = Number(a);
    const dn = Number(d);
    if (!Number.isNaN(an)) additions += an;
    if (!Number.isNaN(dn)) deletions += dn;
    files += 1;
  }
  return { additions, deletions, changedFiles: files };
}

export async function getCommitStats(
  sha: string,
  cwd?: string,
): Promise<{ additions: number; deletions: number; changedFiles: number }> {
  const parent = await tryRun(['rev-parse', '--verify', '--quiet', `${sha}^`], cwd);
  if (parent && parent.trim().length > 0) {
    return getRangeStats(`${sha}^`, sha, cwd);
  }
  // Root commit — `git show --numstat` works without needing a parent.
  const out = await run(['show', '--numstat', '--format=', sha], cwd);
  let additions = 0;
  let deletions = 0;
  let files = 0;
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    const [a, d] = line.split('\t');
    if (a === '-' || d === '-') {
      files += 1;
      continue;
    }
    const an = Number(a);
    const dn = Number(d);
    if (!Number.isNaN(an)) additions += an;
    if (!Number.isNaN(dn)) deletions += dn;
    files += 1;
  }
  return { additions, deletions, changedFiles: files };
}

/**
 * Stable short hash of an absolute repo path, used as a cache namespace so
 * two checkouts of the same repo don't collide.
 */
export function repoFingerprint(repoRoot: string): string {
  const abs = resolve(repoRoot);
  return createHash('sha1').update(abs).digest('hex').slice(0, 12);
}

/**
 * Try to infer owner/repo from the origin remote, for building GitHub URLs
 * (used only for display links — watch mode doesn't call the GitHub API).
 */
export async function getRemoteSlug(cwd?: string): Promise<{ owner: string; repo: string } | null> {
  const url = await tryRun(['remote', 'get-url', 'origin'], cwd);
  if (!url) return null;
  const trimmed = url.trim();
  const ssh = trimmed.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (ssh) return { owner: ssh[1]!, repo: ssh[2]! };
  const https = trimmed.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (https) return { owner: https[1]!, repo: https[2]! };
  return null;
}
