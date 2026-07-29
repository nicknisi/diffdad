import { afterAll, beforeAll, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import * as credentialProviders from '@aws-sdk/credential-providers';
import { EventStreamCodec } from '@smithy/eventstream-codec';
import { fromUtf8, toUtf8 } from '@smithy/util-utf8';
import { callAi, getModel, resetBedrockModelCache, withResolvedBedrockRegion } from '../narrative/ai-runtime';
import * as bedrockModels from '../narrative/bedrock-models';
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

describe('getModel amazon-bedrock case', () => {
  it('builds a model from explicit keys without throwing (uses the configured model id)', () => {
    const model = getModel({
      aiProvider: 'amazon-bedrock',
      aiRegion: 'us-east-1',
      aiAccessKeyId: 'AKIAEXAMPLE',
      aiSecretAccessKey: 'secret',
      aiModel: 'us.anthropic.claude-custom-v1:0',
    });
    expect(model.modelId).toBe('us.anthropic.claude-custom-v1:0');
  });

  it('builds a model chain-first (no keys) and falls back to the default model id', () => {
    const model = getModel({ aiProvider: 'amazon-bedrock', aiRegion: 'us-east-1' });
    // Default Bedrock model is a current Claude Sonnet cross-region inference profile.
    expect(model.modelId).toMatch(/^us\.anthropic\.claude-sonnet/);
  });

  it("treats an empty-string model as unset (the settings form saves '' to mean the default)", () => {
    const model = getModel({ aiProvider: 'amazon-bedrock', aiRegion: 'us-east-1', aiModel: '' });
    expect(model.modelId).toMatch(/^us\.anthropic\.claude-sonnet/);
  });

  it('keeps the default provider switch exhaustive (bedrock does not hit the unreachable default)', () => {
    // If the switch fell through to `default`, this would throw "Unsupported aiProvider".
    expect(() => getModel({ aiProvider: 'amazon-bedrock' })).not.toThrow();
  });

  it('scopes the credential chain to a named profile when one is set (no explicit keys)', () => {
    const chain = spyOn(credentialProviders, 'fromNodeProviderChain').mockReturnValue((async () => ({
      accessKeyId: 'x',
      secretAccessKey: 'y',
    })) as ReturnType<typeof credentialProviders.fromNodeProviderChain>);
    try {
      getModel({ aiProvider: 'amazon-bedrock', aiRegion: 'us-east-1', aiProfile: 'my-sso' });
      expect(chain).toHaveBeenCalledWith({ profile: 'my-sso' });
    } finally {
      chain.mockRestore();
    }
  });
});

describe('withResolvedBedrockRegion', () => {
  it('leaves a non-bedrock config untouched (no region resolution)', async () => {
    const spy = spyOn(bedrockModels, 'resolveBedrockRegion');
    try {
      const config: DiffDadConfig = { aiProvider: 'anthropic', aiApiKey: 'k' };
      expect(await withResolvedBedrockRegion(config)).toBe(config);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('leaves a bedrock config with an explicit region untouched', async () => {
    const spy = spyOn(bedrockModels, 'resolveBedrockRegion');
    try {
      const config: DiffDadConfig = { aiProvider: 'amazon-bedrock', aiRegion: 'us-east-1' };
      expect(await withResolvedBedrockRegion(config)).toBe(config);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('fills a blank region for a profile-only bedrock config from the resolved region', async () => {
    const spy = spyOn(bedrockModels, 'resolveBedrockRegion').mockResolvedValue('eu-central-1');
    try {
      const result = await withResolvedBedrockRegion({ aiProvider: 'amazon-bedrock', aiProfile: 'my-sso' });
      expect(result.aiRegion).toBe('eu-central-1');
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("treats an empty-string region as blank (a profile-mode save stores aiRegion as '')", async () => {
    const spy = spyOn(bedrockModels, 'resolveBedrockRegion').mockResolvedValue('eu-central-1');
    try {
      const result = await withResolvedBedrockRegion({
        aiProvider: 'amazon-bedrock',
        aiProfile: 'my-sso',
        aiRegion: '',
      });
      expect(result.aiRegion).toBe('eu-central-1');
    } finally {
      spy.mockRestore();
    }
  });

  it('leaves the config unchanged when no region can be resolved', async () => {
    const spy = spyOn(bedrockModels, 'resolveBedrockRegion').mockResolvedValue(undefined);
    try {
      const config: DiffDadConfig = { aiProvider: 'amazon-bedrock', aiProfile: 'my-sso' };
      const result = await withResolvedBedrockRegion(config);
      expect(result.aiRegion).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});

/**
 * These tests exercise callAi's Bedrock ConverseStream path against canned AWS
 * eventstream responses, encoded with the same @smithy codec the provider
 * decodes with. The frames mirror what Claude Opus 5 actually sends: thinking
 * is on by default and its display defaults to "omitted", so reasoning blocks
 * arrive as a bare signature delta with no reasoning text.
 */
describe('callAi amazon-bedrock stream path', () => {
  // The Bedrock model is cached at module scope, and the cached model holds the fetch that was
  // current when it was built. Reset the cache before each case so a test builds its model against
  // its own fetch spy rather than reusing a prior test's (restored) one.
  beforeEach(() => {
    resetBedrockModelCache();
  });

  function bedrockConfig(): DiffDadConfig {
    return {
      aiProvider: 'amazon-bedrock',
      aiRegion: 'us-east-1',
      aiAccessKeyId: 'AKIAEXAMPLE',
      aiSecretAccessKey: 'secret',
      aiModel: 'us.anthropic.claude-opus-5',
    };
  }

  function eventFrame(eventType: string, payload: unknown): Uint8Array {
    const codec = new EventStreamCodec(toUtf8, fromUtf8);
    return codec.encode({
      headers: {
        ':event-type': { type: 'string', value: eventType },
        ':content-type': { type: 'string', value: 'application/json' },
        ':message-type': { type: 'string', value: 'event' },
      },
      body: new TextEncoder().encode(JSON.stringify(payload)),
    });
  }

  // Cast: Bun's `typeof fetch` demands a `preconnect` property that plain mock closures lack and
  // the AI SDK never touches (same cast as toInvokeAuth in bedrock-models.ts).
  function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
    return spyOn(globalThis, 'fetch').mockImplementation(impl as unknown as typeof fetch);
  }

  function converseStreamResponse(frames: Uint8Array[]): Response {
    const total = frames.reduce((n, f) => n + f.length, 0);
    const body = new Uint8Array(total);
    let offset = 0;
    for (const f of frames) {
      body.set(f, offset);
      offset += f.length;
    }
    return new Response(body, {
      headers: { 'content-type': 'application/vnd.amazon.eventstream' },
    });
  }

  it(
    'survives an omitted-thinking stream (reasoning signature with no reasoning text)',
    async () => {
      // Opus 5 shape: the model thinks, but display defaults to "omitted" — the
      // stream carries the reasoning block's signature and never any reasoning
      // text. ai@4's accumulator throws InvalidStreamPart ("reasoning-signature
      // without reasoning") on that sequence unless the signature is stripped.
      const fetchSpy = mockFetch(async () =>
        converseStreamResponse([
          eventFrame('contentBlockDelta', {
            contentBlockIndex: 0,
            delta: { reasoningContent: { signature: 'sig-abc' } },
          }),
          eventFrame('contentBlockStop', { contentBlockIndex: 0 }),
          eventFrame('contentBlockDelta', { contentBlockIndex: 1, delta: { text: 'OK' } }),
          eventFrame('contentBlockStop', { contentBlockIndex: 1 }),
          eventFrame('messageStop', { stopReason: 'end_turn' }),
          eventFrame('metadata', { usage: { inputTokens: 5, outputTokens: 2 } }),
        ]),
      );
      try {
        const deltas: string[] = [];
        const result = await callAi(bedrockConfig(), 'system', 'user', 256, (d) => deltas.push(d));

        expect(fetchSpy.mock.calls[0]?.[0]).toContain('bedrock-runtime.us-east-1.amazonaws.com');
        expect(result.text).toBe('OK');
        expect(deltas).toEqual(['OK']);
        expect(result.truncated).toBe(false);
      } finally {
        fetchSpy.mockRestore();
      }
    },
    { timeout: 10000 },
  );

  it(
    'keeps reasoning text out of the returned text when thinking is streamed with content',
    async () => {
      // Summarized-display shape: reasoning text deltas precede the signature.
      // Only the answer text may reach the caller — reasoning is discarded.
      const fetchSpy = mockFetch(async () =>
        converseStreamResponse([
          eventFrame('contentBlockDelta', {
            contentBlockIndex: 0,
            delta: { reasoningContent: { text: 'Let me think about this.' } },
          }),
          eventFrame('contentBlockDelta', {
            contentBlockIndex: 0,
            delta: { reasoningContent: { signature: 'sig-abc' } },
          }),
          eventFrame('contentBlockStop', { contentBlockIndex: 0 }),
          eventFrame('contentBlockDelta', { contentBlockIndex: 1, delta: { text: 'OK' } }),
          eventFrame('contentBlockStop', { contentBlockIndex: 1 }),
          eventFrame('messageStop', { stopReason: 'end_turn' }),
          eventFrame('metadata', { usage: { inputTokens: 5, outputTokens: 2 } }),
        ]),
      );
      try {
        const result = await callAi(bedrockConfig(), 'system', 'user', 256);
        expect(result.text).toBe('OK');
      } finally {
        fetchSpy.mockRestore();
      }
    },
    { timeout: 10000 },
  );

  it(
    'requests thinking disabled for Claude models (maxTokens must budget visible text, not thinking)',
    async () => {
      // From Opus 5 onward Claude thinks by default and maxTokens caps thinking + text together —
      // a writer-sized budget can be consumed entirely by omitted thinking, yielding the
      // empty-response error (finishReason: length). The request must turn thinking off.
      let requestBody: string | undefined;
      const fetchSpy = mockFetch(async (_input, init) => {
        requestBody = typeof init?.body === 'string' ? init.body : undefined;
        return converseStreamResponse([
          eventFrame('contentBlockDelta', { contentBlockIndex: 0, delta: { text: 'OK' } }),
          eventFrame('contentBlockStop', { contentBlockIndex: 0 }),
          eventFrame('messageStop', { stopReason: 'end_turn' }),
          eventFrame('metadata', { usage: { inputTokens: 5, outputTokens: 2 } }),
        ]);
      });
      try {
        await callAi(bedrockConfig(), 'system', 'user', 256);
        expect(requestBody).toBeDefined();
        const parsed = JSON.parse(requestBody!) as {
          additionalModelRequestFields?: { thinking?: { type?: string } };
        };
        expect(parsed.additionalModelRequestFields?.thinking?.type).toBe('disabled');
      } finally {
        fetchSpy.mockRestore();
      }
    },
    { timeout: 10000 },
  );

  it(
    'does not send the Anthropic thinking field to non-Claude Bedrock models',
    async () => {
      let requestBody: string | undefined;
      const fetchSpy = mockFetch(async (_input, init) => {
        requestBody = typeof init?.body === 'string' ? init.body : undefined;
        return converseStreamResponse([
          eventFrame('contentBlockDelta', { contentBlockIndex: 0, delta: { text: 'OK' } }),
          eventFrame('contentBlockStop', { contentBlockIndex: 0 }),
          eventFrame('messageStop', { stopReason: 'end_turn' }),
          eventFrame('metadata', { usage: { inputTokens: 5, outputTokens: 2 } }),
        ]);
      });
      try {
        const config = { ...bedrockConfig(), aiModel: 'us.meta.llama4-maverick-17b-instruct-v1:0' };
        await callAi(config, 'system', 'user', 256);
        expect(requestBody).toBeDefined();
        const parsed = JSON.parse(requestBody!) as { additionalModelRequestFields?: Record<string, unknown> };
        expect(parsed.additionalModelRequestFields?.thinking).toBeUndefined();
      } finally {
        fetchSpy.mockRestore();
      }
    },
    { timeout: 10000 },
  );

  it(
    'emits a DIFFDAD_DEBUG_AI summary line with finishReason, usage, and stream part tallies',
    async () => {
      const fetchSpy = mockFetch(async () =>
        converseStreamResponse([
          eventFrame('contentBlockDelta', { contentBlockIndex: 0, delta: { text: 'OK' } }),
          eventFrame('contentBlockStop', { contentBlockIndex: 0 }),
          eventFrame('messageStop', { stopReason: 'end_turn' }),
          eventFrame('metadata', { usage: { inputTokens: 5, outputTokens: 2 } }),
        ]),
      );
      const errorSpy = spyOn(console, 'error').mockImplementation(() => {});
      process.env.DIFFDAD_DEBUG_AI = '1';
      try {
        await callAi(bedrockConfig(), 'system', 'user', 256);
        const line = errorSpy.mock.calls.map((c) => String(c[0])).find((s) => s.includes('[diffdad:ai]'));
        expect(line).toBeDefined();
        expect(line).toContain('finishReason=stop');
        expect(line).toContain('textChars=2');
        expect(line).toContain('"text-delta":1');
      } finally {
        delete process.env.DIFFDAD_DEBUG_AI;
        errorSpy.mockRestore();
        fetchSpy.mockRestore();
      }
    },
    { timeout: 10000 },
  );
});
