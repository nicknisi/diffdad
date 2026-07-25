import { afterAll, beforeAll, describe, expect, it, spyOn } from 'bun:test';
import * as credentialProviders from '@aws-sdk/credential-providers';
import { callAi, getModel, withResolvedBedrockRegion } from '../narrative/ai-runtime';
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
