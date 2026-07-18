import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type ConfigResponse,
  fetchConfig,
  isSaveError,
  listAwsProfiles,
  listBedrockModels,
  saveConfig,
  testConnection,
} from '../config-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mkResponse(over: Partial<ConfigResponse> = {}): ConfigResponse {
  return {
    config: {
      githubTokenSet: false,
      aiApiKeySet: false,
      aiSecretAccessKeySet: false,
      aiBedrockApiKeySet: false,
      theme: 'auto',
      accent: 'classic',
      ...over.config,
    },
    github: over.github ?? { active: false, source: null },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchConfig', () => {
  it('GETs /api/config and returns the parsed response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(mkResponse()));
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchConfig();
    expect(fetchMock).toHaveBeenCalledWith('/api/config');
    expect(res.config.theme).toBe('auto');
  });

  it('throws on a non-2xx status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    await expect(fetchConfig()).rejects.toThrow(/500/);
  });
});

describe('saveConfig', () => {
  it('PUTs a one-key patch as JSON and returns the fresh response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(
        mkResponse({
          config: {
            githubTokenSet: false,
            aiApiKeySet: false,
            aiSecretAccessKeySet: false,
            aiBedrockApiKeySet: false,
            theme: 'dark',
          },
        }),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await saveConfig({ theme: 'dark' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/config');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ theme: 'dark' });
    expect(res.config.theme).toBe('dark');
  });

  it('maps a 400 into a SaveError carrying the server field messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ error: 'invalid config', fields: { pollIntervalMs: 'too small' } }, 400)),
    );
    try {
      await saveConfig({ pollIntervalMs: 5 });
      throw new Error('expected saveConfig to reject');
    } catch (err) {
      expect(isSaveError(err)).toBe(true);
      if (isSaveError(err)) expect(err.fields.pollIntervalMs).toBe('too small');
    }
  });

  it('falls back to a whole-body field message when a 400 omits fields', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'invalid JSON body' }, 400)));
    await expect(saveConfig({ theme: 'dark' })).rejects.toMatchObject({ fields: { _: 'invalid JSON body' } });
  });

  it('rejects with a plain Error (not a SaveError) on a 500', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'disk full' }, 500)));
    await expect(saveConfig({ theme: 'dark' })).rejects.toThrow(/500/);
    await expect(saveConfig({ theme: 'dark' })).rejects.not.toHaveProperty('fields');
  });
});

describe('testConnection', () => {
  it('POSTs the test body and returns the {ok, detail} result on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true, detail: 'authenticated as octocat' }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await testConnection({ kind: 'github', token: 'ghp_x' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/config/test');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ kind: 'github', token: 'ghp_x' });
    expect(res).toEqual({ ok: true, detail: 'authenticated as octocat' });
  });

  it('folds an unexpected non-200 into a failing result rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({}, 500)));
    const res = await testConnection({ kind: 'ai' });
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/500/);
  });
});

describe('listBedrockModels', () => {
  it('POSTs the region/creds body and returns the models + resolved region on 200', async () => {
    const models = [
      { id: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0', label: 'Claude Sonnet 4.5' },
      { id: 'us.meta.llama3-1-70b-instruct-v1:0', label: 'Llama 3.1 70B' },
    ];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ models, region: 'us-east-1' }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await listBedrockModels({ aiProfile: 'my-sso' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/config/bedrock/models');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ aiProfile: 'my-sso' });
    // The resolved region rides along so the caller can prefill the region field.
    expect(res).toEqual({ models, region: 'us-east-1' });
  });

  it('throws with the server error message on a non-2xx (e.g. the 502 AWS-failure path)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'The security token included in the request is invalid.' }, 502)),
    );
    await expect(listBedrockModels({ aiRegion: 'us-east-1' })).rejects.toThrow(/security token/);
  });

  it('falls back to an HTTP-status message when a failure omits an error body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })));
    await expect(listBedrockModels({})).rejects.toThrow(/HTTP 500/);
  });
});

describe('listAwsProfiles', () => {
  it('GETs the profiles endpoint and returns the profile array', async () => {
    const profiles = [{ name: 'default', region: 'us-east-1' }, { name: 'staging' }];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ profiles }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await listAwsProfiles();
    expect(fetchMock).toHaveBeenCalledWith('/api/config/aws/profiles');
    expect(res).toEqual(profiles);
  });

  it('returns an empty list on a non-2xx rather than throwing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 500 })));
    expect(await listAwsProfiles()).toEqual([]);
  });
});
