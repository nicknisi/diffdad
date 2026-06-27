import { useEffect, useMemo, useState } from 'react';
import { useReviewStore } from '../state/review-store';
import { groupUnits, type GroupedUnits, repoOptions } from '../lib/units-view';
import type { Concern, Unit, UnitDecisionKind } from '../state/types';

export type UnitDecisionInput = {
  kind: UnitDecisionKind;
  /** Concerns the agent should address (changes_requested) — curated in the drill-in, all by default. */
  concerns?: Concern[];
  note?: string;
};

/**
 * Command-center data hook. The live queue lives in the store (seeded by the `command-center`
 * bootstrap, kept current by the `units` SSE event in `useLiveStream`). This hook fetches an
 * initial snapshot so a hard refresh / reconnect repaints immediately, then derives the repo
 * filter + status grouping. Reading the store keeps it reactive to SSE without a second EventSource.
 */
export function useUnits() {
  const units = useReviewStore((s) => s.units);
  const setUnits = useReviewStore((s) => s.setUnits);
  const [repoFilter, setRepoFilter] = useState<string | null>(null);
  // Distinguish "still fetching the first snapshot" from "fetched, genuinely empty" so the command
  // center can show a loader instead of flashing the all-clear empty state on every cold load.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/units');
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as { units: Unit[] };
          if (!cancelled) setUnits(data.units ?? []);
        }
      } catch {
        // ignore — the SSE stream backfills the queue
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setUnits]);

  const repos = useMemo(() => repoOptions(units), [units]);
  // A filter naming a repo that has since drained shows nothing rather than silently resetting —
  // but clear it once that repo is gone so the user isn't stranded on an empty view.
  useEffect(() => {
    if (repoFilter && !repos.includes(repoFilter)) setRepoFilter(null);
  }, [repoFilter, repos]);

  const visible = useMemo(() => (repoFilter ? units.filter((u) => u.repo === repoFilter) : units), [units, repoFilter]);
  const groups: GroupedUnits = useMemo(() => groupUnits(visible), [visible]);

  return { groups, repos, repoFilter, setRepoFilter, total: units.length, loaded };
}

/** POST a verdict to the daemon → persisted on the unit + delivered to the parked agent. */
export async function postDecision(unitId: string, decision: UnitDecisionInput): Promise<void> {
  const res = await fetch(`/api/units/${encodeURIComponent(unitId)}/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(decision),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Decision failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }
}

/** Remove a unit from the queue (manual cleanup of failed / stale work). SSE repaints the list. */
export async function removeUnit(unitId: string): Promise<void> {
  const res = await fetch(`/api/units/${encodeURIComponent(unitId)}`, { method: 'DELETE' });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Remove failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }
}

/**
 * Re-run the review for a local unit (used after a failed review, or to re-review the current worktree).
 * Resolves `{ ok:false, reason:'clean-tree' }` when there's nothing left to review.
 */
export async function retryUnit(unitId: string): Promise<{ ok: boolean; reason?: string }> {
  const res = await fetch(`/api/units/${encodeURIComponent(unitId)}/retry`, { method: 'POST' });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Retry failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }
  return (await res.json().catch(() => ({ ok: true }))) as { ok: boolean; reason?: string };
}
