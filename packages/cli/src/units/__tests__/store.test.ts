import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { UnitStore } from '../store';
import { IllegalTransitionError, UnknownUnitError } from '../types';
import type { NewReviewUnit } from '../types';
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
});
