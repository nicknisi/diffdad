import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UnitStore } from '../units/store';
import { DecisionChannel } from '../units/decision-channel';
import { createDaemonApp, SseHub } from '../daemon/app';
import type { ComputeSlice } from '../mcp/submit';
import { CleanTreeError, type LocalReview } from '../local/diff-source';
import type { PRMetadata } from '../github/types';
import type { ReviewUnit } from '../units/types';
import type { NarrativeResponse } from '../narrative/types';

const NARRATIVE: NarrativeResponse = {
  title: 't',
  tldr: 'td',
  verdict: 'risky',
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

const fakeSlice: ComputeSlice = async (): Promise<LocalReview> => ({
  files: [],
  metadata: mkMetadata(),
  contentKey: 'abc',
  baseRef: 'main',
});

function deterministic() {
  let id = 0;
  return { genId: () => `unit-${++id}`, now: () => '2026-06-26T00:00:00.000Z' };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'diffdad-units-routes-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function setup(computeSlice: ComputeSlice = fakeSlice) {
  const store = new UnitStore([], { dir, ...deterministic() });
  const decision = new DecisionChannel();
  const hub = new SseHub();
  const events: string[] = [];
  hub.add((event) => events.push(event));
  const submitted: ReviewUnit[] = [];
  const { app } = createDaemonApp({
    store,
    decision,
    hub,
    computeSlice,
    onSubmitted: (unit) => submitted.push(unit),
  });
  return { store, decision, hub, events, submitted, app };
}

async function addUnit(store: UnitStore, repo = 'owner/a') {
  return store.add({
    repo,
    worktreePath: '/wt',
    taskLabel: 't',
    intent: 'x',
    baseRef: 'main',
    diffContentKey: 'k',
    files: [],
    metadata: mkMetadata(),
  });
}

async function toQueued(store: UnitStore, id: string) {
  await store.setReviewing(id);
  await store.setQueued(id, NARRATIVE, 2);
}

describe('GET /api/narrative (command-center bootstrap)', () => {
  it('declares command-center mode and seeds the current queue', async () => {
    const { store, app } = setup();
    await addUnit(store, 'owner/a');
    await addUnit(store, 'owner/b');
    const res = await app.request('/api/narrative');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string; units: { repo: string }[] };
    expect(body.mode).toBe('command-center');
    expect(body.units.map((u) => u.repo).sort()).toEqual(['owner/a', 'owner/b']);
  });
});

describe('POST /api/units (dad add ingest)', () => {
  const post = (app: ReturnType<typeof setup>['app'], body: unknown) =>
    app.request('/api/units', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('creates a source:cli unit from the computed slice and broadcasts + onSubmitted', async () => {
    const { store, events, submitted, app } = setup();
    const res = await post(app, {
      taskLabel: 'fix the thing',
      intent: 'because',
      repo: 'owner/a',
      worktreePath: '/wt',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { unitId: string };
    expect(body.unitId).toBe('unit-1');

    const unit = store.get(body.unitId)!;
    expect(unit.source).toBe('cli');
    expect(unit.status).toBe('submitted');
    expect(unit.taskLabel).toBe('fix the thing');
    expect(unit.intent).toBe('because');
    expect(events).toContain('units');
    expect(submitted.map((u) => u.unitId)).toEqual(['unit-1']);
  });

  it('defaults intent to empty string when omitted', async () => {
    const { store, app } = setup();
    const res = await post(app, { taskLabel: 't', repo: 'owner/a', worktreePath: '/wt' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { unitId: string };
    expect(store.get(body.unitId)!.intent).toBe('');
  });

  it('400s when a required field is missing', async () => {
    const { app } = setup();
    expect((await post(app, { intent: 'x', repo: 'owner/a', worktreePath: '/wt' })).status).toBe(400); // no taskLabel
    expect((await post(app, { taskLabel: 't', worktreePath: '/wt' })).status).toBe(400); // no repo
    expect((await post(app, { taskLabel: 't', repo: 'owner/a' })).status).toBe(400); // no worktreePath
  });

  it('returns { ok: false, reason: clean-tree } (200) when the tree is clean', async () => {
    const cleanSlice: ComputeSlice = async () => {
      throw new CleanTreeError('main');
    };
    const { store, app } = setup(cleanSlice);
    const res = await post(app, { taskLabel: 't', repo: 'owner/a', worktreePath: '/wt' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; reason?: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('clean-tree');
    expect(store.list()).toHaveLength(0);
  });
});

describe('GET /api/units', () => {
  it('lists all units', async () => {
    const { store, app } = setup();
    await addUnit(store);
    await addUnit(store);
    const res = await app.request('/api/units');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { units: { unitId: string }[] };
    expect(body.units.map((u) => u.unitId)).toEqual(['unit-1', 'unit-2']);
  });

  it('filters by status and repo', async () => {
    const { store, app } = setup();
    await addUnit(store, 'owner/a'); // unit-1, submitted
    const u2 = await addUnit(store, 'owner/b'); // unit-2
    await toQueued(store, u2.unitId);

    const byStatus = (await (await app.request('/api/units?status=queued')).json()) as { units: { unitId: string }[] };
    expect(byStatus.units.map((u) => u.unitId)).toEqual(['unit-2']);

    const byRepo = (await (await app.request('/api/units?repo=owner/a')).json()) as { units: { unitId: string }[] };
    expect(byRepo.units.map((u) => u.unitId)).toEqual(['unit-1']);
  });
});

describe('GET /api/units/:id', () => {
  it('returns one unit with its narrative', async () => {
    const { store, app } = setup();
    const u = await addUnit(store);
    await toQueued(store, u.unitId);
    const res = await app.request(`/api/units/${u.unitId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { unit: { unitId: string; narrative: { verdict: string } } };
    expect(body.unit.unitId).toBe('unit-1');
    expect(body.unit.narrative.verdict).toBe('risky');
  });

  it('404s for an unknown unit', async () => {
    const { app } = setup();
    const res = await app.request('/api/units/nope');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/units/:id/decision', () => {
  it('records the decision, delivers it to a parked agent, and broadcasts', async () => {
    const { store, decision, events, app } = setup();
    const u = await addUnit(store);
    await toQueued(store, u.unitId);

    const parked = decision.wait(u.unitId, 1000);
    const res = await app.request(`/api/units/${u.unitId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'approved', note: 'ship it' }),
    });
    expect(res.status).toBe(200);
    expect(store.get(u.unitId)!.status).toBe('approved');
    expect(store.get(u.unitId)!.decision).toMatchObject({ kind: 'approved', note: 'ship it' });
    expect(await parked).toMatchObject({ kind: 'approved', note: 'ship it' });
    expect(events).toContain('units');
  });

  it('404s for an unknown unit', async () => {
    const { app } = setup();
    const res = await app.request('/api/units/nope/decision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'approved' }),
    });
    expect(res.status).toBe(404);
  });

  it('400s for an invalid decision kind', async () => {
    const { store, app } = setup();
    const u = await addUnit(store);
    await toQueued(store, u.unitId);
    const res = await app.request(`/api/units/${u.unitId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'merge_it' }),
    });
    expect(res.status).toBe(400);
  });

  it('409s when deciding a unit that is not awaiting a decision', async () => {
    const { store, app } = setup();
    const u = await addUnit(store); // still 'submitted' — not yet 'queued'
    const res = await app.request(`/api/units/${u.unitId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'approved' }),
    });
    expect(res.status).toBe(409);
  });
});
