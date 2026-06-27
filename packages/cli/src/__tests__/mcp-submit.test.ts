import { mkdtemp, readdir, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentCommentStore } from '../agent-comments/store';
import { dataDir } from '../paths';
import { UnitStore } from '../units/store';
import { DecisionChannel } from '../units/decision-channel';
import { type ComputeSlice, registerSubmitTools } from '../mcp/submit';
import { mountMcp } from '../mcp/server';
import { CleanTreeError, type LocalReview } from '../local/diff-source';
import type { PRMetadata } from '../github/types';
import type { NarrativeResponse } from '../narrative/types';
import type { ReviewUnit } from '../units/types';

const HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };

function deterministic() {
  let id = 0;
  return { genId: () => `unit-${++id}`, now: () => '2026-06-26T00:00:00.000Z' };
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

function fakeReview(over: Partial<LocalReview> = {}): LocalReview {
  return { files: [], metadata: mkMetadata(), contentKey: 'abc123', baseRef: 'main', ...over };
}

const NARRATIVE: NarrativeResponse = {
  title: 't',
  tldr: 'td',
  verdict: 'risky',
  readingPlan: [],
  concerns: [],
  chapters: [],
};

async function rpc(app: Hono, body: unknown, sessionId?: string) {
  const headers: Record<string, string> = { ...HEADERS };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  return app.request('/mcp', { method: 'POST', headers, body: JSON.stringify(body) });
}

async function connect(app: Hono): Promise<string> {
  const init = await rpc(app, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } },
  });
  const sessionId = init.headers.get('mcp-session-id')!;
  await rpc(app, { jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId);
  return sessionId;
}

let callId = 100;
async function callTool(app: Hono, sessionId: string, name: string, args: Record<string, unknown>) {
  const res = await rpc(
    app,
    { jsonrpc: '2.0', id: ++callId, method: 'tools/call', params: { name, arguments: args } },
    sessionId,
  );
  const json = (await res.json()) as { result?: { content?: { text?: string }[]; isError?: boolean } };
  const raw = json.result?.content?.[0]?.text ?? '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = raw;
  }
  return { parsed, isError: json.result?.isError ?? false };
}

const COMMENT_DIR = join(dataDir(), 'agent-comments');
async function cleanCommentFixture() {
  try {
    for (const e of await readdir(COMMENT_DIR)) {
      if (e.startsWith('__diffdad_test__submit')) await rm(join(COMMENT_DIR, e), { force: true });
    }
  } catch {
    /* dir may not exist */
  }
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'diffdad-mcp-submit-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await cleanCommentFixture();
});

function setup(computeSlice: ComputeSlice = async () => fakeReview(), opts: { withComments?: boolean } = {}) {
  const store = new UnitStore([], { dir, ...deterministic() });
  const decision = new DecisionChannel();
  const events: { event: string; data: unknown }[] = [];
  const submitted: ReviewUnit[] = [];
  // Per-unit comment stores, mirroring the daemon's getCommentStore (undefined for unknown units).
  const commentStores = new Map<string, AgentCommentStore>();
  let cid = 0;
  const getCommentStore = opts.withComments
    ? async (unitId: string): Promise<AgentCommentStore | undefined> => {
        if (!store.get(unitId)) return undefined;
        let cs = commentStores.get(unitId);
        if (!cs) {
          cs = new AgentCommentStore(`__diffdad_test__submit-${unitId}`, [], {
            genId: () => `c-${++cid}`,
            now: () => '2026-06-26T00:00:00.000Z',
          });
          commentStores.set(unitId, cs);
        }
        return cs;
      }
    : undefined;
  const app = new Hono();
  mountMcp(app, (server) =>
    registerSubmitTools(server, {
      store,
      decision,
      broadcast: (event, data) => events.push({ event, data }),
      computeSlice,
      onSubmitted: (u) => submitted.push(u),
      awaitTimeoutMs: 40,
      getCommentStore,
    }),
  );
  return { store, decision, events, submitted, app, getCommentStore };
}

async function submitUnit(app: Hono, sid: string): Promise<string> {
  const { parsed } = await callTool(app, sid, 'submit_for_review', {
    taskLabel: 't',
    intent: 'x',
    repo: 'owner/a',
    worktreePath: '/wt',
  });
  return (parsed as { unitId: string }).unitId;
}

describe('MCP submit/decision tools', () => {
  it('submit_for_review enqueues a unit and returns its id', async () => {
    const { store, events, submitted, app } = setup();
    const sid = await connect(app);
    const { parsed } = await callTool(app, sid, 'submit_for_review', {
      taskLabel: 'add recency check',
      intent: 'enforce recent auth',
      repo: 'owner/a',
      worktreePath: '/wt',
    });
    const unitId = (parsed as { unitId: string }).unitId;
    expect(unitId).toBe('unit-1');
    expect(store.list().map((u) => u.unitId)).toEqual(['unit-1']);
    expect(store.get(unitId)!.status).toBe('submitted');
    expect(store.get(unitId)!.diffContentKey).toBe('abc123');
    expect(store.get(unitId)!.source).toBe('agent');
    expect(events.some((e) => e.event === 'units')).toBe(true);
    expect(submitted.map((u) => u.unitId)).toEqual(['unit-1']);
  });

  it('submit against a clean tree is a friendly no-op — no unit created', async () => {
    const { store, app } = setup(async () => {
      throw new CleanTreeError('main');
    });
    const sid = await connect(app);
    const { parsed, isError } = await callTool(app, sid, 'submit_for_review', {
      taskLabel: 't',
      intent: 'x',
      repo: 'owner/a',
      worktreePath: '/wt',
    });
    expect(isError).toBe(false);
    expect((parsed as { ok: boolean }).ok).toBe(false);
    expect(store.list().length).toBe(0);
  });

  it('await_decision returns a decision already recorded on the unit', async () => {
    const { store, app } = setup();
    const sid = await connect(app);
    const { parsed } = await callTool(app, sid, 'submit_for_review', {
      taskLabel: 't',
      intent: 'x',
      repo: 'owner/a',
      worktreePath: '/wt',
    });
    const unitId = (parsed as { unitId: string }).unitId;
    await store.setReviewing(unitId);
    await store.setQueued(unitId, NARRATIVE, 2);
    await store.setDecision(unitId, { kind: 'changes_requested', note: 'tighten the boundary' });
    const res = await callTool(app, sid, 'await_decision', { unitId });
    expect((res.parsed as { decision: { kind: string; note: string } }).decision).toEqual({
      kind: 'changes_requested',
      note: 'tighten the boundary',
    });
  });

  it('await_decision times out to {pending:true} when the unit is undecided', async () => {
    const { app } = setup();
    const sid = await connect(app);
    const { parsed } = await callTool(app, sid, 'submit_for_review', {
      taskLabel: 't',
      intent: 'x',
      repo: 'owner/a',
      worktreePath: '/wt',
    });
    const unitId = (parsed as { unitId: string }).unitId;
    const res = await callTool(app, sid, 'await_decision', { unitId });
    expect((res.parsed as { pending: boolean }).pending).toBe(true);
  });

  it('await_decision on an unknown unit returns a structured error', async () => {
    const { app } = setup();
    const sid = await connect(app);
    const { isError } = await callTool(app, sid, 'await_decision', { unitId: 'nope' });
    expect(isError).toBe(true);
  });
});

describe('await_decision bundles outstanding comments (beats can’t be missed)', () => {
  it('returns + delivers open comments on a pending poll, and broadcasts the change', async () => {
    const { app, events, getCommentStore } = setup(undefined, { withComments: true });
    const sid = await connect(app);
    const unitId = await submitUnit(app, sid);
    const cs = (await getCommentStore!(unitId))!;
    await cs.add({ path: 'a.ts', line: 3, body: 'extract this guard' });

    const res = await callTool(app, sid, 'await_decision', { unitId });
    const out = res.parsed as { pending?: boolean; comments?: { body: string; status: string }[] };
    expect(out.pending).toBe(true);
    expect(out.comments?.map((c) => c.body)).toEqual(['extract this guard']);
    expect(out.comments?.[0]!.status).toBe('delivered'); // bundling IS delivery

    // Persisted: the open comment is now delivered, and the UI was told over SSE.
    expect(cs.list('open')).toHaveLength(0);
    expect(cs.list('delivered')).toHaveLength(1);
    expect(events.some((e) => e.event === 'agent-comment' && (e.data as { unitId: string }).unitId === unitId)).toBe(
      true,
    );
  });

  it('bundles outstanding comments alongside a recorded decision too', async () => {
    const { store, app, getCommentStore } = setup(undefined, { withComments: true });
    const sid = await connect(app);
    const unitId = await submitUnit(app, sid);
    await store.setReviewing(unitId);
    await store.setQueued(unitId, NARRATIVE, 1);
    await store.setDecision(unitId, { kind: 'approved' });
    const cs = (await getCommentStore!(unitId))!;
    await cs.add({ path: 'a.ts', line: 1, body: 'nit: rename' });

    const res = await callTool(app, sid, 'await_decision', { unitId });
    const out = res.parsed as { decision?: { kind: string }; comments?: { body: string }[] };
    expect(out.decision).toMatchObject({ kind: 'approved' });
    expect(out.comments?.map((c) => c.body)).toEqual(['nit: rename']);
  });

  it('keeps surfacing an already-delivered-but-unaddressed comment (so it can’t be lost)', async () => {
    const { app, getCommentStore } = setup(undefined, { withComments: true });
    const sid = await connect(app);
    const unitId = await submitUnit(app, sid);
    const cs = (await getCommentStore!(unitId))!;
    const c = await cs.add({ path: 'a.ts', line: 1, body: 'still open' });
    await cs.markDelivered([c.id]); // first poll already delivered it

    const res = await callTool(app, sid, 'await_decision', { unitId });
    expect((res.parsed as { comments?: { body: string }[] }).comments?.map((x) => x.body)).toEqual(['still open']);
  });

  it('drops an addressed comment from the bundle', async () => {
    const { app, getCommentStore } = setup(undefined, { withComments: true });
    const sid = await connect(app);
    const unitId = await submitUnit(app, sid);
    const cs = (await getCommentStore!(unitId))!;
    const c = await cs.add({ path: 'a.ts', line: 1, body: 'done already' });
    await cs.resolve(c.id, 'fixed');

    const res = await callTool(app, sid, 'await_decision', { unitId });
    expect((res.parsed as { comments?: unknown }).comments).toBeUndefined();
    expect((res.parsed as { pending?: boolean }).pending).toBe(true);
  });

  it('omits the comments field entirely when there are none outstanding', async () => {
    const { app } = setup(undefined, { withComments: true });
    const sid = await connect(app);
    const unitId = await submitUnit(app, sid);
    const res = await callTool(app, sid, 'await_decision', { unitId });
    expect((res.parsed as { comments?: unknown }).comments).toBeUndefined();
  });
});
