import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pollOnce } from '../poller';
import { UnitStore } from '../../units/store';
import type { PRMetadata } from '../../github/types';
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
      expect(logSpy).toHaveBeenCalledTimes(1);
      const line = String(logSpy.mock.calls[0]![0]);
      expect(line).toContain('octo/demo#99');
      expect(line).toContain('closed');
    } finally {
      logSpy.mockRestore();
    }
  });
});
