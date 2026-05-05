import type { GitHubClient } from '../github/client';
import type {
  CheckRun,
  DiffFile,
  ForcePushEvent,
  IssueRef,
  PRComment,
  PRCommit,
  PRMetadata,
  PRReview,
} from '../github/types';

export type ReviewThread = {
  rootId: number;
  path: string;
  line: number | undefined;
  /** Comments oldest first. */
  comments: PRComment[];
};

export type RecapSources = {
  pr: PRMetadata;
  files: DiffFile[];
  commits: PRCommit[];
  comments: PRComment[];
  reviews: PRReview[];
  checkRuns: CheckRun[];
  threads: ReviewThread[];
  forcePushes: ForcePushEvent[];
  linkedIssues: IssueRef[];
};

const ISSUE_REF_RE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+(?:([\w.-]+)\/([\w.-]+))?#(\d+)/gi;

export type LinkedIssueId = { owner: string; repo: string; number: number };

/**
 * Parse linking keywords (Fixes #N, Closes owner/repo#N, ...) out of a PR body.
 * Returns deduped refs. Defaults owner/repo to the PR's repo when unqualified.
 */
export function parseLinkedIssues(body: string, defaultOwner: string, defaultRepo: string): LinkedIssueId[] {
  const seen = new Set<string>();
  const out: LinkedIssueId[] = [];
  ISSUE_REF_RE.lastIndex = 0;
  for (const m of body.matchAll(ISSUE_REF_RE)) {
    const owner = m[1] || defaultOwner;
    const repo = m[2] || defaultRepo;
    const num = Number(m[3]);
    if (!Number.isFinite(num)) continue;
    const key = `${owner}/${repo}#${num}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ owner, repo, number: num });
  }
  return out;
}

/**
 * Group review (inline) comments into threads keyed by the root comment id.
 * Issue-level comments are ignored — they have no thread.
 */
export function buildThreads(comments: PRComment[]): ReviewThread[] {
  const sorted = [...comments].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const threads = new Map<number, ReviewThread>();
  for (const c of sorted) {
    if (!c.path) continue; // issue comment
    const rootId = c.inReplyToId ?? c.id;
    let thread = threads.get(rootId);
    if (!thread) {
      thread = { rootId, path: c.path, line: c.line, comments: [] };
      threads.set(rootId, thread);
    }
    thread.comments.push(c);
    if (!thread.path) thread.path = c.path;
    if (thread.line === undefined) thread.line = c.line;
  }
  return [...threads.values()];
}

export async function gatherRecapSources(
  github: GitHubClient,
  owner: string,
  repo: string,
  number: number,
): Promise<RecapSources> {
  const [pr, files, commits, comments, reviews] = await Promise.all([
    github.getPR(owner, repo, number),
    github.getDiff(owner, repo, number).catch(() => [] as DiffFile[]),
    github.getPRCommits(owner, repo, number).catch(() => [] as PRCommit[]),
    github.getComments(owner, repo, number).catch(() => [] as PRComment[]),
    github.getReviews(owner, repo, number).catch(() => [] as PRReview[]),
  ]);

  const [checkRuns, forcePushes] = await Promise.all([
    github.getCheckRuns(owner, repo, pr.headSha).catch(() => [] as CheckRun[]),
    github.getForcePushEvents(owner, repo, number).catch(() => [] as ForcePushEvent[]),
  ]);

  const issueIds = parseLinkedIssues(pr.body, owner, repo);
  const linkedIssues: IssueRef[] = [];
  // Cap to avoid pathological cases where someone references a bunch of issues.
  for (const id of issueIds.slice(0, 5)) {
    const issue = await github.getIssue(id.owner, id.repo, id.number).catch(() => null);
    if (issue) linkedIssues.push(issue);
  }

  return {
    pr,
    files,
    commits,
    comments,
    reviews,
    checkRuns,
    threads: buildThreads(comments),
    forcePushes,
    linkedIssues,
  };
}
