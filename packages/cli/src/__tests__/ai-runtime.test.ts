import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { callAi } from '../narrative/ai-runtime';
import type { DiffDadConfig } from '../config';

/**
 * These tests exercise callAi's API (streamText) path against a local mock that
 * speaks the OpenAI chat-completions SSE protocol. Each case is guarded by a
 * per-test timeout so a regression to the old hang-forever behavior fails fast
 * instead of wedging the suite.
 */

type Handler = (req: Request) => Response | Promise<Response>;

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
let handler: Handler = () => new Response('no handler set', { status: 500 });

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      return handler(req);
    },
  });
  baseUrl = `http://localhost:${server.port}/v1`;
});

afterAll(() => {
  server.stop(true);
});

function config(): DiffDadConfig {
  return {
    aiProvider: 'openai-compatible',
    aiBaseUrl: baseUrl,
    aiApiKey: 'test',
    aiModel: 'gpt-4o',
  };
}

function chunk(content: string | undefined, finishReason: string | null = null): string {
  return JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'gpt-4o',
    choices: [
      {
        index: 0,
        delta: content !== undefined ? { content } : {},
        finish_reason: finishReason,
      },
    ],
  });
}

function sse(lines: string[]): Response {
  const body = lines.map((line) => `data: ${line}\n\n`).join('');
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' },
  });
}

describe('callAi API path', () => {
  it(
    'resolves with accumulated text and streams each delta via onChunk',
    async () => {
      handler = () => sse([chunk('Hello'), chunk(' '), chunk('world'), chunk(undefined, 'stop'), '[DONE]']);

      const deltas: string[] = [];
      const result = await callAi(config(), 'system', 'user', 256, (d) => deltas.push(d));

      expect(result.text).toBe('Hello world');
      expect(deltas).toEqual(['Hello', ' ', 'world']);
      expect(result.truncated).toBe(false);
      expect(result.provider).toBe('openai-compatible (gpt-4o)');
    },
    { timeout: 10000 },
  );

  it(
    'rejects (does not hang) when the server returns an HTTP 400 error body',
    async () => {
      handler = () =>
        new Response(
          JSON.stringify({
            error: {
              message: 'Simulated failure: teapot overload',
              type: 'invalid_request_error',
              code: 'bad_request',
            },
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        );

      await expect(callAi(config(), 'system', 'user', 256)).rejects.toThrow(/teapot overload/);
    },
    { timeout: 10000 },
  );

  it(
    'rejects (does not hang) when the stream emits an error event mid-stream',
    async () => {
      // A provider that starts streaming then fails emits an OpenAI-style error
      // event (`data: {"error":{...}}`). The SDK turns that into a fullStream
      // 'error' part, which callAi must throw on instead of returning the
      // partial text it had already accumulated.
      handler = () =>
        sse([chunk('partial'), JSON.stringify({ error: { message: 'mid-stream boom', type: 'server_error' } })]);

      await expect(callAi(config(), 'system', 'user', 256)).rejects.toThrow(/mid-stream boom/);
    },
    { timeout: 10000 },
  );

  it(
    'rejects with the empty-response error when the stream has zero content deltas',
    async () => {
      handler = () => sse([chunk(undefined, 'stop'), '[DONE]']);

      await expect(callAi(config(), 'system', 'user', 256)).rejects.toThrow(/empty response.*finishReason: stop/);
    },
    { timeout: 10000 },
  );
});
