import type { PolledPr, ReviewUnit } from './types';

/**
 * The decision the poller makes for a single polled PR, against the current set of units. Pure — no
 * I/O, no store — so it's exhaustively unit-testable and the poller stays a thin reducer over it.
 *
 * - `existing-github`: a github unit already tracks this exact PR (same owner/repo + `prNumber`). The
 *   poller only re-surfaces it if its head moved (see `shouldResurface`); otherwise it's a no-op.
 * - `create`: nothing matches → mint a fresh `github` unit.
 */
export type Classification = { kind: 'existing-github'; unitId: string } | { kind: 'create' };

export function classify(units: ReviewUnit[], pr: PolledPr): Classification {
  const repo = `${pr.owner}/${pr.repo}`;

  // Already-tracked guard: a github unit already holds this PR (same owner/repo + prNumber). Without it
  // the PR would fall through to 'create' on the next poll and mint a duplicate.
  const existing = units.find((u) => u.repo === repo && u.prNumber === pr.number);
  if (existing) return { kind: 'existing-github', unitId: existing.unitId };

  return { kind: 'create' };
}

/**
 * Freshness gate: should a previously-reviewed `github` unit be re-opened because the author pushed?
 * True iff it's a github unit in a reviewed state (`approved`/`changes_requested`) AND the polled head
 * differs from the SHA the last decision was recorded against. Keeps reviewed PRs out of "Needs you"
 * until there's genuinely new work to look at.
 */
export function shouldResurface(unit: ReviewUnit, polledHeadSha: string): boolean {
  return (
    unit.source === 'github' &&
    (unit.status === 'approved' || unit.status === 'changes_requested') &&
    unit.lastReviewedSha !== polledHeadSha
  );
}
