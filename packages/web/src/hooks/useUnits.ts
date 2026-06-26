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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/units');
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { units: Unit[] };
        if (!cancelled) setUnits(data.units ?? []);
      } catch {
        // ignore — the SSE stream backfills the queue
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

  return { groups, repos, repoFilter, setRepoFilter, total: units.length };
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
