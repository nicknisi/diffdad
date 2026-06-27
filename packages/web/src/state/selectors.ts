import type { DiffFile, NarrativeResponse } from './types';
import { buildWalkthrough } from '../lib/walkthrough';
import type { WalkthroughModel } from '../lib/walkthrough';

/** The store slices the review gate + walkthrough derive from. */
type GateState = { files: DiffFile[]; narrative: NarrativeResponse | null };

/**
 * Diff-first gate: the review view can render the moment there's anything to show — a diff
 * to read or a guide to render. Only the genuine pre-files instant (no files, no narrative)
 * falls back to the blocking GeneratingScreen.
 */
export function selectReviewReady(s: GateState): boolean {
  return s.files.length > 0 || s.narrative !== null;
}

/**
 * The walkthrough, derived on demand from the current narrative + diff. Null while the
 * narrative is still pending (the diff renders on its own; beats stream in over it).
 */
export function selectWalkthrough(s: GateState): WalkthroughModel | null {
  return s.narrative ? buildWalkthrough(s.narrative, s.files) : null;
}

/** Open resolve items = walkthrough items minus the ones the reviewer has marked resolved. */
export function selectOpenToResolve(s: GateState & { resolved: Record<string, boolean> }): number {
  const walkthrough = selectWalkthrough(s);
  if (!walkthrough) return 0;
  let count = 0;
  for (const beat of walkthrough.beats) {
    for (const item of beat.resolve) {
      if (!s.resolved[item.id]) count++;
    }
  }
  return count;
}
