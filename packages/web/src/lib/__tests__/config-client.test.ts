import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchConfig, isSaveError, saveConfig, testConnection, type ConfigResponse } from '../config-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function mkResponse(over: Partial<ConfigResponse> = {}): ConfigResponse {
  return {
    config: { githubTokenSet: false, aiApiKeySet: false, theme: 'auto', accent: 'classic', ...over.config },
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
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(mkResponse({ config: { githubTokenSet: false, aiApiKeySet: false, theme: 'dark' } })),
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
