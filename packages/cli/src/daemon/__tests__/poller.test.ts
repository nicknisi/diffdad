import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pollOnce } from '../poller';
import { UnitStore } from '../../units/store';
import type { PRMetadata } from '../../github/types';
import type { PolledPr } from '../../units/types';

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

    expect(result).toEqual({ minted: 1, linked: 0, resurfaced: 0 });
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
    expect(first).toEqual({ minted: 1, linked: 0, resurfaced: 0 });
    expect(store.list().length).toBe(1);

    const second = await pollOnce({ search: search([mkPr()]), store, broadcast: () => {} });
    expect(second).toEqual({ minted: 0, linked: 0, resurfaced: 0 });
    expect(store.list().length).toBe(1); // no duplicate minted
  });

  it('links a PR to a pre-seeded agent unit by repo + head branch (no new unit)', async () => {
    const store = new UnitStore([], det());
    const seeded = await store.add({
      repo: 'octo/demo',
      source: 'agent',
      worktreePath: '/wt',
      taskLabel: 'agent work',
      intent: 'x',
      baseRef: 'main',
      diffContentKey: 'k',
      files: [],
      metadata: mkMetadata('feat/widgets'),
    });
    const events: string[] = [];
    const broadcast = (event: string) => events.push(event);

    const result = await pollOnce({ search: search([mkPr()]), store, broadcast });

    expect(result).toEqual({ minted: 0, linked: 1, resurfaced: 0 });
    expect(store.list().length).toBe(1); // no new unit
    const u = store.get(seeded.unitId)!;
    expect(u.source).toBe('agent'); // source unchanged
    expect(u.status).toBe('submitted'); // status unchanged
    expect(u.prNumber).toBe(42);
    expect(u.prUrl).toBe('https://github.com/octo/demo/pull/42');
    expect(u.prAuthor).toBe('octocat');
    expect(u.metadata.headSha).toBe('sha-1'); // linkPr advances the head sha
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

    expect(result).toEqual({ minted: 0, linked: 0, resurfaced: 1 });
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

    expect(result).toEqual({ minted: 0, linked: 0, resurfaced: 0 });
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
