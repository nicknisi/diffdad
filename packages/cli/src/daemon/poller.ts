import type { Broadcast } from '../mcp/broadcast';
import { classify, shouldResurface } from '../units/linking';
import type { UnitStore } from '../units/store';
import type { PolledPr, ReviewUnit } from '../units/types';
import type { PRMetadata } from '../github/types';

/**
 * Build the `PRMetadata` a freshly-minted `github` unit carries from the cheap PR metadata the poller
 * fetched. The diff/line counts are unknown until the lazy on-open fetch, so they start at zero; the
 * `headSha`/`branch`/`title`/`author`/`updatedAt` are the load-bearing fields (freshness + the row).
 */
function metadataFromPr(pr: PolledPr): PRMetadata {
  return {
    number: pr.number,
    title: pr.title,
    body: '',
    state: 'open',
    draft: false,
    author: { login: pr.author, avatarUrl: '' },
    branch: pr.headBranch,
    base: pr.base,
    labels: [],
    createdAt: pr.updatedAt,
    updatedAt: pr.updatedAt,
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    commits: 0,
    headSha: pr.headSha,
  };
}

/**
 * One pass of the GitHub review-request poller: for each PR the (injected) search returns, classify it
 * against the current units and route it — mint a fresh `github` unit, or re-surface a reviewed
 * `github` unit whose head moved. A thin reducer over `classify` / `shouldResurface` (both pure) + the
 * store's synchronous mutators, so it's testable with a fake search and a real store. After the pass it
 * broadcasts a `units` snapshot over the daemon's SSE spine so the command center reflects the new inbox
 * immediately.
 *
 * With `fetchPrState` wired, the pass also reconciles the store against the search: a github unit whose
 * PR the search stopped returning is dropped — immediately if GitHub reports it closed/merged, else
 * after two consecutive missing polls (the miss streak absorbs the search's eventual consistency). The
 * streak map is caller-owned so the interval poller and the manual /api/poll share one streak state.
 * Without the dep, reconciliation is skipped entirely (mint/resurface behavior is byte-identical).
 *
 * Returns counts for the caller's one-line log. The search/broadcast/fetch are injected (no network here).
 */
export async function pollOnce(deps: {
  search: () => Promise<PolledPr[]>;
  store: UnitStore;
  broadcast: Broadcast;
  fetchPrState?: (unit: ReviewUnit) => Promise<{ open: boolean }>;
  missStreaks?: Map<string, number>;
}): Promise<{ minted: number; resurfaced: number; removed: number }> {
  const { search, store, broadcast, fetchPrState, missStreaks } = deps;
  const prs = await search();

  let minted = 0;
  let resurfaced = 0;
  let removed = 0;

  for (const pr of prs) {
    const c = classify(store.list(), pr);
    if (c.kind === 'create') {
      store.addGithubUnit({
        owner: pr.owner,
        repo: pr.repo,
        number: pr.number,
        title: pr.title,
        headBranch: pr.headBranch,
        headSha: pr.headSha,
        author: pr.author,
        url: pr.url,
        baseRef: pr.base,
        metadata: metadataFromPr(pr),
      });
      minted++;
    } else {
      // existing-github: only re-open if the author pushed past the reviewed head.
      const unit = store.get(c.unitId);
      if (unit && shouldResurface(unit, pr.headSha)) {
        store.resurfaceForNewPush(c.unitId, pr.headSha);
        resurfaced++;
      }
    }
  }

  // Reconcile against the authoritative search: drop units GitHub no longer lists on your plate.
  // Skipped without a `fetchPrState` dep so the mint/resurface-only callers stay byte-identical.
  if (fetchPrState) {
    const streaks = missStreaks ?? new Map<string, number>();
    // Search keys are `owner/repo#number`; a unit's `repo` is already `owner/name`.
    const polled = new Set(prs.map((pr) => `${pr.owner}/${pr.repo}#${pr.number}`));
    const removals: string[] = [];
    for (const unit of store.list()) {
      if (unit.source !== 'github' || unit.prNumber === undefined) continue;
      const key = `${unit.repo}#${unit.prNumber}`;
      if (polled.has(key)) {
        streaks.delete(unit.unitId); // still on your plate → reset any pending miss streak
        continue;
      }
      // Absent from the search. A single miss is not evidence (the search is eventually consistent
      // and skips per-PR enrichment on transient errors), so decide removal defensively.
      let state: { open: boolean };
      try {
        state = await fetchPrState(unit);
      } catch {
        continue; // transient fetch failure ≠ evidence: leave the unit and its streak untouched
      }
      if (!state.open) {
        // Closed or merged on GitHub — unambiguous, remove now (streak irrelevant).
        await store.remove(unit.unitId);
        streaks.delete(unit.unitId);
        removals.push(`${key} (closed)`);
        removed++;
      } else {
        // Still open but unrequested (withdrawn / reviewed off-plate / search lag) → remove only
        // after two consecutive missing polls.
        const next = (streaks.get(unit.unitId) ?? 0) + 1;
        if (next >= 2) {
          await store.remove(unit.unitId);
          streaks.delete(unit.unitId);
          removals.push(`${key} (no longer requested)`);
          removed++;
        } else {
          streaks.set(unit.unitId, next);
        }
      }
    }
    if (removed > 0) {
      console.log(`[diffdad] reconciled queue: dropped ${removals.join(', ')}`);
    }
  }

  // `polledAt` marks this as a real GitHub check (interval or manual /api/poll), so the command
  // center stamps its "checked …" freshness caption only on true poll passes — not on the other
  // `units` broadcasts (decision/delete/hydrate/review/initial snapshot) that never re-query GitHub.
  broadcast('units', { units: store.list(), polledAt: Date.now() });
  return { minted, resurfaced, removed };
}
