import { useEffect, useMemo, useState } from 'react';
import { useReviewStore } from '../state/review-store';
import { buildRepoFacets, groupUnits, type GroupedUnits, type RepoFacets, repoOptions } from '../lib/units-view';
import type { Unit } from '../state/types';

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
  // Whether the daemon has GitHub credentials. Only the initial fetch carries this; SSE `units`
  // snapshots omit it, and it can't change without a daemon restart, so we capture it once. Default
  // true so an older daemon (no field) never shows a false "GitHub off" warning.
  const [github, setGithub] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/units');
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as { units: Unit[]; github?: boolean };
          if (!cancelled) {
            setUnits(data.units ?? []);
            if (typeof data.github === 'boolean') setGithub(data.github);
          }
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
  // Facets are derived from the UNFILTERED list so selecting a repo never changes the counts.
  const facets: RepoFacets = useMemo(() => buildRepoFacets(units), [units]);

  return { groups, repos, facets, repoFilter, setRepoFilter, total: units.length, loaded, github };
}

/** Remove a unit from the queue (manual cleanup of stale work). SSE repaints the list. */
export async function removeUnit(unitId: string): Promise<void> {
  const res = await fetch(`/api/units/${encodeURIComponent(unitId)}`, { method: 'DELETE' });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Remove failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }
}
