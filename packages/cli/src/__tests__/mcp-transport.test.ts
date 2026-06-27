import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { mountMcp } from '../mcp/server';

// Spike: prove the SDK's Web-Standard Streamable-HTTP transport bridges to Hono's
// Request/Response and survives a real initialize -> tools/call handshake in-memory.

function makeApp() {
  const app = new Hono();
  mountMcp(app, (server) => {
    server.registerTool('ping', { description: 'returns pong' }, async () => ({
      content: [{ type: 'text' as const, text: 'pong' }],
    }));
  });
  return app;
}

const HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };

async function rpc(app: Hono, body: unknown, sessionId?: string) {
  const headers: Record<string, string> = { ...HEADERS };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  return app.request('/mcp', { method: 'POST', headers, body: JSON.stringify(body) });
}

const initBody = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
};

describe('MCP transport (spike)', () => {
  it('completes the initialize handshake and returns a session id', async () => {
    const app = makeApp();
    const res = await rpc(app, initBody);
    expect(res.status).toBe(200);
    const sessionId = res.headers.get('mcp-session-id');
    expect(sessionId).toBeTruthy();
    const json = (await res.json()) as { result?: { serverInfo?: { name?: string } } };
    expect(json.result?.serverInfo?.name).toBe('diffdad');
  });

  it('lists and calls a tool over the reused session', async () => {
    const app = makeApp();
    const init = await rpc(app, initBody);
    const sessionId = init.headers.get('mcp-session-id')!;
    // The client must ack initialization before issuing further requests.
    await rpc(app, { jsonrpc: '2.0', method: 'notifications/initialized' }, sessionId);

    const list = await rpc(app, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, sessionId);
    const listJson = (await list.json()) as { result?: { tools?: { name: string }[] } };
    expect(listJson.result?.tools?.map((t) => t.name)).toContain('ping');

    const call = await rpc(
      app,
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'ping', arguments: {} } },
      sessionId,
    );
    const callJson = (await call.json()) as { result?: { content?: { text?: string }[] } };
    expect(callJson.result?.content?.[0]?.text).toBe('pong');
  });

  it('rejects a non-initialize request with no session', async () => {
    const app = makeApp();
    const res = await rpc(app, { jsonrpc: '2.0', id: 9, method: 'tools/list' });
    expect(res.status).toBe(400);
  });
});
