import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Hono } from 'hono';

const SERVER_NAME = 'diffdad';
const SERVER_VERSION = '0.1.0';

/** Registers MCP tools on a freshly created server (called once per session). */
export type RegisterTools = (server: McpServer) => void;

function isInitialize(body: unknown): boolean {
  if (Array.isArray(body)) return body.some(isInitializeRequest);
  return isInitializeRequest(body);
}

/**
 * Mount an MCP server on the existing Hono app at `/mcp` using the SDK's
 * Web-Standard Streamable-HTTP transport (Fetch Request/Response — native to Bun/Hono).
 *
 * Stateful: an `initialize` request spins up a session (server + transport) keyed by a
 * generated `mcp-session-id`; subsequent requests carrying that header reuse it. Stateless
 * mode is unusable here — the SDK rejects transport reuse, and a fresh transport rejects
 * any non-initialize request (webStandardStreamableHttp.js:137-139, :590).
 *
 * Must be registered BEFORE the static catch-all in server.ts, or it is swallowed.
 */
export function mountMcp(app: Hono, registerTools: RegisterTools): void {
  const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();

  app.all('/mcp', async (c) => {
    const req = c.req.raw;
    const sessionId = req.headers.get('mcp-session-id') ?? undefined;
    const existing = sessionId ? sessions.get(sessionId) : undefined;

    // Bodyless methods (GET for the SSE stream, DELETE to end a session) on a known session.
    if (req.method !== 'POST') {
      if (!existing) return c.json(jsonRpcError('No valid session'), 400);
      return existing.handleRequest(req);
    }

    let parsedBody: unknown;
    try {
      parsedBody = await req.json();
    } catch {
      return c.json(jsonRpcError('Invalid JSON body'), 400);
    }

    if (existing) {
      return existing.handleRequest(req, { parsedBody });
    }

    if (!isInitialize(parsedBody)) {
      return c.json(jsonRpcError('No valid session — send an initialize request first'), 400);
    }

    // New session.
    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
    registerTools(server);
    const transport: WebStandardStreamableHTTPServerTransport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      enableJsonResponse: true,
      onsessioninitialized: (sid) => {
        sessions.set(sid, transport);
      },
      onsessionclosed: (sid) => {
        sessions.delete(sid);
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    await server.connect(transport);
    return transport.handleRequest(req, { parsedBody });
  });
}

function jsonRpcError(message: string) {
  return { jsonrpc: '2.0' as const, error: { code: -32000, message }, id: null };
}
