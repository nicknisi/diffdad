import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UnitStore } from '../../units/store';
import { ReviewWorkerPool, type ReviewResult } from '../pool';
import type { PRMetadata } from '../../github/types';
import type { NarrativeResponse } from '../../narrative/types';
import type { ReviewUnit } from '../../units/types';

const NARRATIVE: NarrativeResponse = {
  title: 't',
  tldr: 'td',
  verdict: 'safe',
  readingPlan: [],
  concerns: [],
  chapters: [],
};

function mkMetadata(): PRMetadata {
  return {
    number: 0,
    title: 'feat/x',
    body: '',
    state: 'open',
    draft: false,
    author: { login: 'local', avatarUrl: '' },
    branch: 'feat/x',
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

function deterministic() {
  let id = 0;
  return { genId: () => `unit-${++id}`, now: () => '2026-06-26T00:00:00.000Z' };
}

// Let queued microtasks + the store's async fs writes settle before asserting.
const settle = () => new Promise((r) => setTimeout(r, 25));

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'diffdad-pool-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function seed(store: UnitStore, n: number) {
  for (let i = 0; i < n; i++) {
    await store.add({
      repo: 'owner/a',
      worktreePath: `/wt/${i}`,
      taskLabel: `t${i}`,
      intent: 'x',
      baseRef: 'main',
      diffContentKey: `k${i}`,
      files: [],
      metadata: mkMetadata(),
    });
  }
}

describe('ReviewWorkerPool', () => {
  it('runs at most `concurrency` reviews at once and frees slots as they finish', async () => {
    const store = new UnitStore([], { dir, ...deterministic() });
    await seed(store, 4);

    const gate = new Map<string, Deferred<ReviewResult>>();
    const pool = new ReviewWorkerPool({
      store,
      broadcast: () => {},
      concurrency: 2,
      review: (unit: ReviewUnit) => {
        const d = deferred<ReviewResult>();
        gate.set(unit.unitId, d);
        return d.promise;
      },
    });

    pool.kick();
    await settle();

    // Only 2 of 4 are under review; the rest wait their turn.
    expect(pool.active).toBe(2);
    const byStatus = () => Object.fromEntries(store.list().map((u) => [u.unitId, u.status]));
    expect(byStatus()).toMatchObject({
      'unit-1': 'reviewing',
      'unit-2': 'reviewing',
      'unit-3': 'submitted',
      'unit-4': 'submitted',
    });

    // Finish one → a waiting unit takes the freed slot.
    gate.get('unit-1')!.resolve({ narrative: NARRATIVE, toResolve: 3 });
    await settle();
    expect(pool.active).toBe(2);
    expect(store.get('unit-1')!.status).toBe('queued');
    expect(store.get('unit-1')!.toResolve).toBe(3);
    expect(store.get('unit-3')!.status).toBe('reviewing');
  });

  it('queues a unit with an error when its review throws (still reaches the reviewer)', async () => {
    const store = new UnitStore([], { dir, ...deterministic() });
    await seed(store, 1);
    const pool = new ReviewWorkerPool({
      store,
      broadcast: () => {},
      concurrency: 2,
      review: async () => {
        throw new Error('boom');
      },
    });

    pool.kick();
    await settle();

    const unit = store.get('unit-1')!;
    expect(unit.status).toBe('queued');
    expect(unit.error).toBe('boom');
    expect(unit.toResolve).toBe(0);
    expect(pool.active).toBe(0);
  });

  it('re-queues a unit left in `reviewing` by a previous run (crash recovery)', async () => {
    // Simulate a crash: a unit persisted mid-review. A fresh store loads it as `reviewing`.
    const crashed: ReviewUnit = {
      unitId: 'unit-1',
      repo: 'owner/a',
      source: 'agent',
      worktreePath: '/wt',
      taskLabel: 't',
      intent: 'x',
      uncertainties: [],
      baseRef: 'main',
      diffContentKey: 'k',
      status: 'reviewing',
      toResolve: 0,
      files: [],
      metadata: mkMetadata(),
      createdAt: 'now',
      updatedAt: 'now',
    };
    const store = new UnitStore([crashed], { dir, ...deterministic() });
    const pool = new ReviewWorkerPool({
      store,
      broadcast: () => {},
      concurrency: 2,
      review: async () => ({ narrative: NARRATIVE, toResolve: 1 }),
    });

    pool.kick();
    await settle();

    expect(store.get('unit-1')!.status).toBe('queued');
    expect(store.get('unit-1')!.toResolve).toBe(1);
  });

  it('broadcasts a units snapshot as work progresses', async () => {
    const store = new UnitStore([], { dir, ...deterministic() });
    await seed(store, 1);
    const events: string[] = [];
    const pool = new ReviewWorkerPool({
      store,
      broadcast: (event) => events.push(event),
      concurrency: 1,
      review: async () => ({ narrative: NARRATIVE, toResolve: 0 }),
    });

    pool.kick();
    await settle();

    expect(events).toContain('units');
  });
});
