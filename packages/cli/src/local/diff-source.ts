import { createHash } from 'crypto';
import { parseDiff } from '../github/diff-parser';
import type { DiffFile, PRMetadata } from '../github/types';
import { assertGitRepo, resolveDefaultBranch, spawnText } from './git';

export class CleanTreeError extends Error {
  constructor(public readonly baseRef: string) {
    super(`nothing to review — working tree is clean against ${baseRef}`);
    this.name = 'CleanTreeError';
  }
}

export type LocalReview = {
  files: DiffFile[];
  metadata: PRMetadata;
  /** sha256(diff) slice — the narrative cache key (HEAD sha doesn't move on uncommitted edits). */
  contentKey: string;
  /** The resolved base ref — the agent-comment store key. */
  baseRef: string;
};

type DiffMeta = { branch: string; headSha: string; baseRef: string; createdAt: string };

function countLines(files: DiffFile[]): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const f of files) {
    for (const h of f.hunks) {
      for (const l of h.lines) {
        if (l.type === 'add') additions++;
        else if (l.type === 'remove') deletions++;
      }
    }
  }
  return { additions, deletions };
}

/**
 * Pure core: turn raw `git diff` text + git metadata into a LocalReview. Throws CleanTreeError
 * on an empty diff (parseDiff itself returns [] rather than erroring). Unit-testable without git.
 */
export function buildReviewFromDiff(diff: string, meta: DiffMeta): LocalReview {
  if (!diff.trim()) throw new CleanTreeError(meta.baseRef);
  const files = parseDiff(diff);
  if (files.length === 0) throw new CleanTreeError(meta.baseRef);

  const { additions, deletions } = countLines(files);
  const metadata: PRMetadata = {
    number: 0, // local sentinel — never used for GitHub calls in watch mode
    title: meta.branch,
    body: '',
    state: 'open',
    draft: false,
    author: { login: 'local', avatarUrl: '' },
    branch: meta.branch,
    base: meta.baseRef,
    labels: [],
    createdAt: meta.createdAt,
    updatedAt: meta.createdAt,
    additions,
    deletions,
    changedFiles: files.length,
    commits: 0,
    headSha: meta.headSha,
  };

  const contentKey = createHash('sha256').update(diff).digest('hex').slice(0, 12);
  return { files, metadata, contentKey, baseRef: meta.baseRef };
}

/**
 * Resolve the base ref to diff against: the explicit `base`, else the merge-base of HEAD with
 * the default branch. Stable per branch → used as the agent-comment store key by both
 * `dad watch` and `dad comments` so they share a comment thread.
 */
export async function resolveBaseRef(base?: string): Promise<string> {
  if (base) return base;
  const def = await resolveDefaultBranch();
  if (!def) {
    throw new Error('could not determine a base branch — pass one explicitly, e.g. `dad watch main`');
  }
  const mb = await spawnText(['git', 'merge-base', 'HEAD', def]);
  return mb.code === 0 && mb.stdout.trim() ? mb.stdout.trim() : def;
}

/** Shell out to git, building a LocalReview of the working tree against `base` (or the default branch). */
export async function buildLocalReview(base?: string): Promise<LocalReview> {
  await assertGitRepo();
  const baseRef = await resolveBaseRef(base);

  const [diff, branch, headSha] = await Promise.all([
    spawnText(['git', 'diff', baseRef]),
    spawnText(['git', 'rev-parse', '--abbrev-ref', 'HEAD']),
    spawnText(['git', 'rev-parse', 'HEAD']),
  ]);
  if (diff.code !== 0) {
    throw new Error(`git diff failed: ${diff.stderr.trim() || `exit ${diff.code}`}`);
  }

  return buildReviewFromDiff(diff.stdout, {
    branch: branch.stdout.trim() || 'working-tree',
    headSha: headSha.stdout.trim(),
    baseRef,
    createdAt: new Date().toISOString(),
  });
}
