import type { ReviewUnit } from './types';

/**
 * Where a unit's verdict is delivered. Pure — no I/O — so the decision route stays a thin dispatcher
 * and this is exhaustively unit-testable.
 *
 * Collapsed to github-only: every unit tracks an open PR, so the verdict always becomes a real GitHub
 * review (APPROVE / REQUEST_CHANGES). The parameter is retained so callers keep their unit-in contract.
 */
export function decisionTarget(_unit: ReviewUnit): 'github' {
  return 'github';
}
