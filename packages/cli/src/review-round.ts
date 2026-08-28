import type { ReviewRound } from '@diffdad/contracts';
import type { PRComment, PRReview } from './github/types';

export type { ReviewRound };

export type DeriveReviewRoundInput = {
  /** Current head SHA of the PR. */
  headSha: string;
  /**
   * SHA the on-screen narrative was last generated against, or null if none has been narrated yet.
   * When this differs from `headSha`, a regeneration is in flight and threads may carry over.
   */
  lastNarratedSha: string | null;
  comments: PRComment[];
  reviews: PRReview[];
  /**
   * Commits on the PR, newest push time used as the boundary for "updated since review" and
   * "carried over". Optional: without it those two signals fall back conservatively (see below).
   */
  commits?: { sha: string; committedAt?: string }[];
  /**
   * Login of the PR author. Required for the answered-thread heuristic: a thread is answered when the
   * PR author had the last word. Not part of the raw comment/review payloads, so the caller threads it
   * through from the PR metadata.
   */
  prAuthor: string;
  /**
   * GitHub's real per-thread resolution state, keyed by comment `databaseId` (from the GraphQL
   * `reviewThreads` API). When present, a thread whose comments appear here is decided by GitHub
   * (resolved iff any of its comments maps to `true`), overriding the last-word heuristic. Threads
   * with no comment in the map still fall back to the heuristic. Omitted entirely = pure heuristic.
   */
  resolutionByCommentId?: Map<number, boolean>;
};

/**
 * Derive where a PR sits in its current review round from GitHub data alone. Pure and side-effect free;
 * GitHub remains the source of truth and this never blocks anything.
 *
 * State precedence (D1): `updated-since-review` > `changes-requested` > `awaiting-review`. New commits
 * landing after the newest review is the most time-sensitive signal and the whole point of this feature
 * (telling a fresh push apart from lingering threads), so it wins even when changes were requested — the
 * requested-changes review still stands on GitHub, but the diff the reviewer saw is now stale. When no
 * push has happened since the newest review, an unaddressed `changes-requested` is the blocker to surface.
 * With no reviews at all, the round is `awaiting-review`.
 */
export function deriveReviewRound(input: DeriveReviewRoundInput): ReviewRound {
  const { headSha, lastNarratedSha, comments, reviews, commits = [], prAuthor, resolutionByCommentId } = input;

  const threads = groupInlineThreads(comments, prAuthor, resolutionByCommentId);
  const unresolvedThreads = threads.filter((t) => t.unresolved).length;

  // Only submitted reviews carry a decision; PENDING is a draft the author hasn't sent, DISMISSED is a
  // review GitHub has retired. Both are excluded from the newest-review and changes-requested tests.
  const submitted = reviews.filter((r) => r.state !== 'PENDING' && r.state !== 'DISMISSED' && r.submittedAt);
  const newestReviewTime = maxTime(submitted.map((r) => r.submittedAt));
  const lastReviewSubmittedAt = pickLatest(submitted)?.submittedAt;

  const latestChangesRequested = maxTime(
    submitted.filter((r) => r.state === 'CHANGES_REQUESTED').map((r) => r.submittedAt),
  );
  const latestApproved = maxTime(submitted.filter((r) => r.state === 'APPROVED').map((r) => r.submittedAt));
  const changesRequested =
    latestChangesRequested !== null && (latestApproved === null || latestChangesRequested > latestApproved);

  const newestPush = maxTime(commits.map((c) => c.committedAt));
  const updatedSinceReview = newestReviewTime !== null && newestPush !== null && newestPush > newestReviewTime;

  const state: ReviewRound['state'] = updatedSinceReview
    ? 'updated-since-review'
    : changesRequested
      ? 'changes-requested'
      : 'awaiting-review';

  // A thread carries over only once head has advanced past the narrated SHA (a regeneration). It carried
  // over if its root predates the latest push; without commit timestamps we can't place the boundary, so
  // every unresolved thread is treated as carried over (they all predate a push that just triggered regen).
  let carriedOverThreads = 0;
  if (lastNarratedSha && lastNarratedSha !== headSha) {
    for (const t of threads) {
      if (!t.unresolved) continue;
      const rootTime = Date.parse(t.rootCreatedAt);
      if (newestPush === null || (!Number.isNaN(rootTime) && rootTime < newestPush)) carriedOverThreads++;
    }
  }

  return {
    state,
    unresolvedThreads,
    carriedOverThreads,
    ...(lastReviewSubmittedAt ? { lastReviewSubmittedAt } : {}),
  };
}

type InlineThread = { rootId: number; rootCreatedAt: string; unresolved: boolean };

/**
 * Group inline review comments into threads: a root is an inline comment (has `path`) with no
 * `inReplyToId`; replies chain to it via `inReplyToId`. Non-inline (PR-level) comments are ignored.
 *
 * Resolution precedence: when `resolution` carries GitHub's real `isResolved` (keyed by comment
 * databaseId), any thread with a comment in that map is decided by GitHub (resolved iff any of its
 * comments maps to `true`). Two ceilings remain where the heuristic still runs:
 *   1. Pagination cap — the GraphQL fetch stops at 3 pages / 300 threads, so threads past that cap
 *      carry no map entry and fall back here.
 *   2. Per-thread fallback — a thread with no comment in the map (map omitted, or a partial map that
 *      never covers this thread) is answered when its LAST comment is by the PR author, otherwise
 *      unresolved. A reviewer marking such a thread resolved on GitHub won't clear it, and an author's
 *      reply that doesn't actually resolve anything will.
 */
function groupInlineThreads(
  comments: PRComment[],
  prAuthor: string,
  resolution?: Map<number, boolean>,
): InlineThread[] {
  const byId = new Map<number, PRComment>(comments.map((c) => [c.id, c]));

  function rootOf(c: PRComment): PRComment {
    let cur = c;
    const seen = new Set<number>();
    while (cur.inReplyToId != null && byId.has(cur.inReplyToId) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.inReplyToId)!;
    }
    return cur;
  }

  const groups = new Map<number, PRComment[]>();
  for (const c of comments) {
    const root = rootOf(c);
    if (root.path == null) continue; // not an inline thread
    const arr = groups.get(root.id) ?? [];
    arr.push(c);
    groups.set(root.id, arr);
  }

  const threads: InlineThread[] = [];
  for (const [rootId, members] of groups) {
    const sorted = [...members].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    const last = sorted[sorted.length - 1]!;
    const root = byId.get(rootId)!;
    const mapped = resolution ? sorted.map((c) => c.id).filter((id) => resolution.has(id)) : [];
    const unresolved =
      mapped.length > 0 ? !mapped.some((id) => resolution!.get(id) === true) : last.author !== prAuthor;
    threads.push({ rootId, rootCreatedAt: root.createdAt, unresolved });
  }
  return threads;
}

function maxTime(isos: (string | undefined)[]): number | null {
  let max: number | null = null;
  for (const iso of isos) {
    if (!iso) continue;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) continue;
    if (max === null || t > max) max = t;
  }
  return max;
}

function pickLatest(reviews: PRReview[]): PRReview | undefined {
  let latest: PRReview | undefined;
  let latestTime = -Infinity;
  for (const r of reviews) {
    const t = Date.parse(r.submittedAt);
    if (Number.isNaN(t)) continue;
    if (t >= latestTime) {
      latestTime = t;
      latest = r;
    }
  }
  return latest;
}
