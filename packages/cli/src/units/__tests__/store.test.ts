import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { UnitStore } from '../store';
import { IllegalTransitionError, UnknownUnitError } from '../types';
import type { NewReviewUnit, ReviewUnit } from '../types';
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

function mkInput(o: Partial<NewReviewUnit> = {}): NewReviewUnit {
  return {
    repo: 'owner/repo',
    worktreePath: '/tmp/wt',
    taskLabel: 'task',
    intent: 'do a thing',
    uncertainties: [],
    baseRef: 'main',
    diffContentKey: 'key123',
    files: [],
    metadata: mkMetadata(),
    ...o,
  };
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
  // The synchronous github mutations (addGithubUnit/linkPr/…) fire their best-effort save() without
  // awaiting; let any in-flight write settle before we rm the temp dir, else it logs teardown noise.
  await new Promise((r) => setTimeout(r, 25));
  await rm(dir, { recursive: true, force: true });
});

// --- tests ----------------------------------------------------------------

describe('UnitStore', () => {
  it('add() creates a submitted unit with a generated id and timestamps', async () => {
    const store = new UnitStore([], det());
    const u = await store.add(mkInput());
    expect(u.unitId).toBe('unit-1');
    expect(u.status).toBe('submitted');
    expect(u.toResolve).toBe(0);
    expect(u.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(u.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('walks the happy path submitted → reviewing → queued → approved', async () => {
    const store = new UnitStore([], det());
    const { unitId } = await store.add(mkInput());
    await store.setReviewing(unitId);
    expect(store.get(unitId)!.status).toBe('reviewing');
    await store.setQueued(unitId, NARRATIVE, 3);
    const q = store.get(unitId)!;
    expect(q.status).toBe('queued');
    expect(q.toResolve).toBe(3);
    expect(q.verdict).toBe('caution');
    expect(q.narrative).toEqual(NARRATIVE);
    await store.setDecision(unitId, { kind: 'approved' });
    expect(store.get(unitId)!.status).toBe('approved');
  });

  it('records a changes_requested decision with curated concerns', async () => {
    const store = new UnitStore([], det());
    const { unitId } = await store.add(mkInput());
    await store.setReviewing(unitId);
    await store.setQueued(unitId, NARRATIVE, 1);
    const decision = {
      kind: 'changes_requested' as const,
      concerns: [{ question: 'null here?', file: 'a.ts', line: 2, category: 'logic' as const, why: 'x' }],
      note: 'fix it',
    };
    await store.setDecision(unitId, decision);
    const u = store.get(unitId)!;
    expect(u.status).toBe('changes_requested');
    expect(u.decision).toEqual(decision);
  });

  it('rejects an illegal transition (submitted → queued) with IllegalTransitionError', async () => {
    const store = new UnitStore([], det());
    const { unitId } = await store.add(mkInput());
    await expect(store.setQueued(unitId, NARRATIVE, 0)).rejects.toBeInstanceOf(IllegalTransitionError);
  });

  it('rejects deciding a unit that is not queued', async () => {
    const store = new UnitStore([], det());
    const { unitId } = await store.add(mkInput());
    await store.setReviewing(unitId);
    await expect(store.setDecision(unitId, { kind: 'approved' })).rejects.toBeInstanceOf(IllegalTransitionError);
  });

  it('setReviewFailed queues the unit with an error so it still reaches the reviewer', async () => {
    const store = new UnitStore([], det());
    const { unitId } = await store.add(mkInput());
    await store.setReviewing(unitId);
    await store.setReviewFailed(unitId, 'pipeline blew up');
    const u = store.get(unitId)!;
    expect(u.status).toBe('queued');
    expect(u.error).toBe('pipeline blew up');
  });

  it('throws UnknownUnitError for an unknown id', async () => {
    const store = new UnitStore([], det());
    await expect(store.setReviewing('nope')).rejects.toBeInstanceOf(UnknownUnitError);
  });

  it('lists cross-repo and filters by repo and status', async () => {
    const store = new UnitStore([], det());
    await store.add(mkInput({ repo: 'owner/a' }));
    const b = await store.add(mkInput({ repo: 'owner/b' }));
    await store.setReviewing(b.unitId);
    expect(store.list().length).toBe(2);
    expect(store.list({ repo: 'owner/a' }).length).toBe(1);
    expect(store.list({ status: 'reviewing' }).map((u) => u.repo)).toEqual(['owner/b']);
  });

  it('persists per-unit and reloads equal (round-trip), sanitizing the repo slash in the filename', async () => {
    const opts = det();
    const store = new UnitStore([], opts);
    const { unitId } = await store.add(mkInput({ repo: 'owner/repo' }));
    await store.setReviewing(unitId);
    await store.setQueued(unitId, NARRATIVE, 2);
    const reloaded = await UnitStore.load(opts);
    expect(reloaded.get(unitId)).toEqual(store.get(unitId));
    expect(reloaded.list().length).toBe(1);
  });

  it('add() with source:cli persists and round-trips through a reload', async () => {
    const opts = det();
    const store = new UnitStore([], opts);
    const { unitId } = await store.add(mkInput({ source: 'cli' }));
    expect(store.get(unitId)!.source).toBe('cli');
    const reloaded = await UnitStore.load(opts);
    expect(reloaded.get(unitId)!.source).toBe('cli');
  });

  it('add() without source defaults to agent', async () => {
    const store = new UnitStore([], det());
    const u = await store.add(mkInput());
    expect(u.source).toBe('agent');
  });

  it('loads a persisted unit file missing source as agent (back-compat)', async () => {
    const opts = det();
    const persisted = {
      unitId: 'unit-legacy',
      repo: 'owner/repo',
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
      // note: no `source` field — written before the discriminator existed
    };
    await writeFile(join(dir, 'owner-repo-unit-legacy.json'), JSON.stringify(persisted, null, 2));
    const store = await UnitStore.load(opts);
    expect(store.get('unit-legacy')!.source).toBe('agent');
  });

  // --- multi-source: github ingestion -------------------------------------

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
      expect(u.status).toBe('queued'); // critical: not 'submitted' — kick() must never pick it
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

  describe('linkPr', () => {
    it('attaches pr fields to an existing agent unit without changing status', async () => {
      const store = new UnitStore([], det());
      const { unitId } = await store.add(mkInput({ source: 'agent' }));
      await store.setReviewing(unitId);
      const linked = store.linkPr(unitId, {
        prNumber: 99,
        prUrl: 'https://github.com/owner/repo/pull/99',
        prAuthor: 'dev',
        headSha: 'newhead',
      });
      expect(linked.status).toBe('reviewing'); // unchanged
      expect(linked.prNumber).toBe(99);
      expect(linked.prUrl).toBe('https://github.com/owner/repo/pull/99');
      expect(linked.prAuthor).toBe('dev');
      expect(linked.metadata.headSha).toBe('newhead');
      expect(linked.source).toBe('agent'); // source is not rewritten
    });

    it('throws UnknownUnitError for an unknown id', () => {
      const store = new UnitStore([], det());
      expect(() => store.linkPr('nope', { prNumber: 1, prUrl: 'u', prAuthor: 'a', headSha: 's' })).toThrow(
        UnknownUnitError,
      );
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

    it('throws for a non-github unit', async () => {
      const store = new UnitStore([], det());
      const { unitId } = await store.add(mkInput({ source: 'agent' }));
      await store.setReviewing(unitId);
      await store.setQueued(unitId, NARRATIVE, 0);
      await store.setDecision(unitId, { kind: 'approved' });
      expect(() => store.resurfaceForNewPush(unitId, 's')).toThrow();
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
});
