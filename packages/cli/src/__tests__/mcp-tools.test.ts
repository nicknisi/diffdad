import { readdir, rm } from 'fs/promises';
import { Hono } from 'hono';
import { homedir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentCommentStore } from '../agent-comments/store';
import { registerAgentCommentTools } from '../mcp/tools';
import { mountMcp } from '../mcp/server';

const STORE_DIR = join(homedir(), '.cache', 'diffdad', 'agent-comments');
const FIXTURE_KEY = '__diffdad_test__mcp';
const HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };

function deterministic() {
  let id = 0;
  let t = 0;
  return { genId: () => `id-${++id}`, now: () => `2026-06-15T00:00:0${t++}.000Z` };
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

function setup() {
  const store = new AgentCommentStore(FIXTURE_KEY, [], deterministic());
  const events: { event: string; data: unknown }[] = [];
  const app = new Hono();
  mountMcp(app, (server) => registerAgentCommentTools(server, { store, broadcast: (event, data) => events.push({ event, data }) }));
  return { store, events, app };
}

describe('MCP agent-comment tools', () => {
  afterEach(cleanFixture);

  it('list_review_comments returns open comments and flips them to delivered', async () => {
    const { store, events, app } = setup();
    const a = await store.add({ path: 'a.ts', line: 1, body: 'one' });
    const b = await store.add({ path: 'b.ts', line: 2, body: 'two' });
    const c = await store.add({ path: 'c.ts', line: 3, body: 'three' });
    await store.markDelivered([c.id]); // pre-delivered

    const sid = await connect(app);
    const { parsed } = await callTool(app, sid, 'list_review_comments', { status: 'open' });
    expect((parsed as { id: string }[]).map((x) => x.id)).toEqual([a.id, b.id]);
    // both open comments flipped to delivered; broadcast fired
    expect(store.list().find((x) => x.id === a.id)?.status).toBe('delivered');
    expect(store.list().find((x) => x.id === b.id)?.status).toBe('delivered');
    expect(events.some((e) => e.event === 'agent-comment')).toBe(true);

    const all = await callTool(app, sid, 'list_review_comments', { status: 'all' });
    expect((all.parsed as unknown[]).length).toBe(3);
  });

  it('reply_to_comment and resolve_comment mutate the store and broadcast', async () => {
    const { store, events, app } = setup();
    const a = await store.add({ path: 'a.ts', line: 1, body: 'one' });
    const sid = await connect(app);

    await callTool(app, sid, 'reply_to_comment', { id: a.id, body: 'done' });
    await callTool(app, sid, 'resolve_comment', { id: a.id, note: 'moved guard up' });

    const updated = store.list().find((x) => x.id === a.id)!;
    expect(updated.replies).toHaveLength(1);
    expect(updated.replies[0]).toMatchObject({ author: 'agent', body: 'done' });
    expect(updated).toMatchObject({ status: 'addressed', addressedNote: 'moved guard up' });
    expect(events.filter((e) => e.event === 'agent-comment').length).toBeGreaterThanOrEqual(2);
  });

  it('returns a structured error for an unknown comment id', async () => {
    const { app } = setup();
    const sid = await connect(app);
    const { isError } = await callTool(app, sid, 'resolve_comment', { id: 'nope' });
    expect(isError).toBe(true);
  });
});
