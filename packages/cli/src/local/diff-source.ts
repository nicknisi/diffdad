import { createHash } from 'crypto';
import { statSync } from 'fs';
import { join } from 'path';
import { parseDiff } from '../github/diff-parser';
import type { DiffFile, PRMetadata } from '../github/types';
import { assertGitRepo, type GitOptions, resolveDefaultBranch, spawnText } from './git';

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
export async function resolveBaseRef(base?: string, opts: GitOptions = {}): Promise<string> {
  if (base) return base;
  const def = await resolveDefaultBranch(opts);
  if (!def) {
    throw new Error('could not determine a base branch — pass one explicitly, e.g. `dad watch main`');
  }
  const mb = await spawnText(['git', 'merge-base', 'HEAD', def], opts);
  return mb.code === 0 && mb.stdout.trim() ? mb.stdout.trim() : def;
}

/**
 * Freshest-first: order files by working-tree mtime so the agent's most recent edits float to
 * the top — watch mode's "what changed since I last looked" story. Deleted/unreadable files (no
 * mtime) sink to the bottom. Attaches `mtime` to each file for the UI's recency cue. Runs after
 * `contentKey` is computed, so display order never perturbs the narrative/diff cache key.
 */
function sortByRecency(files: DiffFile[], repoRoot: string): DiffFile[] {
  return files
    .map((f) => {
      let mtime: number | undefined;
      try {
        mtime = statSync(join(repoRoot, f.file)).mtimeMs;
      } catch {
        mtime = undefined; // deleted or unreadable
      }
      return { ...f, mtime };
    })
    .sort((a, b) => (b.mtime ?? -Infinity) - (a.mtime ?? -Infinity));
}

/**
 * Shell out to git, building a LocalReview of the working tree against `base` (or the default branch).
 * Pass `opts.cwd` to review a different worktree than the process directory — the daemon submits each
 * unit's `worktreePath` this way. Every git call is bound to `opts` up front so no call site can run
 * in the wrong directory.
 */
export async function buildLocalReview(base?: string, opts: GitOptions = {}): Promise<LocalReview> {
  await assertGitRepo(opts);
  const baseRef = await resolveBaseRef(base, opts);
  const git = (args: string[]) => spawnText(args, opts);

  const [diff, branch, headSha, root] = await Promise.all([
    // Force standard a/ b/ prefixes — the diff parser requires them, but a user's git config
    // (diff.mnemonicPrefix → c/ w/, or diff.noprefix → none) would otherwise break parsing.
    git(['git', '-c', 'diff.mnemonicPrefix=false', '-c', 'diff.noprefix=false', 'diff', baseRef]),
    git(['git', 'rev-parse', '--abbrev-ref', 'HEAD']),
    git(['git', 'rev-parse', 'HEAD']),
    git(['git', 'rev-parse', '--show-toplevel']),
  ]);
  if (diff.code !== 0) {
    throw new Error(`git diff failed: ${diff.stderr.trim() || `exit ${diff.code}`}`);
  }

  const review = buildReviewFromDiff(diff.stdout, {
    branch: branch.stdout.trim() || 'working-tree',
    headSha: headSha.stdout.trim(),
    baseRef,
    createdAt: new Date().toISOString(),
  });

  const repoRoot = root.code === 0 ? root.stdout.trim() : '';
  if (repoRoot) review.files = sortByRecency(review.files, repoRoot);
  return review;
}
