import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UnitStore } from '../units/store';
import { DecisionChannel } from '../units/decision-channel';
import { createDaemonApp, SseHub } from '../daemon/app';
import type { ComputeSlice } from '../mcp/submit';
import { CleanTreeError, type LocalReview } from '../local/diff-source';
import type { CheckRun, PRComment, PRMetadata, PRReview } from '../github/types';
import type { PostCommentOptions } from '../github/client';
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

type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
type SubmitInlineComment = { path: string; line: number; body: string; side?: 'LEFT' | 'RIGHT' };

type SetupOpts = {
  computeSlice?: ComputeSlice;
  reviewPoster?: (unit: ReviewUnit, decision: Decision) => Promise<void>;
  hydrate?: (unit: ReviewUnit) => Promise<ReviewUnit>;
  commentFetcher?: (unit: ReviewUnit) => Promise<PRComment[]>;
  commentPoster?: (unit: ReviewUnit, body: string, opts: PostCommentOptions) => Promise<PRComment>;
  reviewSubmitter?: (
    unit: ReviewUnit,
    event: ReviewEvent,
    body: string | undefined,
    comments: SubmitInlineComment[],
  ) => Promise<void>;
  ai?: (system: string, user: string) => Promise<{ text: string }>;
  statusFetcher?: (unit: ReviewUnit) => Promise<{ checks: CheckRun[]; reviews: PRReview[] }>;
};

function setup(opts: SetupOpts = {}) {
  const { computeSlice = fakeSlice, reviewPoster, hydrate, commentFetcher, commentPoster, reviewSubmitter, ai } = opts;
  const { statusFetcher } = opts;
  const store = new UnitStore([], { dir, ...deterministic() });
  const decision = new DecisionChannel();
  const hub = new SseHub();
  const events: string[] = [];
  const messages: Array<{ event: string; data: unknown }> = [];
  hub.add((event, data) => {
    events.push(event);
    messages.push({ event, data });
  });
  const submitted: ReviewUnit[] = [];
  const { app } = createDaemonApp({
    store,
    decision,
    hub,
    computeSlice,
    onSubmitted: (unit) => submitted.push(unit),
    reviewPoster,
    hydrate,
    commentFetcher,
    commentPoster,
    reviewSubmitter,
    ai,
    statusFetcher,
  });
  return { store, decision, hub, events, messages, submitted, app };
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
    app.request('/api/units', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

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

/** A narrative whose only chapter references `file` via a diff section — so an inline comment on
 * that path maps to chapter 0 (mirrors PR mode's `mapCommentsToChapters`). */
function narrativeWithFile(file: string): NarrativeResponse {
  return {
    ...NARRATIVE,
    chapters: [{ title: 'c', sections: [{ type: 'diff', file, hunkIndex: 0 }] }] as NarrativeResponse['chapters'],
  };
}

function mkComment(over: Partial<PRComment> = {}): PRComment {
  return {
    id: over.id ?? 1,
    author: over.author ?? 'octocat',
    body: over.body ?? 'a comment',
    createdAt: over.createdAt ?? 'now',
    updatedAt: over.updatedAt ?? 'now',
    ...over,
  };
}

describe('GET /api/units/:id/comments', () => {
  it('fetches a github unit’s comments and maps them to its narrative chapters', async () => {
    const fetched: ReviewUnit[] = [];
    const { store, app } = setup({
      commentFetcher: async (unit) => {
        fetched.push(unit);
        return [mkComment({ id: 9, path: 'src/a.ts', line: 3 })];
      },
    });
    const gh = seedGithubUnit(store);
    store.attachReview(gh.unitId, [], narrativeWithFile('src/a.ts'), 0);

    const res = await app.request(`/api/units/${gh.unitId}/comments`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<PRComment & { chapterIndices: number[] }>;
    expect(fetched).toHaveLength(1);
    expect(fetched[0]!.unitId).toBe(gh.unitId);
    expect(body).toHaveLength(1);
    expect(body[0]!.id).toBe(9);
    expect(body[0]!.chapterIndices).toEqual([0]); // inline comment on src/a.ts → chapter 0
  });

  it('returns the raw comments unmapped when the github unit has no narrative yet', async () => {
    const { store, app } = setup({
      commentFetcher: async () => [mkComment({ id: 5, path: 'x.ts', line: 1 })],
    });
    const gh = seedGithubUnit(store); // not hydrated — no narrative
    const res = await app.request(`/api/units/${gh.unitId}/comments`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PRComment[];
    expect(body.map((c) => c.id)).toEqual([5]);
  });

  it('returns [] for a non-github unit without calling the fetcher', async () => {
    let called = false;
    const { store, app } = setup({
      commentFetcher: async () => {
        called = true;
        return [mkComment()];
      },
    });
    const u = await addUnit(store); // source defaults to 'agent'
    const res = await app.request(`/api/units/${u.unitId}/comments`);
    expect(res.status).toBe(200);
    expect((await res.json()) as PRComment[]).toEqual([]);
    expect(called).toBe(false);
  });

  it('returns [] for a github unit when no fetcher is wired', async () => {
    const { store, app } = setup(); // no commentFetcher
    const gh = seedGithubUnit(store);
    const res = await app.request(`/api/units/${gh.unitId}/comments`);
    expect(res.status).toBe(200);
    expect((await res.json()) as PRComment[]).toEqual([]);
  });

  it('404s for an unknown unit', async () => {
    const { app } = setup({ commentFetcher: async () => [] });
    expect((await app.request('/api/units/nope/comments')).status).toBe(404);
  });
});

describe('POST /api/units/:id/comments', () => {
  const post = (app: ReturnType<typeof setup>['app'], id: string, body: unknown) =>
    app.request(`/api/units/${id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('posts an inline comment to GitHub (commitId defaulting to the head SHA) and broadcasts unit-scoped', async () => {
    const calls: Array<[ReviewUnit, string, PostCommentOptions]> = [];
    const { store, messages, app } = setup({
      commentPoster: async (unit, body, opts) => {
        calls.push([unit, body, opts]);
        return mkComment({ id: 42, body, path: opts.path, line: opts.line });
      },
    });
    const gh = seedGithubUnit(store, { headSha: 'sha-1' });

    const res = await post(app, gh.unitId, { body: 'nit: rename this', path: 'src/a.ts', line: 3, side: 'RIGHT' });
    expect(res.status).toBe(201);
    const created = (await res.json()) as PRComment;
    expect(created.id).toBe(42);

    expect(calls).toHaveLength(1);
    expect(calls[0]![0].unitId).toBe(gh.unitId);
    expect(calls[0]![1]).toBe('nit: rename this');
    expect(calls[0]![2]).toMatchObject({ path: 'src/a.ts', line: 3, side: 'RIGHT', commitId: 'sha-1' });
    // Scoped to the unit so it can't leak into another open unit's thread (see useLiveStream).
    const broadcast = messages.find((m) => m.event === 'unit-comment');
    expect(broadcast?.data).toMatchObject({ unitId: gh.unitId, comment: { id: 42 } });
  });

  it('honors an explicit commitId over the unit head SHA', async () => {
    const calls: PostCommentOptions[] = [];
    const { store, app } = setup({
      commentPoster: async (_u, _b, opts) => {
        calls.push(opts);
        return mkComment();
      },
    });
    const gh = seedGithubUnit(store, { headSha: 'sha-1' });
    await post(app, gh.unitId, { body: 'x', path: 'a.ts', line: 1, commitId: 'sha-override' });
    expect(calls[0]!.commitId).toBe('sha-override');
  });

  it('400s a non-github unit (no PR to comment on)', async () => {
    let called = false;
    const { store, app } = setup({
      commentPoster: async () => {
        called = true;
        return mkComment();
      },
    });
    const u = await addUnit(store);
    expect((await post(app, u.unitId, { body: 'hi' })).status).toBe(400);
    expect(called).toBe(false);
  });

  it('503s a github unit when GitHub is not configured (no poster)', async () => {
    const { store, app } = setup(); // no commentPoster
    const gh = seedGithubUnit(store);
    expect((await post(app, gh.unitId, { body: 'hi' })).status).toBe(503);
  });

  it('400s when the body is missing or empty', async () => {
    let called = false;
    const { store, app } = setup({
      commentPoster: async () => {
        called = true;
        return mkComment();
      },
    });
    const gh = seedGithubUnit(store);
    expect((await post(app, gh.unitId, { path: 'a.ts', line: 1 })).status).toBe(400);
    expect((await post(app, gh.unitId, { body: '   ' })).status).toBe(400);
    expect(called).toBe(false);
  });

  it('502s when the poster throws (GitHub rejected the comment)', async () => {
    const { store, app } = setup({
      commentPoster: async () => {
        throw new Error('github 422');
      },
    });
    const gh = seedGithubUnit(store);
    expect((await post(app, gh.unitId, { body: 'hi' })).status).toBe(502);
  });

  it('404s for an unknown unit', async () => {
    const { app } = setup({ commentPoster: async () => mkComment() });
    expect((await post(app, 'nope', { body: 'hi' })).status).toBe(404);
  });
});

describe('POST /api/units/:id/review (submit a GitHub review)', () => {
  type Call = [ReviewUnit, ReviewEvent, string | undefined, SubmitInlineComment[]];
  const post = (app: ReturnType<typeof setup>['app'], id: string, body: unknown) =>
    app.request(`/api/units/${id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const recorder = () => {
    const calls: Call[] = [];
    return { calls, fn: async (...c: Call) => void calls.push(c) };
  };

  it('approves: posts APPROVE + batched comments to GitHub, records the verdict + SHA, broadcasts', async () => {
    const rec = recorder();
    const { store, events, app } = setup({ reviewSubmitter: rec.fn });
    const gh = seedGithubUnit(store, { headSha: 'sha-1' });

    const res = await post(app, gh.unitId, {
      event: 'approve',
      body: 'lgtm',
      comments: [{ path: 'src/a.ts', line: 3, body: 'nit' }],
    });
    expect(res.status).toBe(200);

    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]![1]).toBe('APPROVE');
    expect(rec.calls[0]![2]).toBe('lgtm');
    expect(rec.calls[0]![3]).toEqual([{ path: 'src/a.ts', line: 3, body: 'nit' }]);

    const after = store.get(gh.unitId)!;
    expect(after.status).toBe('approved');
    expect(after.decision).toMatchObject({ kind: 'approved' });
    expect(after.lastReviewedSha).toBe('sha-1');
    expect(events).toContain('units');
    expect(events).toContain('review');
  });

  it('requests changes: records changes_requested and the reviewed SHA', async () => {
    const rec = recorder();
    const { store, app } = setup({ reviewSubmitter: rec.fn });
    const gh = seedGithubUnit(store, { headSha: 'sha-1' });
    const res = await post(app, gh.unitId, { event: 'request_changes', body: 'please fix' });
    expect(res.status).toBe(200);
    expect(rec.calls[0]![1]).toBe('REQUEST_CHANGES');
    expect(store.get(gh.unitId)!.status).toBe('changes_requested');
    expect(store.get(gh.unitId)!.lastReviewedSha).toBe('sha-1');
  });

  it('comments: posts a COMMENT review WITHOUT changing the verdict (stays queued)', async () => {
    const rec = recorder();
    const { store, events, app } = setup({ reviewSubmitter: rec.fn });
    const gh = seedGithubUnit(store, { headSha: 'sha-1' });
    const res = await post(app, gh.unitId, { event: 'comment', body: 'some thoughts' });
    expect(res.status).toBe(200);
    expect(rec.calls[0]![1]).toBe('COMMENT');
    const after = store.get(gh.unitId)!;
    expect(after.status).toBe('queued'); // no verdict
    expect(after.decision).toBeUndefined();
    expect(events).toContain('review');
    expect(events).not.toContain('units'); // nothing changed locally
  });

  it('drops malformed inline comments before submitting', async () => {
    const rec = recorder();
    const { store, app } = setup({ reviewSubmitter: rec.fn });
    const gh = seedGithubUnit(store);
    await post(app, gh.unitId, {
      event: 'comment',
      comments: [
        { path: 'a.ts', line: 1, body: 'ok' },
        { path: 'b.ts', body: 'no line' }, // dropped
        { line: 2, body: 'no path' }, // dropped
      ],
    });
    expect(rec.calls[0]![3]).toEqual([{ path: 'a.ts', line: 1, body: 'ok' }]);
  });

  it('400s an invalid event', async () => {
    const rec = recorder();
    const { store, app } = setup({ reviewSubmitter: rec.fn });
    const gh = seedGithubUnit(store);
    expect((await post(app, gh.unitId, { event: 'merge' })).status).toBe(400);
    expect(rec.calls).toHaveLength(0);
  });

  it('400s a non-github unit', async () => {
    const rec = recorder();
    const { store, app } = setup({ reviewSubmitter: rec.fn });
    const u = await addUnit(store);
    expect((await post(app, u.unitId, { event: 'approve' })).status).toBe(400);
    expect(rec.calls).toHaveLength(0);
  });

  it('503s when no review submitter is wired', async () => {
    const { store, app } = setup();
    const gh = seedGithubUnit(store);
    expect((await post(app, gh.unitId, { event: 'approve' })).status).toBe(503);
  });

  it('502s and records nothing when the submitter throws', async () => {
    const { store, app } = setup({
      reviewSubmitter: async () => {
        throw new Error('github 422');
      },
    });
    const gh = seedGithubUnit(store, { headSha: 'sha-1' });
    expect((await post(app, gh.unitId, { event: 'approve', body: 'x' })).status).toBe(502);
    const after = store.get(gh.unitId)!;
    expect(after.status).toBe('queued'); // divergence guard: nothing recorded
    expect(after.decision).toBeUndefined();
    expect(after.lastReviewedSha).toBeUndefined();
  });

  it('409s an approve/request_changes when the unit is not awaiting a verdict (without posting)', async () => {
    const rec = recorder();
    const { store, app } = setup({ reviewSubmitter: rec.fn });
    const gh = seedGithubUnit(store, { headSha: 'sha-1' });
    (store.get(gh.unitId) as { status: string }).status = 'approved'; // already decided
    expect((await post(app, gh.unitId, { event: 'approve' })).status).toBe(409);
    expect(rec.calls).toHaveLength(0); // never posted a second review
  });

  it('404s for an unknown unit', async () => {
    const { app } = setup({ reviewSubmitter: async () => {} });
    expect((await post(app, 'nope', { event: 'approve' })).status).toBe(404);
  });
});

describe('POST /api/units/:id/ai (review-summary draft)', () => {
  const post = (app: ReturnType<typeof setup>['app'], id: string, body: unknown) =>
    app.request(`/api/units/${id}/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('summarizes: calls the AI with prompts built from the unit narrative, returns the text', async () => {
    const calls: Array<[string, string]> = [];
    const { store, app } = setup({
      ai: async (system, user) => {
        calls.push([system, user]);
        return { text: '  I reviewed this and it looks solid.  ' };
      },
    });
    const gh = seedGithubUnit(store);
    store.attachReview(gh.unitId, [], { ...NARRATIVE, tldr: 'adds widgets' }, 0);

    const res = await post(app, gh.unitId, { action: 'summarize', resolution: 'approve' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text: string };
    expect(body.text).toBe('I reviewed this and it looks solid.'); // trimmed
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toContain('approving'); // approve stance is in the system prompt
    expect(calls[0]![1]).toContain('adds widgets'); // the narrative tldr feeds the user prompt
  });

  it('503s when the unit has no narrative yet', async () => {
    const { store, app } = setup({ ai: async () => ({ text: 'x' }) });
    const gh = seedGithubUnit(store); // not hydrated
    expect((await post(app, gh.unitId, { action: 'summarize' })).status).toBe(503);
  });

  it('503s when no AI is configured', async () => {
    const { store, app } = setup(); // no ai dep
    const gh = seedGithubUnit(store);
    store.attachReview(gh.unitId, [], NARRATIVE, 0);
    expect((await post(app, gh.unitId, { action: 'summarize' })).status).toBe(503);
  });

  it('400s an unknown action', async () => {
    const { store, app } = setup({ ai: async () => ({ text: 'x' }) });
    const gh = seedGithubUnit(store);
    store.attachReview(gh.unitId, [], NARRATIVE, 0);
    expect((await post(app, gh.unitId, { action: 'frobnicate' })).status).toBe(400);
  });

  it('asks: answers a question about a chapter using its diff', async () => {
    const calls: Array<[string, string]> = [];
    const { store, app } = setup({
      ai: async (system, user) => {
        calls.push([system, user]);
        return { text: 'Because the API changed.' };
      },
    });
    const gh = seedGithubUnit(store);
    store.attachReview(gh.unitId, [], narrativeWithFile('src/a.ts'), 0);

    const res = await post(app, gh.unitId, { action: 'ask', chapterIndex: 0, question: 'why this change?' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { text: string }).text).toBe('Because the API changed.');
    expect(calls[0]![1]).toContain('why this change?'); // the question is in the user prompt
  });

  it('400s an ask with no question', async () => {
    const { store, app } = setup({ ai: async () => ({ text: 'x' }) });
    const gh = seedGithubUnit(store);
    store.attachReview(gh.unitId, [], narrativeWithFile('src/a.ts'), 0);
    expect((await post(app, gh.unitId, { action: 'ask', chapterIndex: 0 })).status).toBe(400);
  });

  it('400s an ask for a chapter that does not exist', async () => {
    const { store, app } = setup({ ai: async () => ({ text: 'x' }) });
    const gh = seedGithubUnit(store);
    store.attachReview(gh.unitId, [], NARRATIVE, 0); // no chapters
    expect((await post(app, gh.unitId, { action: 'ask', chapterIndex: 5, question: 'q' })).status).toBe(400);
  });

  it('404s for an unknown unit', async () => {
    const { app } = setup({ ai: async () => ({ text: 'x' }) });
    expect((await post(app, 'nope', { action: 'summarize' })).status).toBe(404);
  });
});

describe('GET /api/units/:id/status (checks + reviews)', () => {
  const mkCheck = (over: Partial<CheckRun> = {}): CheckRun => ({
    id: over.id ?? 1,
    name: over.name ?? 'ci',
    status: over.status ?? 'completed',
    conclusion: over.conclusion ?? 'success',
    startedAt: null,
    completedAt: null,
    detailsUrl: null,
    output: {},
  });
  const mkReview = (over: Partial<PRReview> = {}): PRReview => ({
    id: over.id ?? 1,
    user: over.user ?? 'octocat',
    avatarUrl: '',
    state: over.state ?? 'APPROVED',
    submittedAt: 'now',
  });

  it('returns a github unit’s checks + reviews from the fetcher', async () => {
    const seen: ReviewUnit[] = [];
    const { store, app } = setup({
      statusFetcher: async (unit) => {
        seen.push(unit);
        return { checks: [mkCheck({ conclusion: 'failure' })], reviews: [mkReview()] };
      },
    });
    const gh = seedGithubUnit(store);
    const res = await app.request(`/api/units/${gh.unitId}/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { checks: CheckRun[]; reviews: PRReview[] };
    expect(seen[0]!.unitId).toBe(gh.unitId);
    expect(body.checks[0]!.conclusion).toBe('failure');
    expect(body.reviews[0]!.state).toBe('APPROVED');
  });

  it('returns empty for a non-github unit without calling the fetcher', async () => {
    let called = false;
    const { store, app } = setup({
      statusFetcher: async () => {
        called = true;
        return { checks: [mkCheck()], reviews: [] };
      },
    });
    const u = await addUnit(store);
    const res = await app.request(`/api/units/${u.unitId}/status`);
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toEqual({ checks: [], reviews: [] });
    expect(called).toBe(false);
  });

  it('returns empty when no fetcher is wired', async () => {
    const { store, app } = setup();
    const gh = seedGithubUnit(store);
    const res = await app.request(`/api/units/${gh.unitId}/status`);
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toEqual({ checks: [], reviews: [] });
  });

  it('404s for an unknown unit', async () => {
    const { app } = setup({ statusFetcher: async () => ({ checks: [], reviews: [] }) });
    expect((await app.request('/api/units/nope/status')).status).toBe(404);
  });
});
