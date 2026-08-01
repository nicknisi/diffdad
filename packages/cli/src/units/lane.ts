import { isMechanicalKind, type TriageSummary } from '../narrative/triage';
import type { UnitStatus } from './types';

/**
 * Which attention lane a unit belongs in — the single source of truth, deliberately CLI-side.
 *
 * The daemon logs lane splits and the browser renders lane labels; those are two consumers of one rule.
 * A second implementation in the web package would drift, and the drift would corrupt exactly the data
 * the "am I opening fewer PRs I didn't need to?" judgment rests on. The web reads the lane the server
 * assigned; it never recomputes it.
 */
export type Lane = 'needs-you' | 'probably-not' | 'in-flight' | 'cleared';

/** The shape `laneOf` actually needs — a `Pick`, so tests construct one without a whole ReviewUnit. */
export type LaneInput = {
  status: UnitStatus;
  triage?: TriageSummary;
};

/**
 * Why a unit is not in the low-attention lane. A closed union rather than a boolean, because the reason
 * is what the row displays and what makes the lane auditable instead of a claim to be trusted.
 *
 * `no-evidence` covers both a missing summary and an empty file list: a PR we never looked at and a PR
 * that reports zero files are the same epistemic state, and neither is grounds for telling someone not
 * to read it. Absence of evidence is not evidence of absence — the same rule `collapse.ts` applies to
 * its `knownCallers: 0`.
 */
export type NeedsYouReason =
  | { kind: 'no-evidence' }
  | { kind: 'criticality'; tags: string[] }
  | { kind: 'source-files'; paths: string[] }
  | { kind: 'truncated' };

/**
 * The reason a queued unit needs attention, or `null` when every check clears and it can sit in the
 * low-attention lane. Vetoes are enumerated here rather than discovered during implementation — a
 * feature that gates a user-facing claim on evidence has to state what *disqualifies*, not only what
 * qualifies.
 */
export function needsYouReason(triage: TriageSummary | undefined): NeedsYouReason | null {
  if (!triage || triage.files.length === 0) return { kind: 'no-evidence' };
  if (triage.truncated) return { kind: 'truncated' };
  if (triage.criticality.length > 0) return { kind: 'criticality', tags: [...triage.criticality] };
  const source = triage.files.filter((f) => !isMechanicalKind(f.kind)).map((f) => f.path);
  if (source.length > 0) return { kind: 'source-files', paths: source };
  return null;
}

/**
 * Assign a lane. Status decides first and triage only ever splits the `queued` population, which is
 * what leaves the existing In flight and Cleared lanes untouched — `changes_requested` means the ball is
 * with the author, and that was never the problem this feature addresses.
 *
 * Total over a missing summary: a unit persisted before triage existed resolves to `needs-you`, never a
 * neutral placeholder. The poller backfills it, but the fallback has to be safe on its own, because the
 * backfill needs a poll pass to arrive and the queue renders before that.
 */
export function laneOf(unit: LaneInput): Lane {
  switch (unit.status) {
    case 'changes_requested':
      return 'in-flight';
    case 'approved':
    case 'done':
      return 'cleared';
    case 'queued':
      return needsYouReason(unit.triage) === null ? 'probably-not' : 'needs-you';
  }
}

/** A unit the reviewer dismissed with ✕ — hidden from every lane until its author pushes. */
export function isDismissed(unit: { dismissedAtSha?: string }): boolean {
  return typeof unit.dismissedAtSha === 'string' && unit.dismissedAtSha.length > 0;
}

/** Lane counts for the daemon's per-poll log line. Dismissed units are excluded, not counted as a lane. */
export function laneSplit(units: (LaneInput & { dismissedAtSha?: string })[]): Record<Lane, number> {
  const split: Record<Lane, number> = { 'needs-you': 0, 'probably-not': 0, 'in-flight': 0, cleared: 0 };
  for (const unit of units) {
    if (isDismissed(unit)) continue;
    split[laneOf(unit)]++;
  }
  return split;
}
