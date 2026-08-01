import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pollOnce } from '../poller';
import { UnitStore } from '../../units/store';
import type { PRMetadata } from '../../github/types';
import type { NarrativeResponse } from '../../narrative/types';
import type { PolledPr, ReviewUnit } from '../../units/types';

// --- fixtures -------------------------------------------------------------

let dir: string;

/** Deterministic store options bound to the current temp dir: stable clock + monotonic ids. */
function det() {
  let seq = 0;
  return { dir, now: () => '2026-06-26T00:00:00.000Z', genId: () => `unit-${++seq}` };
}

function mkMetadata(branch = 'feat/x'): PRMetadata {
  return {
    number: 0,
    title: branch,
    body: '',
    state: 'open',
    draft: false,
    author: { login: 'local', avatarUrl: '' },
    branch,
    base: 'main',
    labels: [],
    createdAt: 'now',
    updatedAt: 'now',
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    commits: 0,
    headSha: 'abc',
  };
}

function mkPr(o: Partial<PolledPr> = {}): PolledPr {
  return {
    owner: 'octo',
    repo: 'demo',
    number: 42,
    title: 'Add widgets',
    headBranch: 'feat/widgets',
    headSha: 'sha-1',
    base: 'main',
    author: 'octocat',
    url: 'https://github.com/octo/demo/pull/42',
    updatedAt: '2026-06-26T00:00:00.000Z',
    additions: 5,
    deletions: 2,
    changedFiles: 3,
    commits: 1,
    ...o,
  };
}

/** A search that just yields a fixed list — no network. */
const search = (prs: PolledPr[]) => () => Promise.resolve(prs);

// Let the store's synchronous best-effort save()s settle before tearing down the temp dir.
const settle = () => new Promise((r) => setTimeout(r, 25));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'diffdad-poller-'));
});
afterEach(async () => {
  await settle();
  await rm(dir, { recursive: true, force: true });
});

// --- tests ----------------------------------------------------------------

describe('pollOnce', () => {
  it('mints one github unit at status queued for a brand-new PR', async () => {
    const store = new UnitStore([], det());
    const events: { event: string; data: unknown }[] = [];
    const broadcast = (event: string, data: unknown) => events.push({ event, data });

    const result = await pollOnce({ search: search([mkPr()]), store, broadcast });

    expect(result).toEqual({ minted: 1, resurfaced: 0, removed: 0 });
    const units = store.list();
    expect(units.length).toBe(1);
    const u = units[0]!;
    expect(u.source).toBe('github');
    expect(u.status).toBe('queued'); // never 'submitted' — must not enter the worker pool
    expect(u.repo).toBe('octo/demo');
    expect(u.prNumber).toBe(42);
    expect(u.prUrl).toBe('https://github.com/octo/demo/pull/42');
    expect(u.prAuthor).toBe('octocat');
    expect(u.taskLabel).toBe('Add widgets');
    expect(u.diffContentKey).toBe('sha-1'); // headSha keys the lazy narrative cache
    expect(u.metadata.headSha).toBe('sha-1');
    expect(u.metadata.branch).toBe('feat/widgets');
    expect(u.metadata.base).toBe('main'); // real base ref propagated, not hardcoded
    expect(u.baseRef).toBe('main');
  });

  it('mints a unit carrying the polled diff/line counts (not zero-filled)', async () => {
    const store = new UnitStore([], det());
    await pollOnce({
      search: search([mkPr({ additions: 20, deletions: 9, changedFiles: 4, commits: 3 })]),
      store,
      broadcast: () => {},
    });
    const u = store.list()[0]!;
    expect(u.metadata.additions).toBe(20);
    expect(u.metadata.deletions).toBe(9);
    expect(u.metadata.changedFiles).toBe(4);
    expect(u.metadata.commits).toBe(3);
  });

  it('heals a stale existing unit’s counts on the next poll (same head, no resurface)', async () => {
    const store = new UnitStore([], det());
    // A unit minted before counts rode along: metadata counts all zero, head sha-1, still queued.
    const u = store.addGithubUnit({
      owner: 'octo',
      repo: 'demo',
      number: 42,
      title: 'Add widgets',
      headBranch: 'feat/widgets',
      headSha: 'sha-1',
      author: 'octocat',
      url: 'https://github.com/octo/demo/pull/42',
      metadata: { ...mkMetadata('feat/widgets'), headSha: 'sha-1' }, // additions/deletions/... = 0
    });

    const result = await pollOnce({
      search: search([
        mkPr({ number: 42, headSha: 'sha-1', additions: 12, deletions: 4, changedFiles: 3, commits: 2 }),
      ]),
      store,
      broadcast: () => {},
    });

    expect(result).toEqual({ minted: 0, resurfaced: 0, removed: 0 }); // same PR, same head → no mint/resurface
    const after = store.get(u.unitId)!;
    expect(after.metadata.additions).toBe(12);
    expect(after.metadata.deletions).toBe(4);
    expect(after.metadata.changedFiles).toBe(3);
    expect(after.metadata.commits).toBe(2);
    expect(after.status).toBe('queued'); // heal does not transition
    expect(after.metadata.headSha).toBe('sha-1'); // heal does not move the head
  });

  it('does not rewrite an existing unit whose counts already match (no pointless persist per poll)', async () => {
    const store = new UnitStore([], det());
    store.addGithubUnit({
      owner: 'octo',
      repo: 'demo',
      number: 42,
      title: 'Add widgets',
      headBranch: 'feat/widgets',
      headSha: 'sha-1',
      author: 'octocat',
      url: 'https://github.com/octo/demo/pull/42',
      metadata: {
        ...mkMetadata('feat/widgets'),
        headSha: 'sha-1',
        additions: 7,
        deletions: 1,
        changedFiles: 2,
        commits: 1,
      },
    });
    const spy = vi.spyOn(store, 'setMetadataCounts');
    try {
      await pollOnce({
        search: search([
          mkPr({ number: 42, headSha: 'sha-1', additions: 7, deletions: 1, changedFiles: 2, commits: 1 }),
        ]),
        store,
        broadcast: () => {},
      });
      expect(spy).not.toHaveBeenCalled(); // equal counts → no heal write
    } finally {
      spy.mockRestore();
    }
  });

  it('a count heal never changes status, reviewedSha, or headSha (decided unit, same head)', async () => {
    const store = new UnitStore([], det());
    const u = store.addGithubUnit({
      owner: 'octo',
      repo: 'demo',
      number: 42,
      title: 'Add widgets',
      headBranch: 'feat/widgets',
      headSha: 'sha-1',
      author: 'octocat',
      url: 'https://github.com/octo/demo/pull/42',
      metadata: { ...mkMetadata('feat/widgets'), headSha: 'sha-1' }, // counts = 0
    });
    store.setReviewedSha(u.unitId, 'sha-1');
    (store.get(u.unitId) as { decision?: unknown }).decision = { kind: 'approved' };
    (store.get(u.unitId) as { status: string }).status = 'approved';

    await pollOnce({
      search: search([
        mkPr({ number: 42, headSha: 'sha-1', additions: 15, deletions: 6, changedFiles: 5, commits: 4 }),
      ]),
      store,
      broadcast: () => {},
    });

    const after = store.get(u.unitId)!;
    expect(after.metadata.additions).toBe(15); // healed
    expect(after.status).toBe('approved'); // unchanged — a decided unit at the same head isn't resurfaced
    expect(after.lastReviewedSha).toBe('sha-1'); // unchanged
    expect(after.metadata.headSha).toBe('sha-1'); // unchanged
  });

  it("mints a github unit carrying the PR's real (non-default) base ref", async () => {
    const store = new UnitStore([], det());
    const result = await pollOnce({
      search: search([mkPr({ base: 'develop' })]),
      store,
      broadcast: () => {},
    });
    expect(result.minted).toBe(1);
    const u = store.list()[0]!;
    expect(u.metadata.base).toBe('develop');
    expect(u.baseRef).toBe('develop');
  });

  it('is idempotent: re-polling the SAME unchanged PR mints/links/resurfaces nothing', async () => {
    const store = new UnitStore([], det());
    const first = await pollOnce({ search: search([mkPr()]), store, broadcast: () => {} });
    expect(first).toEqual({ minted: 1, resurfaced: 0, removed: 0 });
    expect(store.list().length).toBe(1);

    const second = await pollOnce({ search: search([mkPr()]), store, broadcast: () => {} });
    expect(second).toEqual({ minted: 0, resurfaced: 0, removed: 0 });
    expect(store.list().length).toBe(1); // no duplicate minted
  });

  it('resurfaces a previously-reviewed github unit when the head sha moved', async () => {
    const store = new UnitStore([], det());
    // A github unit reviewed at the OLD head, now approved.
    const u = store.addGithubUnit({
      owner: 'octo',
      repo: 'demo',
      number: 42,
      title: 'Add widgets',
      headBranch: 'feat/widgets',
      headSha: 'old-sha',
      author: 'octocat',
      url: 'https://github.com/octo/demo/pull/42',
      metadata: mkMetadata('feat/widgets'),
    });
    store.setReviewedSha(u.unitId, 'old-sha');
    (store.get(u.unitId) as { decision?: unknown }).decision = { kind: 'approved' };
    (store.get(u.unitId) as { status: string }).status = 'approved';

    const events: string[] = [];
    const broadcast = (event: string) => events.push(event);

    const result = await pollOnce({ search: search([mkPr({ headSha: 'new-sha' })]), store, broadcast });

    expect(result).toEqual({ minted: 0, resurfaced: 1, removed: 0 });
    const after = store.get(u.unitId)!;
    expect(after.status).toBe('queued');
    expect(after.decision).toBeUndefined();
    expect(after.metadata.headSha).toBe('new-sha');
    expect(after.diffContentKey).toBe('new-sha'); // narrative cache key advances with the head, not pinned to old sha
    expect(store.list().length).toBe(1); // still the same single unit
  });

  it('does nothing when the same reviewed PR is polled again with an unchanged sha', async () => {
    const store = new UnitStore([], det());
    const u = store.addGithubUnit({
      owner: 'octo',
      repo: 'demo',
      number: 42,
      title: 'Add widgets',
      headBranch: 'feat/widgets',
      headSha: 'sha-1',
      author: 'octocat',
      url: 'https://github.com/octo/demo/pull/42',
      metadata: { ...mkMetadata('feat/widgets'), headSha: 'sha-1' },
    });
    store.setReviewedSha(u.unitId, 'sha-1');
    (store.get(u.unitId) as { decision?: unknown }).decision = { kind: 'approved' };
    (store.get(u.unitId) as { status: string }).status = 'approved';

    const result = await pollOnce({ search: search([mkPr({ headSha: 'sha-1' })]), store, broadcast: () => {} });

    expect(result).toEqual({ minted: 0, resurfaced: 0, removed: 0 });
    const after = store.get(u.unitId)!;
    expect(after.status).toBe('approved'); // untouched — already reviewed at this head
    expect(after.metadata.headSha).toBe('sha-1'); // metadata not advanced (no-op)
  });

  it("broadcasts a 'units' snapshot after polling", async () => {
    const store = new UnitStore([], det());
    const events: { event: string; data: unknown }[] = [];
    const broadcast = (event: string, data: unknown) => events.push({ event, data });

    await pollOnce({ search: search([mkPr()]), store, broadcast });

    const unitsEvent = events.find((e) => e.event === 'units');
    expect(unitsEvent).toBeDefined();
    expect((unitsEvent!.data as { units: unknown[] }).units.length).toBe(1);
  });
});

// --- reconciliation (drop units GitHub no longer lists) -------------------

/** Seed a stored `github` unit for a PR the search will (mostly) not return. */
function seedUnit(store: UnitStore, over: { number?: number; headSha?: string } = {}): ReviewUnit {
  const number = over.number ?? 99;
  return store.addGithubUnit({
    owner: 'octo',
    repo: 'demo',
    number,
    title: 'Stale PR',
    headBranch: 'feat/stale',
    headSha: over.headSha ?? 'sha-1',
    author: 'octocat',
    url: `https://github.com/octo/demo/pull/${number}`,
    metadata: { ...mkMetadata(), headSha: over.headSha ?? 'sha-1' },
  });
}

const openState = () => Promise.resolve({ open: true });
const closedState = () => Promise.resolve({ open: false });

/** Minimal walkthrough — what `attachReview` stores when a unit hydrates. */
function mkNarrative(): NarrativeResponse {
  return { title: 't', tldr: '', verdict: 'safe', readingPlan: [], concerns: [], chapters: [] };
}

describe('pollOnce reconciliation', () => {
  it('removes a github unit immediately when its PR is closed/merged', async () => {
    const store = new UnitStore([], det());
    const u = seedUnit(store);
    const streaks = new Map<string, number>();

    const result = await pollOnce({
      search: search([]), // #99 no longer on your plate
      store,
      broadcast: () => {},
      fetchPrState: closedState,
      missStreaks: streaks,
    });

    expect(result.removed).toBe(1);
    expect(store.get(u.unitId)).toBeUndefined(); // hard-deleted this pass — streak irrelevant when closed
    expect(streaks.size).toBe(0); // no streak entry leaked for the removed unit
  });

  it('removes an open-but-unrequested unit only after two consecutive missing polls (shared streak map)', async () => {
    const store = new UnitStore([], det());
    const u = seedUnit(store);
    const streaks = new Map<string, number>(); // the ONE map the interval poller and manual /api/poll share

    const p1 = await pollOnce({
      search: search([]),
      store,
      broadcast: () => {},
      fetchPrState: openState,
      missStreaks: streaks,
    });
    expect(p1.removed).toBe(0);
    expect(store.get(u.unitId)).toBeDefined(); // one miss is not evidence
    expect(streaks.get(u.unitId)).toBe(1);

    const p2 = await pollOnce({
      search: search([]),
      store,
      broadcast: () => {},
      fetchPrState: openState,
      missStreaks: streaks,
    });
    expect(p2.removed).toBe(1);
    expect(store.get(u.unitId)).toBeUndefined(); // gone at the second consecutive miss
    expect(streaks.size).toBe(0); // streak cleared on removal
  });

  it('resets the miss streak when the unit reappears in the search', async () => {
    const store = new UnitStore([], det());
    const u = seedUnit(store, { headSha: 'sha-1' });
    const streaks = new Map<string, number>();

    await pollOnce({ search: search([]), store, broadcast: () => {}, fetchPrState: openState, missStreaks: streaks });
    expect(streaks.get(u.unitId)).toBe(1); // one strike

    // Reappears on your plate → streak cleared, no removal (sha unchanged → no resurface either).
    await pollOnce({
      search: search([mkPr({ number: 99, headSha: 'sha-1' })]),
      store,
      broadcast: () => {},
      fetchPrState: openState,
      missStreaks: streaks,
    });
    expect(streaks.has(u.unitId)).toBe(false);
    expect(store.get(u.unitId)).toBeDefined();

    // Misses again → a fresh streak of 1 (not the second strike), so it survives.
    const p3 = await pollOnce({
      search: search([]),
      store,
      broadcast: () => {},
      fetchPrState: openState,
      missStreaks: streaks,
    });
    expect(p3.removed).toBe(0);
    expect(streaks.get(u.unitId)).toBe(1);
    expect(store.get(u.unitId)).toBeDefined();
  });

  it('leaves the unit and its streak untouched when the PR-state fetch throws', async () => {
    const store = new UnitStore([], det());
    const u = seedUnit(store);
    const streaks = new Map<string, number>([[u.unitId, 1]]); // a pending strike from a prior pass

    const result = await pollOnce({
      search: search([]),
      store,
      broadcast: () => {},
      fetchPrState: () => Promise.reject(new Error('network')),
      missStreaks: streaks,
    });

    expect(result.removed).toBe(0);
    expect(store.get(u.unitId)).toBeDefined(); // transient failure ≠ evidence
    expect(streaks.get(u.unitId)).toBe(1); // streak neither incremented nor cleared on error
  });

  it('keeps a decided unit still present in the search (and never fetches its state)', async () => {
    const store = new UnitStore([], det());
    const u = seedUnit(store, { headSha: 'sha-1' });
    store.setReviewedSha(u.unitId, 'sha-1');
    (store.get(u.unitId) as { decision?: unknown }).decision = { kind: 'approved' };
    (store.get(u.unitId) as { status: string }).status = 'approved';

    let fetched = 0;
    const result = await pollOnce({
      search: search([mkPr({ number: 99, headSha: 'sha-1' })]), // still listed (e.g. you're an assignee)
      store,
      broadcast: () => {},
      fetchPrState: () => {
        fetched++;
        return openState();
      },
      missStreaks: new Map(),
    });

    expect(result.removed).toBe(0);
    expect(store.get(u.unitId)!.status).toBe('approved'); // kept: it's the resurface machinery's memory
    expect(fetched).toBe(0); // present in the search → no direct fetch needed
  });

  it('never removes an open-but-unrequested unit that is hydrated and undecided (mid-review)', async () => {
    const store = new UnitStore([], det());
    const u = seedUnit(store);
    store.attachReview(u.unitId, [], mkNarrative(), 0); // reviewer opened it — walkthrough generated
    const streaks = new Map<string, number>();

    // Well past the two-miss threshold: reviewing the PR (comments/review submit) dismisses the
    // review request on GitHub, so the search stops listing it while the reviewer is still reading.
    for (let pass = 0; pass < 3; pass++) {
      const r = await pollOnce({
        search: search([]),
        store,
        broadcast: () => {},
        fetchPrState: openState,
        missStreaks: streaks,
      });
      expect(r.removed).toBe(0);
    }
    expect(store.get(u.unitId)).toBeDefined(); // the walkthrough survives the whole time
    expect(streaks.size).toBe(0); // no streak accrues against a mid-review unit
  });

  it('still removes a hydrated mid-review unit when its PR closes', async () => {
    const store = new UnitStore([], det());
    const u = seedUnit(store);
    store.attachReview(u.unitId, [], mkNarrative(), 0);

    const result = await pollOnce({
      search: search([]),
      store,
      broadcast: () => {},
      fetchPrState: closedState,
      missStreaks: new Map(),
    });

    expect(result.removed).toBe(1);
    expect(store.get(u.unitId)).toBeUndefined(); // closed/merged is unambiguous — the work is moot
  });

  it('removes a hydrated unit normally once decided (reviewed off-plate)', async () => {
    const store = new UnitStore([], det());
    const u = seedUnit(store);
    store.attachReview(u.unitId, [], mkNarrative(), 0);
    (store.get(u.unitId) as { decision?: unknown }).decision = { kind: 'approved' };
    (store.get(u.unitId) as { status: string }).status = 'approved';
    const streaks = new Map<string, number>();

    const p1 = await pollOnce({
      search: search([]),
      store,
      broadcast: () => {},
      fetchPrState: openState,
      missStreaks: streaks,
    });
    expect(p1.removed).toBe(0); // first miss — not evidence yet
    const p2 = await pollOnce({
      search: search([]),
      store,
      broadcast: () => {},
      fetchPrState: openState,
      missStreaks: streaks,
    });
    expect(p2.removed).toBe(1); // decided units keep the two-miss cleanup
    expect(store.get(u.unitId)).toBeUndefined();
  });

  it('removes nothing when no fetchPrState dep is wired (reconciliation skipped)', async () => {
    const store = new UnitStore([], det());
    const u = seedUnit(store);
    const result = await pollOnce({ search: search([]), store, broadcast: () => {} }); // no dep
    expect(result.removed).toBe(0);
    expect(store.get(u.unitId)).toBeDefined();
  });

  it('returns correct counts when a pass both mints and removes', async () => {
    const store = new UnitStore([], det());
    const stale = seedUnit(store, { number: 99 }); // closed → removed
    const result = await pollOnce({
      search: search([mkPr({ number: 42, headSha: 'sha-new' })]), // a brand-new PR → minted
      store,
      broadcast: () => {},
      fetchPrState: closedState,
      missStreaks: new Map(),
    });

    expect(result).toEqual({ minted: 1, resurfaced: 0, removed: 1 });
    expect(store.get(stale.unitId)).toBeUndefined();
    expect(store.list().some((x) => x.prNumber === 42)).toBe(true);
  });

  it('never reconciles a pinned unit away — the PR you added is never in the review-request search', async () => {
    const store = new UnitStore([], det());
    const pinned = store.addGithubUnit({
      owner: 'octo',
      repo: 'demo',
      number: 501,
      title: 'A PR you asked for',
      headBranch: 'feat/manual',
      headSha: 'sha-1',
      author: 'somebody-else',
      url: 'https://github.com/octo/demo/pull/501',
      metadata: { ...mkMetadata(), headSha: 'sha-1' },
      pinned: true,
    });
    const streaks = new Map<string, number>();
    let fetched = 0;
    const fetchPrState = () => {
      fetched++;
      return openState();
    };

    // Far past the two-miss threshold. A hand-added PR is absent from the search by definition —
    // that absence is its normal state, not evidence the work is done.
    for (let pass = 0; pass < 4; pass++) {
      const r = await pollOnce({ search: search([]), store, broadcast: () => {}, fetchPrState, missStreaks: streaks });
      expect(r.removed).toBe(0);
    }
    expect(store.get(pinned.unitId)).toBeDefined();
    expect(streaks.size).toBe(0); // no streak accrues against it
    expect(fetched).toBe(0); // and it never costs a per-poll PR-state fetch
  });

  it('keeps a pinned unit even when its PR is closed/merged (only the reviewer retires it)', async () => {
    const store = new UnitStore([], det());
    const pinned = store.addGithubUnit({
      owner: 'octo',
      repo: 'demo',
      number: 502,
      title: 'A merged PR read after the fact',
      headBranch: 'feat/merged',
      headSha: 'sha-1',
      author: 'somebody-else',
      url: 'https://github.com/octo/demo/pull/502',
      metadata: { ...mkMetadata(), headSha: 'sha-1' },
      pinned: true,
    });

    const result = await pollOnce({
      search: search([]),
      store,
      broadcast: () => {},
      fetchPrState: closedState,
      missStreaks: new Map(),
    });

    // Reading a merged PR is a legitimate thing to ask for; the ✕ (DELETE /api/units/:id) is the
    // only thing that takes it away.
    expect(result.removed).toBe(0);
    expect(store.get(pinned.unitId)).toBeDefined();
  });

  it('logs one reconciliation line naming each removed repo#pr and its reason', async () => {
    const store = new UnitStore([], det());
    seedUnit(store);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await pollOnce({
        search: search([]),
        store,
        broadcast: () => {},
        fetchPrState: closedState,
        missStreaks: new Map(),
      });
      // Find the reconciliation line among the pass's log output — the lane-split line is also emitted
      // every pass, so asserting a single call would couple this test to unrelated instrumentation.
      const line = logSpy.mock.calls.map((c) => String(c[0])).find((l) => l.includes('reconciled queue'));
      expect(line).toBeDefined();
      expect(line).toContain('octo/demo#99');
      expect(line).toContain('closed');
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe('pollOnce archived repos', () => {
  it('never mints a PR whose base repo is archived', async () => {
    const store = new UnitStore([], det());

    const result = await pollOnce({ search: search([mkPr({ archived: true })]), store, broadcast: () => {} });

    expect(result).toEqual({ minted: 0, resurfaced: 0, removed: 0 });
    expect(store.list()).toEqual([]);
  });

  it('still mints the non-archived PRs in the same pass', async () => {
    const store = new UnitStore([], det());

    const result = await pollOnce({
      search: search([mkPr({ number: 1, archived: true }), mkPr({ number: 2 })]),
      store,
      broadcast: () => {},
    });

    expect(result.minted).toBe(1);
    expect(store.list().map((u) => u.prNumber)).toEqual([2]);
  });

  it('drops a unit already in the queue once its repo is archived', async () => {
    const store = new UnitStore([], det());
    await pollOnce({ search: search([mkPr()]), store, broadcast: () => {} });
    expect(store.list().length).toBe(1);

    // Same PR, now archived upstream.
    const result = await pollOnce({ search: search([mkPr({ archived: true })]), store, broadcast: () => {} });

    expect(result.removed).toBe(1);
    expect(store.list()).toEqual([]);
  });

  it('drops it without a fetchPrState dep — the search keeps returning it, so no miss streak ever fires', async () => {
    const store = new UnitStore([], det());
    await pollOnce({ search: search([mkPr()]), store, broadcast: () => {} });

    // No `fetchPrState`: reconciliation is skipped entirely, yet the archived unit must still go.
    const result = await pollOnce({ search: search([mkPr({ archived: true })]), store, broadcast: () => {} });

    expect(result.removed).toBe(1);
    expect(store.list()).toEqual([]);
  });

  it('keeps a pinned unit whose repo is archived — reading still works, and you asked for that one', async () => {
    const store = new UnitStore([], det());
    store.addGithubUnit({
      owner: 'octo',
      repo: 'demo',
      number: 42,
      title: 'Add widgets',
      headBranch: 'feat/widgets',
      headSha: 'sha-1',
      author: 'octocat',
      url: 'https://github.com/octo/demo/pull/42',
      baseRef: 'main',
      metadata: mkMetadata(),
      pinned: true,
    });

    const result = await pollOnce({ search: search([mkPr({ archived: true })]), store, broadcast: () => {} });

    expect(result.removed).toBe(0);
    expect(store.list().length).toBe(1);
  });

  it('names the archived reason in the reconciliation log line', async () => {
    const store = new UnitStore([], det());
    await pollOnce({ search: search([mkPr()]), store, broadcast: () => {} });
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await pollOnce({ search: search([mkPr({ archived: true })]), store, broadcast: () => {} });
      const line = logSpy.mock.calls.map((c) => String(c[0])).find((l) => l.includes('reconciled queue'));
      expect(line).toBeDefined();
      expect(line).toContain('octo/demo#42');
      expect(line).toContain('archived');
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe('pollOnce triage', () => {
  /** Counting fake for the file-list fetch — separates mint-time fetches from backfill heals. */
  function summarySpy(files: string[] = ['README.md']) {
    const calls: { owner: string; repo: string; number: number }[] = [];
    const fn = async (pr: { owner: string; repo: string; number: number }) => {
      calls.push(pr);
      return {
        files: files.map((path) => ({ path, status: 'modified', additions: 1, deletions: 0 })),
        truncated: false,
      };
    };
    return { fn, calls };
  }

  it('mints a unit carrying a triage summary, with exactly one file-list fetch', async () => {
    const store = new UnitStore([], det());
    const spy = summarySpy(['README.md', 'docs/a.md']);

    await pollOnce({ search: search([mkPr()]), store, broadcast: () => {}, fetchFileSummary: spy.fn });

    expect(spy.calls).toHaveLength(1); // one page, one request — never paginated
    const u = store.list()[0]!;
    expect(u.triage).toBeDefined();
    expect(u.triage!.sha).toBe('sha-1');
    expect(u.triage!.files.map((f) => f.kind)).toEqual(['docs', 'docs']);
  });

  it('mints with no model call — the poller has no AI dependency to reach for', async () => {
    // Structural, not behavioural: pollOnce's signature has no AI dep, so narrative generation is
    // unreachable from a poll pass. The assertion that matters is that a minted unit is un-narrated —
    // if that ever changes, minting started costing tokens.
    const store = new UnitStore([], det());
    const spy = summarySpy();
    await pollOnce({ search: search([mkPr()]), store, broadcast: () => {}, fetchFileSummary: spy.fn });
    const u = store.list()[0]!;
    expect(u.narrative).toBeUndefined();
    expect(u.files).toEqual([]);
  });

  it('re-triages when the head sha moves, so stale evidence cannot outlive the diff', async () => {
    const store = new UnitStore([], det());
    const docs = summarySpy(['README.md']);
    await pollOnce({ search: search([mkPr()]), store, broadcast: () => {}, fetchFileSummary: docs.fn });
    const id = store.list()[0]!.unitId;
    expect(store.get(id)!.triage!.files[0]!.kind).toBe('docs');

    // The author pushes a source file onto what was a docs-only PR.
    const src = summarySpy(['README.md', 'src/auth/token.ts']);
    await pollOnce({
      search: search([mkPr({ headSha: 'sha-2' })]),
      store,
      broadcast: () => {},
      fetchFileSummary: src.fn,
    });

    const after = store.get(id)!;
    expect(after.triage!.sha).toBe('sha-2');
    expect(after.triage!.criticality).toContain('auth');
  });

  it('does not re-triage when the head sha is unchanged', async () => {
    const store = new UnitStore([], det());
    const first = summarySpy();
    await pollOnce({ search: search([mkPr()]), store, broadcast: () => {}, fetchFileSummary: first.fn });
    const second = summarySpy();
    await pollOnce({ search: search([mkPr()]), store, broadcast: () => {}, fetchFileSummary: second.fn });
    expect(second.calls).toHaveLength(0); // same sha → no fetch at all
  });

  it('backfills a legacy unit that carries no triage summary', async () => {
    const store = new UnitStore([], det());
    // A unit as it would have been persisted before this feature existed.
    const u = store.addGithubUnit({
      owner: 'octo',
      repo: 'demo',
      number: 42,
      title: 'Add widgets',
      headBranch: 'feat/widgets',
      headSha: 'sha-1',
      author: 'octocat',
      url: 'https://github.com/octo/demo/pull/42',
      metadata: { ...mkMetadata('feat/widgets'), headSha: 'sha-1' },
    });
    expect(store.get(u.unitId)!.triage).toBeUndefined();

    const spy = summarySpy(['bun.lock']);
    // Search returns nothing: the heal must not depend on the PR being polled this pass.
    await pollOnce({ search: search([]), store, broadcast: () => {}, fetchFileSummary: spy.fn });

    expect(spy.calls).toHaveLength(1);
    expect(store.get(u.unitId)!.triage!.files[0]!.kind).toBe('lockfile');
  });

  it('counts a backfill heal separately from a mint fetch', async () => {
    const store = new UnitStore([], det());
    store.addGithubUnit({
      owner: 'octo',
      repo: 'other',
      number: 7,
      title: 'Legacy',
      headBranch: 'x',
      headSha: 'sha-old',
      author: 'octocat',
      url: 'https://github.com/octo/other/pull/7',
      metadata: { ...mkMetadata('x'), headSha: 'sha-old' },
    });
    const spy = summarySpy();

    // One brand-new PR minted + one legacy unit healed = 2 fetches, but only one of them is a mint.
    const result = await pollOnce({
      search: search([mkPr()]),
      store,
      broadcast: () => {},
      fetchFileSummary: spy.fn,
    });

    expect(result.minted).toBe(1);
    expect(spy.calls).toHaveLength(2);
    expect(spy.calls.filter((c) => c.number === 42)).toHaveLength(1); // the mint
    expect(spy.calls.filter((c) => c.number === 7)).toHaveLength(1); // the heal
  });

  it('leaves the unit un-triaged rather than fabricating a summary when the fetch fails', async () => {
    const store = new UnitStore([], det());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await pollOnce({
        search: search([mkPr()]),
        store,
        broadcast: () => {},
        fetchFileSummary: async () => {
          throw new Error('502 bad gateway');
        },
      });
      // An empty summary would read as "we looked and found nothing" — absence of evidence must stay absent.
      expect(store.list()[0]!.triage).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });

  it('fetches a reviews rollup per poll for queued units only, skipping decided and dismissed', async () => {
    // Seeded with three units so exclusion is actually proven: a single queued unit would pass this
    // test against an implementation that fetched for everything.
    const store = new UnitStore([], det());
    const mk = (number: number) =>
      store.addGithubUnit({
        owner: 'octo',
        repo: 'demo',
        number,
        title: `PR ${number}`,
        headBranch: 'x',
        headSha: 'sha-1',
        author: 'octocat',
        url: `https://github.com/octo/demo/pull/${number}`,
        metadata: { ...mkMetadata('x'), headSha: 'sha-1' },
      });
    const queuedUnit = mk(1);
    const decided = mk(2);
    const hidden = mk(3);
    (store.get(decided.unitId) as { status: string }).status = 'approved';
    store.dismiss(hidden.unitId, 'sha-1');

    const seen: number[] = [];
    await pollOnce({
      search: search([]),
      store,
      broadcast: () => {},
      fetchReviews: async (unit) => {
        seen.push(unit.prNumber!);
        return { approved: 2, changesRequested: 0 };
      },
    });

    expect(seen).toEqual([1]); // only the queued one
    expect(store.get(queuedUnit.unitId)!.reviewRollup).toEqual({ approved: 2, changesRequested: 0 });
    expect(store.get(decided.unitId)!.reviewRollup).toBeUndefined();
    expect(store.get(hidden.unitId)!.reviewRollup).toBeUndefined();
  });

  it('survives a failing reviews fetch — ordering data must not fail a poll pass', async () => {
    const store = new UnitStore([], det());
    const result = await pollOnce({
      search: search([mkPr()]),
      store,
      broadcast: () => {},
      fetchReviews: async () => {
        throw new Error('rate limited');
      },
    });
    expect(result.minted).toBe(1);
    expect(store.list()[0]!.reviewRollup).toBeUndefined();
  });

  it('logs a lane split each pass', async () => {
    const store = new UnitStore([], det());
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await pollOnce({
        search: search([mkPr()]),
        store,
        broadcast: () => {},
        fetchFileSummary: summarySpy(['README.md']).fn,
      });
      const line = logSpy.mock.calls.map((c) => String(c[0])).find((l) => l.includes('lanes:'));
      expect(line).toBeDefined();
      expect(line).toContain('1 probably-not');
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe('pollOnce dismiss', () => {
  const seed = (store: UnitStore, headSha = 'sha-1') =>
    store.addGithubUnit({
      owner: 'octo',
      repo: 'demo',
      number: 42,
      title: 'Add widgets',
      headBranch: 'feat/widgets',
      headSha,
      author: 'octocat',
      url: 'https://github.com/octo/demo/pull/42',
      metadata: { ...mkMetadata('feat/widgets'), headSha },
    });

  it('does not re-mint a dismissed unit the search still returns', async () => {
    // The whole point: a hard delete is undone by the next poll, because classify only checks existence.
    const store = new UnitStore([], det());
    const u = seed(store);
    store.dismiss(u.unitId, 'sha-1');

    const result = await pollOnce({ search: search([mkPr()]), store, broadcast: () => {} });

    expect(result.minted).toBe(0);
    expect(store.list()).toHaveLength(1);
    expect(store.get(u.unitId)!.dismissedAtSha).toBe('sha-1');
  });

  it('brings a dismissed unit back when the author pushes past the dismissed sha', async () => {
    const store = new UnitStore([], det());
    const u = seed(store);
    store.dismiss(u.unitId, 'sha-1');

    await pollOnce({ search: search([mkPr({ headSha: 'sha-2' })]), store, broadcast: () => {} });

    expect(store.get(u.unitId)!.dismissedAtSha).toBeUndefined();
  });

  it('excludes dismissed units from the lane split', async () => {
    const store = new UnitStore([], det());
    const u = seed(store);
    store.dismiss(u.unitId, 'sha-1');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await pollOnce({ search: search([mkPr()]), store, broadcast: () => {} });
      const line = logSpy.mock.calls.map((c) => String(c[0])).find((l) => l.includes('lanes:'));
      expect(line).toContain('0 tracked');
    } finally {
      logSpy.mockRestore();
    }
  });

  it('still hard-removes a dismissed unit whose repo is archived', async () => {
    // Dismissal hides work you could do; archived removal drops work you cannot. The second must win.
    const store = new UnitStore([], det());
    const u = seed(store);
    store.dismiss(u.unitId, 'sha-1');

    const result = await pollOnce({ search: search([mkPr({ archived: true })]), store, broadcast: () => {} });

    expect(result.removed).toBe(1);
    expect(store.list()).toEqual([]);
  });
});

describe('pollOnce dismiss — reconcile exemption', () => {
  it('never reconciles a dismissed unit away, because removing it would resurrect the PR', async () => {
    // The subtle failure this guards: the dismissal lives ON the unit, so a hard delete drops the stamp
    // with it and the next pass mints a fresh unit that has never heard of the dismissal. Two
    // eventually-consistent search misses would silently un-dismiss a PR at the same sha.
    const store = new UnitStore([], det());
    const u = store.addGithubUnit({
      owner: 'octo',
      repo: 'demo',
      number: 99,
      title: 'Hidden',
      headBranch: 'x',
      headSha: 'sha-1',
      author: 'octocat',
      url: 'https://github.com/octo/demo/pull/99',
      metadata: { ...mkMetadata('x'), headSha: 'sha-1' },
    });
    store.dismiss(u.unitId, 'sha-1');
    const streaks = new Map<string, number>();

    // Absent from the search, PR still open — the exact shape that trips the two-miss removal.
    for (let i = 0; i < 3; i++) {
      await pollOnce({
        search: search([]),
        store,
        broadcast: () => {},
        fetchPrState: async () => ({ open: true }),
        missStreaks: streaks,
      });
    }

    expect(store.get(u.unitId)).toBeDefined();
    expect(store.get(u.unitId)!.dismissedAtSha).toBe('sha-1');
    expect(streaks.get(u.unitId)).toBeUndefined(); // streak reset, never accumulated
  });
});
