import { readdir, rm } from 'fs/promises';
import { Hono } from 'hono';
import { mkdtemp } from 'fs/promises';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentCommentStore } from '../agent-comments/store';
import { createDaemonApp, SseHub } from '../daemon/app';
import type { ComputeSlice } from '../mcp/submit';
import type { LocalReview } from '../local/diff-source';
import type { PRMetadata } from '../github/types';
import { UnitStore } from '../units/store';
import { DecisionChannel } from '../units/decision-channel';

const STORE_DIR = join(homedir(), '.cache', 'diffdad', 'agent-comments');
const HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };

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
  let t = 0;
  return { genId: () => `c-${++id}`, now: () => `2026-06-26T00:00:0${t++}.000Z` };
}

async function cleanFixture() {
  try {
    for (const e of await readdir(STORE_DIR)) {
      if (e.startsWith('__diffdad_test__')) await rm(join(STORE_DIR, e), { force: true });
    }
  } catch {
    /* dir may not exist */
  }
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'diffdad-unit-comments-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await cleanFixture();
});

function setup() {
  const store = new UnitStore([], { dir, genId: (() => { let n = 0; return () => `unit-${++n}`; })(), now: () => '2026-06-26T00:00:00.000Z' });
  const decision = new DecisionChannel();
  const hub = new SseHub();
  const messages: Array<{ event: string; data: unknown }> = [];
  hub.add((event, data) => messages.push({ event, data }));
  // In-memory per-unit stores keyed by unitId, deterministic, under the test fixture prefix.
  const commentStores = new Map<string, AgentCommentStore>();
  const loadCommentStore = async (unitId: string) => {
    const s = new AgentCommentStore(`__diffdad_test__unit-${unitId}`, [], deterministic());
    commentStores.set(unitId, s);
    return s;
  };
  const { app } = createDaemonApp({ store, decision, hub, computeSlice: fakeSlice, loadCommentStore });
  return { store, app, messages, commentStores };
}

async function addUnit(store: UnitStore, repo = 'owner/a') {
  return store.add({
    repo,
    worktreePath: `/wt-${repo}`,
    taskLabel: 't',
    intent: 'x',
    baseRef: 'main',
    diffContentKey: 'k',
    files: [],
    metadata: mkMetadata(),
    source: 'agent',
  });
}

// --- MCP-over-HTTP helpers (mirrors mcp-tools.test.ts) -----------------------
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
  const sid = init.headers.get('mcp-session-id')!;
  await rpc(app, { jsonrpc: '2.0', method: 'notifications/initialized' }, sid);
  return sid;
}
let callId = 100;
async function callTool(app: Hono, sid: string, name: string, args: Record<string, unknown>) {
  const res = await rpc(app, { jsonrpc: '2.0', id: ++callId, method: 'tools/call', params: { name, arguments: args } }, sid);
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

describe('per-unit agent-comment routes', () => {
  it('POST then GET round-trips a comment scoped to one unit', async () => {
    const { store, app } = setup();
    const a = await addUnit(store, 'owner/a');

    const empty = await app.request(`/api/units/${a.unitId}/agent-comments`);
    expect(await empty.json()).toEqual([]);

    const created = await app.request(`/api/units/${a.unitId}/agent-comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'src/a.ts', line: 12, body: 'extract this guard' }),
    });
    expect(created.status).toBe(201);
    const comment = (await created.json()) as { id: string; status: string; author: string };
    expect(comment).toMatchObject({ status: 'open', author: 'user' });

    const list = await app.request(`/api/units/${a.unitId}/agent-comments`);
    const all = (await list.json()) as { id: string }[];
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(comment.id);
  });

  it('isolates comments between units', async () => {
    const { store, app } = setup();
    const a = await addUnit(store, 'owner/a');
    const b = await addUnit(store, 'owner/b');

    await app.request(`/api/units/${a.unitId}/agent-comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'a.ts', line: 1, body: 'for A only' }),
    });

    const bList = (await (await app.request(`/api/units/${b.unitId}/agent-comments`)).json()) as unknown[];
    expect(bList).toEqual([]);
  });

  it('404s for an unknown unit on GET and POST', async () => {
    const { app } = setup();
    expect((await app.request('/api/units/nope/agent-comments')).status).toBe(404);
    const post = await app.request('/api/units/nope/agent-comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'a.ts', line: 1, body: 'x' }),
    });
    expect(post.status).toBe(404);
  });

  it('rejects a comment missing body or path/line', async () => {
    const { store, app } = setup();
    const a = await addUnit(store, 'owner/a');
    const noBody = await app.request(`/api/units/${a.unitId}/agent-comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'a.ts', line: 1 }),
    });
    expect(noBody.status).toBe(400);
  });

  it('broadcasts a unit-scoped agent-comment event', async () => {
    const { store, app, messages } = setup();
    const a = await addUnit(store, 'owner/a');
    await app.request(`/api/units/${a.unitId}/agent-comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'a.ts', line: 1, body: 'hi' }),
    });
    const evt = messages.find((m) => m.event === 'agent-comment');
    expect(evt).toBeDefined();
    expect(evt!.data).toMatchObject({ unitId: a.unitId });
    expect((evt!.data as { comments: unknown[] }).comments).toHaveLength(1);
  });
});

describe('per-unit agent-comment replies (threading)', () => {
  it('threads a reply under the parent instead of spawning a sibling', async () => {
    const { store, app } = setup();
    const a = await addUnit(store, 'owner/a');
    const created = await app.request(`/api/units/${a.unitId}/agent-comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'a.ts', line: 1, body: 'parent' }),
    });
    const id = ((await created.json()) as { id: string }).id;

    // A reply carries inReplyToId and (intentionally) no path/line — it inherits the parent's.
    const reply = await app.request(`/api/units/${a.unitId}/agent-comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inReplyToId: id, body: 'a reply' }),
    });
    expect(reply.status).toBe(201);

    const list = (await (await app.request(`/api/units/${a.unitId}/agent-comments`)).json()) as {
      id: string;
      replies: { author: string; body: string }[];
    }[];
    expect(list).toHaveLength(1); // still ONE top-level comment, not two siblings
    expect(list[0]!.replies).toHaveLength(1);
    expect(list[0]!.replies[0]).toMatchObject({ author: 'user', body: 'a reply' });
  });

  it('404s a reply to an unknown comment id', async () => {
    const { store, app } = setup();
    const a = await addUnit(store, 'owner/a');
    const res = await app.request(`/api/units/${a.unitId}/agent-comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inReplyToId: 'nope', body: 'x' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('per-unit agent-comment MCP tools', () => {
  it('list_review_comments returns a unit\'s open comments and flips them delivered', async () => {
    const { store, app, messages } = setup();
    const a = await addUnit(store, 'owner/a');
    // Seed via the HTTP route so it lands in the app's shared per-unit store.
    await app.request(`/api/units/${a.unitId}/agent-comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'a.ts', line: 1, body: 'one' }),
    });

    const sid = await connect(app);
    const { parsed } = await callTool(app, sid, 'list_review_comments', { unitId: a.unitId, status: 'open' });
    expect((parsed as { body: string }[]).map((x) => x.body)).toEqual(['one']);
    expect(messages.some((m) => m.event === 'agent-comment' && (m.data as { unitId: string }).unitId === a.unitId)).toBe(
      true,
    );

    // A second open-list is now empty (the first flipped them to delivered).
    const again = await callTool(app, sid, 'list_review_comments', { unitId: a.unitId, status: 'open' });
    expect((again.parsed as unknown[]).length).toBe(0);
  });

  it('reply_to_comment and resolve_comment mutate the right unit', async () => {
    const { store, app } = setup();
    const a = await addUnit(store, 'owner/a');
    const created = await app.request(`/api/units/${a.unitId}/agent-comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'a.ts', line: 1, body: 'one' }),
    });
    const id = ((await created.json()) as { id: string }).id;

    const sid = await connect(app);
    await callTool(app, sid, 'reply_to_comment', { unitId: a.unitId, id, body: 'done' });
    const { parsed } = await callTool(app, sid, 'resolve_comment', { unitId: a.unitId, id, note: 'moved guard up' });
    expect(parsed).toMatchObject({ status: 'addressed' });
  });

  it('errors on an unknown unit', async () => {
    const { app } = setup();
    const sid = await connect(app);
    const { isError } = await callTool(app, sid, 'list_review_comments', { unitId: 'nope' });
    expect(isError).toBe(true);
  });
});
