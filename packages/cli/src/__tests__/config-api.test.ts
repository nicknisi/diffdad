import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type ConfigResponse,
  type ConfigRouteTesters,
  redactConfig,
  registerConfigRoutes,
  type ResolveGitHub,
} from '../config-api';
import { type DiffDadConfig, readConfig, writeConfig } from '../config';

// Isolate config on disk: point XDG_CONFIG_HOME at a fresh mkdtemp dir so readConfig/writeConfig
// touch a throwaway file instead of the developer's real ~/.config/diffdad/config.json.
let dir: string;
let prevXdg: string | undefined;
beforeEach(async () => {
  prevXdg = process.env.XDG_CONFIG_HOME;
  dir = await mkdtemp(join(tmpdir(), 'diffdad-config-api-'));
  process.env.XDG_CONFIG_HOME = dir;
});
afterEach(async () => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  await rm(dir, { recursive: true, force: true });
});

// A config-backed token resolver so `github.active` tracks the stored token deterministically —
// otherwise the real resolver would shell out to `gh` and report the dev machine's auth state.
const configResolveGitHub: ResolveGitHub = async () => {
  const c = await readConfig();
  return c.githubToken ? { token: c.githubToken, source: 'config' } : { token: null, source: null };
};

type BroadcastCall = { event: string; data: unknown };
function makeApp(over: { testers?: ConfigRouteTesters; resolveGitHub?: ResolveGitHub } = {}) {
  const broadcasts: BroadcastCall[] = [];
  const app = new Hono();
  registerConfigRoutes(app, {
    broadcast: (event, data) => broadcasts.push({ event, data }),
    resolveGitHub: over.resolveGitHub ?? configResolveGitHub,
    testers: over.testers,
  });
  return { app, broadcasts };
}

const put = (app: Hono, body: unknown) =>
  app.request('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const get = (app: Hono) => app.request('/api/config');

describe('redactConfig', () => {
  it('reduces secrets to *Set booleans and drops the raw values', () => {
    const redacted = redactConfig({ githubToken: 'ghp_x', aiApiKey: 'sk-y', theme: 'dark' });
    expect(redacted.githubTokenSet).toBe(true);
    expect(redacted.aiApiKeySet).toBe(true);
    expect(redacted.theme).toBe('dark');
    expect(JSON.stringify(redacted)).not.toContain('ghp_x');
    expect(JSON.stringify(redacted)).not.toContain('sk-y');
  });

  it('reports empty / missing secrets as not-set', () => {
    expect(redactConfig({}).githubTokenSet).toBe(false);
    expect(redactConfig({ githubToken: '' }).githubTokenSet).toBe(false);
  });
});

describe('GET /api/config', () => {
  it('returns a redacted config + effective github state (no token → inactive)', async () => {
    const { app } = makeApp();
    const res = await get(app);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ConfigResponse;
    expect(body.config.githubTokenSet).toBe(false);
    expect(body.github).toEqual({ active: false, source: null });
  });

  it('reflects a merged theme after a PUT', async () => {
    const { app } = makeApp();
    await put(app, { theme: 'dark' });
    const body = (await (await get(app)).json()) as ConfigResponse;
    expect(body.config.theme).toBe('dark');
  });
});

describe('PUT /api/config — merge + redaction', () => {
  it('sets a secret (githubTokenSet flips) without ever exposing the raw token', async () => {
    const { app, broadcasts } = makeApp();
    const res = await put(app, { githubToken: 'ghp_secret_123' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ConfigResponse;

    expect(body.config.githubTokenSet).toBe(true);
    expect(body.github.active).toBe(true);
    expect(body.github.source).toBe('config');
    // Secret absent from the PUT response, a fresh GET, and the SSE 'config' payload.
    expect(JSON.stringify(body)).not.toContain('ghp_secret_123');
    expect(JSON.stringify(await (await get(app)).json())).not.toContain('ghp_secret_123');
    const configEvent = broadcasts.find((b) => b.event === 'config');
    expect(configEvent).toBeDefined();
    expect(JSON.stringify(configEvent!.data)).not.toContain('ghp_secret_123');

    // …but it really is persisted on disk (write-only, not lost).
    expect((await readConfig()).githubToken).toBe('ghp_secret_123');
  });

  it('leaves an omitted secret untouched, and clears it with an empty string', async () => {
    const { app } = makeApp();
    await writeConfig({ githubToken: 'ghp_keep', theme: 'light' });

    // Omitted secret → preserved; other key merged.
    await put(app, { theme: 'dark' });
    expect((await readConfig()).githubToken).toBe('ghp_keep');
    expect((await readConfig()).theme).toBe('dark');

    // Empty string → cleared.
    const cleared = (await (await put(app, { githubToken: '' })).json()) as ConfigResponse;
    expect(cleared.config.githubTokenSet).toBe(false);
    expect(cleared.github.active).toBe(false);
    expect((await readConfig()).githubToken).toBeUndefined();
  });

  it('is a merge patch — unrelated stored keys survive a partial PUT', async () => {
    const { app } = makeApp();
    await writeConfig({ theme: 'dark', accent: 'sky', clusterBots: false });
    await put(app, { theme: 'light' });
    const c = await readConfig();
    expect(c.theme).toBe('light');
    expect(c.accent).toBe('sky');
    expect(c.clusterBots).toBe(false);
  });
});

describe('PUT /api/config — validation (400s)', () => {
  it('400s invalid JSON', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not json',
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid JSON body');
  });

  it('400s an unknown key (strict schema)', async () => {
    const { app } = makeApp();
    const res = await put(app, { totallyUnknownKey: 1 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; fields: Record<string, string> };
    expect(body.error).toBe('invalid config');
  });

  it('400s a bad enum value', async () => {
    const { app } = makeApp();
    const res = await put(app, { aiProvider: 'bogus' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { fields: Record<string, string> }).fields.aiProvider).toBeDefined();
  });

  it('400s pollIntervalMs below the floor with a per-field message', async () => {
    const { app } = makeApp();
    const res = await put(app, { pollIntervalMs: 500 });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fields: Record<string, string> };
    expect(body.fields.pollIntervalMs).toBeDefined();
    expect(body.fields.pollIntervalMs).toContain('10000');
  });

  it('a failed validation persists nothing and broadcasts nothing', async () => {
    const { app, broadcasts } = makeApp();
    await put(app, { aiProvider: 'bogus' });
    expect(await readConfig()).toEqual({});
    expect(broadcasts).toHaveLength(0);
  });
});

describe('PUT /api/config — concurrent writes are serialized', () => {
  it('two racing PUTs of disjoint keys both persist (no lost update)', async () => {
    const { app } = makeApp();
    await Promise.all([put(app, { theme: 'dark' }), put(app, { accent: 'sky' })]);
    const c = await readConfig();
    expect(c.theme).toBe('dark');
    expect(c.accent).toBe('sky');
  });
});

describe('POST /api/config/test', () => {
  const post = (app: Hono, body: unknown) =>
    app.request('/api/config/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('github: ok:true with the login in detail (candidate token beats the effective one)', async () => {
    const seen: string[] = [];
    const { app } = makeApp({
      testers: {
        testGitHub: async (token) => {
          seen.push(token);
          return { ok: true, detail: 'authenticated as octocat' };
        },
      },
    });
    const res = await post(app, { kind: 'github', token: 'ghp_candidate' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; detail: string };
    expect(body.ok).toBe(true);
    expect(body.detail).toContain('octocat');
    expect(seen).toEqual(['ghp_candidate']);
  });

  it('github: a rejecting tester reports ok:false as data (still HTTP 200)', async () => {
    const { app } = makeApp({
      testers: { testGitHub: async () => ({ ok: false, detail: 'Bad credentials' }) },
    });
    const res = await post(app, { kind: 'github', token: 'ghp_bad' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; detail: string };
    expect(body.ok).toBe(false);
    expect(body.detail).toBe('Bad credentials');
  });

  it('github: with no candidate and no effective token → ok:false, never calls the tester', async () => {
    let called = false;
    const { app } = makeApp({
      testers: {
        testGitHub: async () => {
          called = true;
          return { ok: true, detail: 'x' };
        },
      },
    });
    const res = await post(app, { kind: 'github' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
    expect(called).toBe(false);
  });

  it('ai: overlays candidate fields on the saved config before the live call', async () => {
    await writeConfig({ aiProvider: 'anthropic', aiModel: 'saved-model' });
    const seen: DiffDadConfig[] = [];
    const { app } = makeApp({
      testers: {
        testAi: async (config) => {
          seen.push(config);
          return { ok: true, detail: 'ok' };
        },
      },
    });
    const res = await post(app, { kind: 'ai', aiModel: 'candidate-model' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    expect(seen[0]!.aiProvider).toBe('anthropic'); // from saved config
    expect(seen[0]!.aiModel).toBe('candidate-model'); // overlaid
  });

  it('400s an unknown kind', async () => {
    const { app } = makeApp();
    expect((await post(app, { kind: 'frobnicate' })).status).toBe(400);
  });

  it('400s invalid JSON', async () => {
    const { app } = makeApp();
    const res = await app.request('/api/config/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not json',
    });
    expect(res.status).toBe(400);
  });
});
