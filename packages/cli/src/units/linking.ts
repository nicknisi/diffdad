import type { PolledPr, ReviewUnit } from './types';

/**
 * The decision the poller makes for a single polled PR, against the current set of units. Pure — no
 * I/O, no store — so it's exhaustively unit-testable and the poller stays a thin reducer over it.
 *
 * - `existing-github`: a unit already tracks this exact PR (same owner/repo + `prNumber`) — either a
 *   `github`-minted unit or an `agent`/`cli` unit the poller already linked. The poller only re-surfaces
 *   it if it's a reviewed github unit whose head moved (see `shouldResurface`); a linked agent/cli unit
 *   is a no-op.
 * - `link`: an `agent`/`cli` unit is the *same work* (same `repo` + head branch) and isn't yet tied
 *   to a PR — best-effort identity linking (full durable identity is a later phase). Attach PR info.
 * - `create`: nothing matches → mint a fresh `github` unit.
 *
 * `existing-github` is checked first so a PR that already has its own github unit is never also
 * re-linked onto a stray branch-matching agent unit.
 */
export type Classification =
  | { kind: 'existing-github'; unitId: string }
  | { kind: 'link'; unitId: string }
  | { kind: 'create' };

export function classify(units: ReviewUnit[], pr: PolledPr): Classification {
  const repo = `${pr.owner}/${pr.repo}`;

  // Already-tracked guard (kind kept as 'existing-github' to avoid churn): covers ANY unit that already
  // holds this PR — a github-minted unit OR an agent/cli unit the poller previously linked (source stays
  // agent/cli but prNumber is set). Without the source-agnostic match a linked unit would fall through to
  // 'create' on the next poll and mint a duplicate github unit.
  const existing = units.find((u) => u.repo === repo && u.prNumber === pr.number);
  if (existing) return { kind: 'existing-github', unitId: existing.unitId };

  const linkable = units.find(
    (u) =>
      (u.source === 'agent' || u.source === 'cli') &&
      u.repo === repo &&
      u.metadata.branch === pr.headBranch &&
      u.prNumber === undefined,
  );
  if (linkable) return { kind: 'link', unitId: linkable.unitId };

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
