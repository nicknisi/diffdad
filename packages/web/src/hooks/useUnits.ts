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
  const dismissed = useReviewStore((s) => s.dismissed);
  const setUnits = useReviewStore((s) => s.setUnits);
  const [repoFilter, setRepoFilter] = useState<string | null>(null);
  // Distinguish "still fetching the first snapshot" from "fetched, genuinely empty" so the command
  // center can show a loader instead of flashing the all-clear empty state on every cold load.
  const [loaded, setLoaded] = useState(false);
  // Effective GitHub state is no longer snapshotted here — it moved to the store (fed by
  // GET /api/config + the SSE `config` event) so a token saved at runtime brings the UI alive without
  // a daemon restart. CommandCenter reads `github` from the store instead.

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/units');
        if (cancelled) return;
        if (res.ok) {
          const data = (await res.json()) as { units: Unit[]; dismissed?: Unit[] };
          if (!cancelled) setUnits(data.units ?? [], data.dismissed ?? []);
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
  const hidden = useMemo(
    () => (repoFilter ? dismissed.filter((u) => u.repo === repoFilter) : dismissed),
    [dismissed, repoFilter],
  );
  // Dismissed rows go *through* groupUnits rather than around it: it filters them out of every lane and
  // counts them, so the count and the exclusion can't fall out of step. The server sends them under a
  // separate key precisely so they never reach `units` and inflate the facets or the empty state.
  const groups: GroupedUnits = useMemo(() => groupUnits([...visible, ...hidden]), [visible, hidden]);
  // Facets are derived from the UNFILTERED list so selecting a repo never changes the counts.
  const facets: RepoFacets = useMemo(() => buildRepoFacets(units), [units]);

  return { groups, dismissed: hidden, repos, facets, repoFilter, setRepoFilter, total: units.length, loaded };
}

/**
 * Add any PR to the queue by reference (URL or `owner/repo#123`) — the add-PR field's half of
 * POST /api/units. Returns the unit's id (plus whether it was already queued, so the caller can tell
 * "minted" from "you're already reviewing this"). The server's message is thrown verbatim: it names
 * the actual problem (unparseable reference, no such PR, GitHub not wired) and the field shows it.
 */
export async function addPrUnit(pr: string): Promise<{ unitId: string; existing: boolean }> {
  const res = await fetch('/api/units', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pr }),
  });
  const data = (await res.json().catch(() => null)) as {
    unit?: { unitId: string };
    existing?: boolean;
    error?: string;
  } | null;
  if (!res.ok || !data?.unit) {
    throw new Error(data?.error ?? `Add failed (${res.status})`);
  }
  return { unitId: data.unit.unitId, existing: data.existing === true };
}

/** Remove a unit from the queue (manual cleanup of stale work). SSE repaints the list. */
export async function removeUnit(unitId: string): Promise<void> {
  const res = await fetch(`/api/units/${encodeURIComponent(unitId)}`, { method: 'DELETE' });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Remove failed (${res.status})${detail ? `: ${detail}` : ''}`);
  }
}
