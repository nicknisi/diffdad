import type { Broadcast } from '../mcp/broadcast';
import { classify, shouldResurface } from '../units/linking';
import type { UnitStore } from '../units/store';
import type { PolledPr, ReviewUnit } from '../units/types';
import type { PRMetadata } from '../github/types';

/**
 * Build the `PRMetadata` a freshly-minted `github` unit carries from the PR metadata the poller
 * fetched. The diff/line counts ride along on the `PolledPr` (the search already fetched each PR), so
 * the row shows real numbers at mint — no zero-fill until the lazy on-open hydrate. The
 * `headSha`/`branch`/`title`/`author`/`updatedAt` remain the load-bearing freshness fields.
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
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    commits: pr.commits,
    headSha: pr.headSha,
  };
}

/** Whether a unit's stored diff/line counts drift from the freshly-polled PR (so a heal is worth a write). */
function countsDiffer(meta: PRMetadata, pr: PolledPr): boolean {
  return (
    meta.additions !== pr.additions ||
    meta.deletions !== pr.deletions ||
    meta.changedFiles !== pr.changedFiles ||
    meta.commits !== pr.commits
  );
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
 * after two consecutive missing polls (the miss streak absorbs the search's eventual consistency).
 * Exception: a still-open unit that is hydrated but undecided (mid-review) is never dropped. The
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
      // Heal a unit whose stored counts drift from the live PR — minted before the counts rode along,
      // or the author pushed since. The search already fetched the PR, so this is free. Counts ONLY:
      // never status / reviewedSha / headSha. Skip when equal so an unchanged PR isn't rewritten each poll.
      if (unit && countsDiffer(unit.metadata, pr)) {
        store.setMetadataCounts(unit.unitId, {
          additions: pr.additions,
          deletions: pr.deletions,
          changedFiles: pr.changedFiles,
          commits: pr.commits,
        });
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
      } else if (unit.status === 'queued' && unit.narrative) {
        // Mid-review: hydrated but undecided. "Unrequested" here is usually the reviewer's own
        // doing — submitting comments or a review dismisses the review request on GitHub — so
        // removal would destroy the walkthrough under the person reading it. Keep the unit; it
        // retires through the normal paths (a decision, the PR closing, or a manual delete).
        streaks.delete(unit.unitId);
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
