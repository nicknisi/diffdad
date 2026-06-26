import type { Broadcast } from '../mcp/tools';
import { classify, shouldResurface } from '../units/linking';
import type { UnitStore } from '../units/store';
import type { PolledPr } from '../units/types';
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
 * against the current units and route it — mint a fresh `github` unit, best-effort link it onto a
 * matching agent/cli unit, or re-surface a reviewed `github` unit whose head moved. A thin reducer over
 * `classify` / `shouldResurface` (both pure) + the store's synchronous mutators, so it's testable with a
 * fake search and a real store. After the pass it broadcasts a `units` snapshot over the daemon's SSE
 * spine so the command center reflects the new inbox immediately.
 *
 * Returns counts for the caller's one-line log. The search/broadcast are injected (no network here).
 */
export async function pollOnce(deps: {
  search: () => Promise<PolledPr[]>;
  store: UnitStore;
  broadcast: Broadcast;
}): Promise<{ minted: number; linked: number; resurfaced: number }> {
  const { search, store, broadcast } = deps;
  const prs = await search();

  let minted = 0;
  let linked = 0;
  let resurfaced = 0;

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
    } else if (c.kind === 'link') {
      store.linkPr(c.unitId, {
        prNumber: pr.number,
        prUrl: pr.url,
        prAuthor: pr.author,
        headSha: pr.headSha,
      });
      linked++;
    } else {
      // existing-github: only re-open if the author pushed past the reviewed head.
      const unit = store.get(c.unitId);
      if (unit && shouldResurface(unit, pr.headSha)) {
        store.resurfaceForNewPush(c.unitId, pr.headSha);
        resurfaced++;
      }
    }
  }

  broadcast('units', { units: store.list() });
  return { minted, linked, resurfaced };
}
