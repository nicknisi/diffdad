import type { ReviewUnit } from './types';

/**
 * Where a unit's verdict is delivered. Pure — no I/O — so the decision route stays a thin dispatcher
 * and this is exhaustively unit-testable.
 *
 * - `'github'` — the unit tracks a teammate's (or your) open PR; the verdict becomes a real GitHub
 *   review (APPROVE / REQUEST_CHANGES). Only `source:'github'` units route here.
 * - `'channel'` — agent/cli work; the verdict is delivered over the in-process `DecisionChannel` that
 *   `await_decision` parks on (and persisted on the unit for a disconnected agent to re-read).
 */
export function decisionTarget(unit: ReviewUnit): 'github' | 'channel' {
  return unit.source === 'github' ? 'github' : 'channel';
}
