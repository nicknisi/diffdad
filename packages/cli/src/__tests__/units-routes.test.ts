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
import type { Decision, ReviewUnit } from '../units/types';
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

type SetupOpts = {
  computeSlice?: ComputeSlice;
  reviewPoster?: (unit: ReviewUnit, decision: Decision) => Promise<void>;
  hydrate?: (unit: ReviewUnit) => Promise<ReviewUnit>;
};

function setup(opts: SetupOpts = {}) {
  const { computeSlice = fakeSlice, reviewPoster, hydrate } = opts;
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
    reviewPoster,
    hydrate,
  });
  return { store, decision, hub, events, submitted, app };
}

function seedGithubUnit(store: UnitStore, over: { number?: number; headSha?: string } = {}) {
  return store.addGithubUnit({
    owner: 'octo',
    repo: 'demo',
    number: over.number ?? 7,
    title: 'Add widgets',
    headBranch: 'feat/widgets',
    headSha: over.headSha ?? 'sha-1',
    author: 'octocat',
    url: 'https://github.com/octo/demo/pull/7',
    metadata: { ...mkMetadata(), headSha: over.headSha ?? 'sha-1' },
  });
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
    const { store, app } = setup({ computeSlice: cleanSlice });
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

  it('uses the channel path (decision.deliver) for a non-github unit, never the review poster', async () => {
    const calls: Array<[ReviewUnit, Decision]> = [];
    const { store, decision, app } = setup({
      reviewPoster: async (unit, d) => {
        calls.push([unit, d]);
      },
    });
    const u = await addUnit(store); // source defaults to 'agent'
    await toQueued(store, u.unitId);

    const parked = decision.wait(u.unitId, 1000);
    const res = await app.request(`/api/units/${u.unitId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'approved', note: 'ship it' }),
    });
    expect(res.status).toBe(200);
    expect(await parked).toMatchObject({ kind: 'approved', note: 'ship it' });
    expect(store.get(u.unitId)!.status).toBe('approved');
    expect(calls).toHaveLength(0); // the review poster is never called for agent/cli units
  });
});

describe('POST /api/units/:id/decision (github dispatch)', () => {
  it('posts the verdict to GitHub, records the decision + reviewed SHA, and broadcasts', async () => {
    const calls: Array<[ReviewUnit, Decision]> = [];
    const { store, decision, events, app } = setup({
      reviewPoster: async (unit, d) => {
        calls.push([unit, d]);
      },
    });
    const gh = seedGithubUnit(store, { headSha: 'sha-1' });

    // A github decision must NOT touch the agent decision channel.
    const parked = decision.wait(gh.unitId, 200);

    const res = await app.request(`/api/units/${gh.unitId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'approved', note: 'lgtm' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; unit: ReviewUnit };
    expect(body.ok).toBe(true);

    // (a) the injected poster was called with the unit + the decision
    expect(calls).toHaveLength(1);
    expect(calls[0]![0].unitId).toBe(gh.unitId);
    expect(calls[0]![1]).toMatchObject({ kind: 'approved', note: 'lgtm' });

    // recorded locally: decision + freshness SHA from metadata.headSha
    const after = store.get(gh.unitId)!;
    expect(after.status).toBe('approved');
    expect(after.decision).toMatchObject({ kind: 'approved', note: 'lgtm' });
    expect(after.lastReviewedSha).toBe('sha-1');

    expect(events).toContain('units');
    expect(await parked).toBeNull(); // the channel was never delivered to
  });

  it('502s and does NOT record the decision when the review poster throws', async () => {
    const { store, app } = setup({
      reviewPoster: async () => {
        throw new Error('github 500');
      },
    });
    const gh = seedGithubUnit(store);

    const res = await app.request(`/api/units/${gh.unitId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'changes_requested', note: 'nope' }),
    });
    expect(res.status).toBe(502);

    // dad and GitHub must not disagree: nothing recorded locally.
    const after = store.get(gh.unitId)!;
    expect(after.status).toBe('queued');
    expect(after.decision).toBeUndefined();
    expect(after.lastReviewedSha).toBeUndefined();
  });

  it('400s a github unit with no PR number', async () => {
    const { store, app } = setup({ reviewPoster: async () => {} });
    // A github unit minted without a prNumber (shouldn't happen via addGithubUnit, but guard anyway).
    const gh = seedGithubUnit(store);
    store.get(gh.unitId)!.prNumber = undefined;

    const res = await app.request(`/api/units/${gh.unitId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'approved' }),
    });
    expect(res.status).toBe(400);
    expect(store.get(gh.unitId)!.decision).toBeUndefined();
  });

  it('503s (and records nothing) on a github decision when GitHub is not configured (no reviewPoster)', async () => {
    const { store, events, app } = setup(); // no reviewPoster wired
    const gh = seedGithubUnit(store, { headSha: 'sha-1' });

    const res = await app.request(`/api/units/${gh.unitId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'approved', note: 'lgtm' }),
    });
    expect(res.status).toBe(503);

    // refuse rather than record a local "approved" that never reaches GitHub
    const after = store.get(gh.unitId)!;
    expect(after.status).toBe('queued');
    expect(after.decision).toBeUndefined();
    expect(after.lastReviewedSha).toBeUndefined();
    expect(events).not.toContain('units');
  });

  it('409s a repeat decision on an already-decided github unit WITHOUT posting a second review', async () => {
    const calls: Array<[ReviewUnit, Decision]> = [];
    const { store, app } = setup({
      reviewPoster: async (unit, d) => {
        calls.push([unit, d]);
      },
    });
    const gh = seedGithubUnit(store, { headSha: 'sha-1' });
    // Drive the unit to a decided state the way a first decision would have.
    (store.get(gh.unitId) as { status: string }).status = 'approved';
    (store.get(gh.unitId) as { decision?: unknown }).decision = { kind: 'approved' };

    const res = await app.request(`/api/units/${gh.unitId}/decision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'approved', note: 'again' }),
    });
    expect(res.status).toBe(409);
    // the divergence we forbid: a second real review must NOT be posted before the local 409
    expect(calls).toHaveLength(0);
  });
});

describe('POST /api/units/:id/hydrate (lazy narrative on open)', () => {
  const post = (app: ReturnType<typeof setup>['app'], id: string) =>
    app.request(`/api/units/${id}/hydrate`, { method: 'POST' });

  it('calls the injected hydrate on a github unit with no narrative, returns the updated unit, broadcasts', async () => {
    const calls: ReviewUnit[] = [];
    let store!: UnitStore;
    const ctx = setup({
      hydrate: async (unit) => {
        calls.push(unit);
        // mimic the real hydrate: attach a narrative without a status transition
        return store.attachReview(unit.unitId, [], NARRATIVE, 0);
      },
    });
    store = ctx.store;
    const gh = seedGithubUnit(store);
    expect(store.get(gh.unitId)!.narrative).toBeUndefined();

    const res = await post(ctx.app, gh.unitId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { unit: ReviewUnit };
    expect(calls).toHaveLength(1);
    expect(calls[0]!.unitId).toBe(gh.unitId);
    expect(body.unit.narrative).toEqual(NARRATIVE);
    expect(body.unit.status).toBe('queued'); // no status transition
    expect(ctx.events).toContain('units');
  });

  it('is a no-op (no hydrate call) on a github unit that already has a narrative', async () => {
    let called = false;
    const { store, app, events } = setup({
      hydrate: async (unit) => {
        called = true;
        return unit;
      },
    });
    const gh = seedGithubUnit(store);
    store.attachReview(gh.unitId, [], NARRATIVE, 1); // already hydrated

    const res = await post(app, gh.unitId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { unit: ReviewUnit };
    expect(called).toBe(false);
    expect(body.unit.unitId).toBe(gh.unitId);
    expect(events).not.toContain('units'); // no broadcast for a no-op
  });

  it('is a no-op (no hydrate call) on a non-github unit', async () => {
    let called = false;
    const { store, app } = setup({
      hydrate: async (unit) => {
        called = true;
        return unit;
      },
    });
    const u = await addUnit(store); // source defaults to 'agent'

    const res = await post(app, u.unitId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { unit: ReviewUnit };
    expect(called).toBe(false);
    expect(body.unit.unitId).toBe(u.unitId);
  });

  it('returns the unit unchanged when no hydrate dep is wired', async () => {
    const { store, app } = setup(); // no hydrate injected
    const gh = seedGithubUnit(store);
    const res = await post(app, gh.unitId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { unit: ReviewUnit };
    expect(body.unit.unitId).toBe(gh.unitId);
    expect(body.unit.narrative).toBeUndefined();
  });

  it('404s for an unknown unit', async () => {
    const { app } = setup({ hydrate: async (unit) => unit });
    const res = await post(app, 'nope');
    expect(res.status).toBe(404);
  });

  it('502s (not 500) and leaves the unit unchanged when hydrate throws', async () => {
    const { store, events, app } = setup({
      hydrate: async () => {
        throw new Error('PR fetch failed');
      },
    });
    const gh = seedGithubUnit(store);

    const res = await post(app, gh.unitId);
    expect(res.status).toBe(502); // a real fetch/LLM failure is a bad-gateway, not an unhandled 500

    const after = store.get(gh.unitId)!;
    expect(after.narrative).toBeUndefined(); // unchanged
    expect(after.status).toBe('queued');
    expect(events).not.toContain('units'); // no broadcast on failure
  });
});

describe('POST /api/units (re-add dedup)', () => {
  const post = (app: ReturnType<typeof setup>['app'], body: unknown) =>
    app.request('/api/units', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('updates the existing local unit in place rather than minting a duplicate', async () => {
    const { store, submitted, app } = setup();
    const r1 = await post(app, { taskLabel: 'v1', repo: 'owner/a', worktreePath: '/wt' });
    const id1 = ((await r1.json()) as { unitId: string }).unitId;
    const r2 = await post(app, { taskLabel: 'v2', repo: 'owner/a', worktreePath: '/wt' });
    const id2 = ((await r2.json()) as { unitId: string }).unitId;

    expect(id2).toBe(id1); // same unit
    expect(store.list()).toHaveLength(1);
    expect(store.get(id1)!.taskLabel).toBe('v2');
    expect(store.get(id1)!.status).toBe('submitted');
    expect(submitted).toHaveLength(2); // worker re-kicked each time
  });

  it('re-adding a failed unit clears its error and re-queues it', async () => {
    const { store, app } = setup();
    const r = await post(app, { taskLabel: 't', repo: 'owner/a', worktreePath: '/wt' });
    const id = ((await r.json()) as { unitId: string }).unitId;
    await store.setReviewing(id);
    await store.setReviewFailed(id, 'Planner returned non-JSON');

    await post(app, { taskLabel: 't', repo: 'owner/a', worktreePath: '/wt' });
    expect(store.get(id)!.error).toBeUndefined();
    expect(store.get(id)!.status).toBe('submitted');
  });
});

describe('POST /api/units/:id/retry', () => {
  it('recomputes the slice, resubmits the unit, and re-kicks the worker', async () => {
    const { store, submitted, events, app } = setup();
    const u = await addUnit(store);
    await store.setReviewing(u.unitId);
    await store.setReviewFailed(u.unitId, 'boom');

    const res = await app.request(`/api/units/${u.unitId}/retry`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(store.get(u.unitId)!.status).toBe('submitted');
    expect(store.get(u.unitId)!.error).toBeUndefined();
    expect(submitted.map((s) => s.unitId)).toContain(u.unitId);
    expect(events).toContain('units');
  });

  it('404s for an unknown unit', async () => {
    const { app } = setup();
    expect((await app.request('/api/units/nope/retry', { method: 'POST' })).status).toBe(404);
  });

  it('400s for a github unit — retry is for local work', async () => {
    const { store, app } = setup();
    const gh = seedGithubUnit(store);
    expect((await app.request(`/api/units/${gh.unitId}/retry`, { method: 'POST' })).status).toBe(400);
  });

  it('returns { ok:false, reason:clean-tree } when the worktree is now clean', async () => {
    const cleanSlice: ComputeSlice = async () => {
      throw new CleanTreeError('main');
    };
    const { store, app } = setup({ computeSlice: cleanSlice });
    const u = await addUnit(store);
    await store.setReviewing(u.unitId);
    await store.setReviewFailed(u.unitId, 'boom');
    const res = await app.request(`/api/units/${u.unitId}/retry`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; reason?: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe('clean-tree');
  });
});

describe('DELETE /api/units/:id', () => {
  it('removes the unit and broadcasts', async () => {
    const { store, events, app } = setup();
    const u = await addUnit(store);
    const res = await app.request(`/api/units/${u.unitId}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(store.get(u.unitId)).toBeUndefined();
    expect(events).toContain('units');
  });

  it('404s for an unknown unit', async () => {
    const { app } = setup();
    expect((await app.request('/api/units/nope', { method: 'DELETE' })).status).toBe(404);
  });
});
