import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { UnitStore } from '../store';
import { IllegalTransitionError, UnknownUnitError } from '../types';
import type { ReviewUnit } from '../types';
import type { NarrativeResponse } from '../../narrative/types';
import type { PRMetadata } from '../../github/types';

// --- fixtures -------------------------------------------------------------

let dir: string;

/** Deterministic store options bound to the current temp dir: stable clock + monotonic ids. */
function det() {
  let seq = 0;
  return { dir, now: () => '2026-01-01T00:00:00.000Z', genId: () => `unit-${++seq}` };
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
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    commits: 0,
    headSha: 'abc',
  };
}

/** Mint a github unit with sensible defaults — the only ingestion path now (born `queued`). */
function mkGithub(store: UnitStore, over: { owner?: string; repo?: string; number?: number; headSha?: string } = {}) {
  const owner = over.owner ?? 'octo';
  const repo = over.repo ?? 'demo';
  const number = over.number ?? 1;
  return store.addGithubUnit({
    owner,
    repo,
    number,
    title: 'Add widgets',
    headBranch: 'feat/widgets',
    headSha: over.headSha ?? 'sha-1',
    author: 'octocat',
    url: `https://github.com/${owner}/${repo}/pull/${number}`,
    metadata: mkMetadata('feat/widgets'),
  });
}

const NARRATIVE: NarrativeResponse = {
  title: 't',
  tldr: 'td',
  verdict: 'caution',
  readingPlan: [],
  concerns: [],
  chapters: [],
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'diffdad-units-'));
});
afterEach(async () => {
  // The synchronous github mutations (addGithubUnit/setReviewedSha/…) fire their best-effort save() without
  // awaiting; let any in-flight write settle before we rm the temp dir, else it logs teardown noise.
  await new Promise((r) => setTimeout(r, 25));
  await rm(dir, { recursive: true, force: true });
});

// --- tests ----------------------------------------------------------------

describe('UnitStore', () => {
  it('decides a queued github unit approved (queued → approved)', async () => {
    const store = new UnitStore([], det());
    const u = mkGithub(store);
    expect(u.status).toBe('queued');
    await store.setDecision(u.unitId, { kind: 'approved' });
    expect(store.get(u.unitId)!.status).toBe('approved');
  });

  it('records a changes_requested decision with curated concerns', async () => {
    const store = new UnitStore([], det());
    const u = mkGithub(store);
    const decision = {
      kind: 'changes_requested' as const,
      concerns: [{ question: 'null here?', file: 'a.ts', line: 2, category: 'logic' as const, why: 'x' }],
      note: 'fix it',
    };
    await store.setDecision(u.unitId, decision);
    const after = store.get(u.unitId)!;
    expect(after.status).toBe('changes_requested');
    expect(after.decision).toEqual(decision);
  });

  it('rejects a second decision on an already-decided unit with IllegalTransitionError', async () => {
    const store = new UnitStore([], det());
    const u = mkGithub(store);
    await store.setDecision(u.unitId, { kind: 'approved' });
    // approved only advances to done — a second verdict is an illegal transition
    await expect(store.setDecision(u.unitId, { kind: 'approved' })).rejects.toBeInstanceOf(IllegalTransitionError);
  });

  it('throws UnknownUnitError for an unknown id', async () => {
    const store = new UnitStore([], det());
    await expect(store.setDecision('nope', { kind: 'approved' })).rejects.toBeInstanceOf(UnknownUnitError);
  });

  it('lists cross-repo and filters by repo and status', async () => {
    const store = new UnitStore([], det());
    mkGithub(store, { owner: 'owner', repo: 'a', number: 1 });
    const b = mkGithub(store, { owner: 'owner', repo: 'b', number: 2 });
    await store.setDecision(b.unitId, { kind: 'approved' });
    expect(store.list().length).toBe(2);
    expect(store.list({ repo: 'owner/a' }).length).toBe(1);
    expect(store.list({ status: 'approved' }).map((u) => u.repo)).toEqual(['owner/b']);
  });

  it('persists a decided unit and reloads equal (round-trip), sanitizing the repo slash in the filename', async () => {
    const opts = det();
    const store = new UnitStore([], opts);
    const u = mkGithub(store, { owner: 'owner', repo: 'repo' });
    // addGithubUnit's save() is fire-and-forget; let it land before the awaited decision write, so disk
    // ends in the decided state rather than racing back to 'queued'.
    await new Promise((r) => setTimeout(r, 25));
    await store.setDecision(u.unitId, { kind: 'approved' });
    const reloaded = await UnitStore.load(opts);
    expect(reloaded.get(u.unitId)).toEqual(store.get(u.unitId));
    expect(reloaded.list().length).toBe(1);
  });

  it('load() drops a persisted unit whose source is not github (no longer representable)', async () => {
    const opts = det();
    const legacy = {
      unitId: 'unit-legacy',
      repo: 'owner/repo',
      source: 'agent', // written by the old local path, before the github-only collapse
      worktreePath: '/tmp/wt',
      taskLabel: 'task',
      intent: 'do a thing',
      uncertainties: [],
      baseRef: 'main',
      diffContentKey: 'key123',
      status: 'submitted',
      toResolve: 0,
      files: [],
      metadata: mkMetadata(),
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await writeFile(join(dir, 'owner-repo-unit-legacy.json'), JSON.stringify(legacy, null, 2));
    const store = await UnitStore.load(opts);
    expect(store.get('unit-legacy')).toBeUndefined();
    expect(store.list().length).toBe(0);
  });

  // --- github ingestion ---------------------------------------------------

  describe('addGithubUnit', () => {
    it('mints a github unit as queued (NOT submitted — never enters the worker pool)', async () => {
      const store = new UnitStore([], det());
      const u = store.addGithubUnit({
        owner: 'octo',
        repo: 'demo',
        number: 42,
        title: 'Add widgets',
        headBranch: 'feat/widgets',
        headSha: 'deadbeef',
        author: 'octocat',
        url: 'https://github.com/octo/demo/pull/42',
        metadata: mkMetadata('feat/widgets'),
      });
      expect(u.unitId).toBe('unit-1');
      expect(u.source).toBe('github');
      expect(u.status).toBe('queued'); // critical: born queued, walkthrough generated lazily on open
      expect(u.repo).toBe('octo/demo');
      expect(u.taskLabel).toBe('Add widgets');
      expect(u.prNumber).toBe(42);
      expect(u.prUrl).toBe('https://github.com/octo/demo/pull/42');
      expect(u.prAuthor).toBe('octocat');
      expect(u.diffContentKey).toBe('deadbeef'); // headSha keys the (lazy) narrative cache
      expect(u.files).toEqual([]);
      expect(u.lastReviewedSha).toBeUndefined();
      expect(u.createdAt).toBe('2026-01-01T00:00:00.000Z');
      expect(u.updatedAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('defaults baseRef to main and carries the provided base when given', async () => {
      const store = new UnitStore([], det());
      const a = store.addGithubUnit({
        owner: 'octo',
        repo: 'demo',
        number: 1,
        title: 't',
        headBranch: 'b',
        headSha: 's',
        author: 'a',
        url: 'u',
        metadata: mkMetadata('b'),
      });
      expect(a.baseRef).toBe('main');
      const b = store.addGithubUnit({
        owner: 'octo',
        repo: 'demo',
        number: 2,
        title: 't',
        headBranch: 'b',
        headSha: 's',
        author: 'a',
        url: 'u',
        baseRef: 'develop',
        metadata: mkMetadata('b'),
      });
      expect(b.baseRef).toBe('develop');
    });

    it('round-trips a github unit (with pr fields) through a reload', async () => {
      const opts = det();
      const store = new UnitStore([], opts);
      const { unitId } = store.addGithubUnit({
        owner: 'octo',
        repo: 'demo',
        number: 7,
        title: 'Fix',
        headBranch: 'fix/x',
        headSha: 'sha7',
        author: 'mona',
        url: 'https://github.com/octo/demo/pull/7',
        metadata: mkMetadata('fix/x'),
      });
      // addGithubUnit persists synchronously via the same save() path; give the write a tick.
      await new Promise((r) => setTimeout(r, 20));
      const reloaded = await UnitStore.load(opts);
      const r = reloaded.get(unitId)!;
      expect(r.source).toBe('github');
      expect(r.status).toBe('queued');
      expect(r.prNumber).toBe(7);
      expect(r.prAuthor).toBe('mona');
      expect(r.prUrl).toBe('https://github.com/octo/demo/pull/7');
    });
  });

  describe('attachReview', () => {
    it('sets files + narrative + verdict + toResolve WITHOUT a status transition (github unit stays queued)', async () => {
      const store = new UnitStore([], det());
      const u = store.addGithubUnit({
        owner: 'octo',
        repo: 'demo',
        number: 11,
        title: 'Lazy',
        headBranch: 'feat/lazy',
        headSha: 'lazysha',
        author: 'octocat',
        url: 'https://github.com/octo/demo/pull/11',
        metadata: mkMetadata('feat/lazy'),
      });
      const files = [{ path: 'a.ts' }] as unknown as ReviewUnit['files'];
      const after = store.attachReview(u.unitId, files, NARRATIVE, 4);
      expect(after.status).toBe('queued'); // critical: lazy hydration does NOT transition state
      expect(after.files).toBe(files);
      expect(after.narrative).toEqual(NARRATIVE);
      expect(after.verdict).toBe(NARRATIVE.verdict);
      expect(after.toResolve).toBe(4);
      expect(after.source).toBe('github'); // still a github unit
    });

    it('round-trips the attached review through a reload', async () => {
      const opts = det();
      const store = new UnitStore([], opts);
      const u = store.addGithubUnit({
        owner: 'octo',
        repo: 'demo',
        number: 12,
        title: 'Lazy2',
        headBranch: 'feat/lazy2',
        headSha: 'lazysha2',
        author: 'octocat',
        url: 'https://github.com/octo/demo/pull/12',
        metadata: mkMetadata('feat/lazy2'),
      });
      const files = [{ path: 'b.ts' }] as unknown as ReviewUnit['files'];
      store.attachReview(u.unitId, files, NARRATIVE, 2);
      await new Promise((r) => setTimeout(r, 20)); // best-effort save() isn't awaited
      const reloaded = await UnitStore.load(opts);
      const r = reloaded.get(u.unitId)!;
      expect(r.status).toBe('queued');
      expect(r.narrative).toEqual(NARRATIVE);
      expect(r.verdict).toBe(NARRATIVE.verdict);
      expect(r.toResolve).toBe(2);
      expect(r.files).toEqual(files);
    });

    it('throws UnknownUnitError for an unknown id', () => {
      const store = new UnitStore([], det());
      expect(() => store.attachReview('nope', [], NARRATIVE, 0)).toThrow(UnknownUnitError);
    });
  });

  describe('setReviewedSha', () => {
    it('records lastReviewedSha on the unit', async () => {
      const store = new UnitStore([], det());
      const u = store.addGithubUnit({
        owner: 'octo',
        repo: 'demo',
        number: 5,
        title: 't',
        headBranch: 'b',
        headSha: 'h1',
        author: 'a',
        url: 'u',
        metadata: mkMetadata('b'),
      });
      const after = store.setReviewedSha(u.unitId, 'h1');
      expect(after.lastReviewedSha).toBe('h1');
    });

    it('throws UnknownUnitError for an unknown id', () => {
      const store = new UnitStore([], det());
      expect(() => store.setReviewedSha('nope', 's')).toThrow(UnknownUnitError);
    });
  });

  describe('resurfaceForNewPush', () => {
    async function approvedGithubUnit() {
      const store = new UnitStore([], det());
      const u = store.addGithubUnit({
        owner: 'octo',
        repo: 'demo',
        number: 3,
        title: 't',
        headBranch: 'b',
        headSha: 'old',
        author: 'a',
        url: 'u',
        metadata: mkMetadata('b'),
      });
      // simulate a recorded decision the way the decision dispatch would
      store.setReviewedSha(u.unitId, 'old');
      (store.get(u.unitId) as { decision?: unknown }).decision = { kind: 'approved' };
      (store.get(u.unitId) as { status: string }).status = 'approved';
      return { store, unitId: u.unitId };
    }

    it('moves an approved github unit back to queued, clears decision, sets metadata.headSha', async () => {
      const { store, unitId } = await approvedGithubUnit();
      const after = store.resurfaceForNewPush(unitId, 'fresh');
      expect(after.status).toBe('queued');
      expect(after.decision).toBeUndefined();
      expect(after.metadata.headSha).toBe('fresh');
    });

    it('resets the stale walkthrough (narrative/files/verdict/toResolve) so the next open re-hydrates fresh', async () => {
      const { store, unitId } = await approvedGithubUnit();
      // Seed a stale walkthrough from the prior review the way lazy hydration would.
      store.attachReview(unitId, [{ path: 'a.ts' }] as unknown as ReviewUnit['files'], NARRATIVE, 3);
      const before = store.get(unitId)!;
      expect(before.narrative).toEqual(NARRATIVE);
      expect(before.files).toHaveLength(1);

      const after = store.resurfaceForNewPush(unitId, 'fresh');
      expect(after.status).toBe('queued');
      expect(after.narrative).toBeUndefined();
      expect(after.files).toEqual([]);
      expect(after.verdict).toBeUndefined();
      expect(after.toResolve).toBe(0);
    });

    it('advances diffContentKey to the new head so the narrative cache key is not pinned to the old sha', async () => {
      const { store, unitId } = await approvedGithubUnit();
      expect(store.get(unitId)!.diffContentKey).toBe('old'); // minted = old headSha
      const after = store.resurfaceForNewPush(unitId, 'fresh');
      expect(after.diffContentKey).toBe('fresh'); // mirrors the mint-time invariant (diffContentKey = headSha)
    });

    it('resurfaces a changes_requested github unit too', async () => {
      const { store, unitId } = await approvedGithubUnit();
      (store.get(unitId) as { status: string }).status = 'changes_requested';
      (store.get(unitId) as { decision?: unknown }).decision = { kind: 'changes_requested' };
      const after = store.resurfaceForNewPush(unitId, 'fresh2');
      expect(after.status).toBe('queued');
      expect(after.decision).toBeUndefined();
      expect(after.metadata.headSha).toBe('fresh2');
    });

    it('throws for a github unit that is not in a reviewed state (still queued)', async () => {
      const store = new UnitStore([], det());
      const u = store.addGithubUnit({
        owner: 'octo',
        repo: 'demo',
        number: 9,
        title: 't',
        headBranch: 'b',
        headSha: 'h',
        author: 'a',
        url: 'u',
        metadata: mkMetadata('b'),
      });
      // freshly minted github units are 'queued', not reviewed → cannot resurface
      expect(() => store.resurfaceForNewPush(u.unitId, 's')).toThrow();
    });

    it('throws UnknownUnitError for an unknown id', () => {
      const store = new UnitStore([], det());
      expect(() => store.resurfaceForNewPush('nope', 's')).toThrow(UnknownUnitError);
    });
  });

  describe('remove', () => {
    it('drops the unit from memory and disk, returning true', async () => {
      const store = new UnitStore([], det());
      const u = mkGithub(store);
      await new Promise((r) => setTimeout(r, 20)); // let addGithubUnit's fire-and-forget save() land first
      expect(await store.remove(u.unitId)).toBe(true);
      expect(store.get(u.unitId)).toBeUndefined();
      // gone from disk too: a fresh load must not resurrect it
      const reloaded = await UnitStore.load(det());
      expect(reloaded.get(u.unitId)).toBeUndefined();
    });

    it('returns false for an unknown id', async () => {
      const store = new UnitStore([], det());
      expect(await store.remove('nope')).toBe(false);
    });
  });
});
