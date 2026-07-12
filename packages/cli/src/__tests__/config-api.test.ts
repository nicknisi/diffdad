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

  it('reduces the AWS secret access key to *Set and drops the raw value', () => {
    const redacted = redactConfig({
      aiProvider: 'amazon-bedrock',
      aiRegion: 'us-east-1',
      aiAccessKeyId: 'AKIAEXAMPLE',
      aiSecretAccessKey: 'super-secret-key',
    });
    expect(redacted.aiSecretAccessKeySet).toBe(true);
    // aiAccessKeyId is an identifier, not a secret — it survives in the clear.
    expect(redacted.aiAccessKeyId).toBe('AKIAEXAMPLE');
    expect(redacted.aiRegion).toBe('us-east-1');
    expect(JSON.stringify(redacted)).not.toContain('super-secret-key');
  });

  it('reports missing AWS secrets as not-set', () => {
    expect(redactConfig({}).aiSecretAccessKeySet).toBe(false);
    expect(redactConfig({ aiSecretAccessKey: '' }).aiSecretAccessKeySet).toBe(false);
  });

  it('reduces the Bedrock API key to *Set and drops the raw value', () => {
    const redacted = redactConfig({ aiProvider: 'amazon-bedrock', aiBedrockApiKey: 'bedrock-api-key-abc' });
    expect(redacted.aiBedrockApiKeySet).toBe(true);
    expect(JSON.stringify(redacted)).not.toContain('bedrock-api-key-abc');
    expect(redactConfig({}).aiBedrockApiKeySet).toBe(false);
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

  it('accepts the amazon-bedrock provider + AWS fields, persisting keys but redacting the secret', async () => {
    const { app } = makeApp();
    const res = await put(app, {
      aiProvider: 'amazon-bedrock',
      aiRegion: 'us-east-1',
      aiProfile: 'my-sso',
      aiAccessKeyId: 'AKIAEXAMPLE',
      aiSecretAccessKey: 'aws-secret-value',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ConfigResponse;
    expect(body.config.aiProvider).toBe('amazon-bedrock');
    expect(body.config.aiRegion).toBe('us-east-1');
    // aiProfile is an identifier, not a secret — it survives redaction in the clear.
    expect(body.config.aiProfile).toBe('my-sso');
    expect(body.config.aiAccessKeyId).toBe('AKIAEXAMPLE');
    expect(body.config.aiSecretAccessKeySet).toBe(true);
    // Raw AWS secret never crosses the wire…
    expect(JSON.stringify(body)).not.toContain('aws-secret-value');
    // …but is persisted on disk.
    const saved = await readConfig();
    expect(saved.aiSecretAccessKey).toBe('aws-secret-value');
  });

  it('persists the Bedrock API key write-only and clears it with an empty string', async () => {
    const { app } = makeApp();
    const res = await put(app, { aiProvider: 'amazon-bedrock', aiBedrockApiKey: 'bedrock-api-key-abc' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ConfigResponse;
    expect(body.config.aiBedrockApiKeySet).toBe(true);
    expect(JSON.stringify(body)).not.toContain('bedrock-api-key-abc');
    expect((await readConfig()).aiBedrockApiKey).toBe('bedrock-api-key-abc');

    await put(app, { aiBedrockApiKey: '' });
    expect((await readConfig()).aiBedrockApiKey).toBeUndefined();
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

  it('ai: overlays candidate bedrock region + AWS creds on the saved config', async () => {
    await writeConfig({ aiProvider: 'amazon-bedrock', aiRegion: 'us-west-2' });
    const seen: DiffDadConfig[] = [];
    const { app } = makeApp({
      testers: {
        testAi: async (config) => {
          seen.push(config);
          return { ok: true, detail: 'ok' };
        },
      },
    });
    const res = await post(app, {
      kind: 'ai',
      aiRegion: 'eu-central-1',
      aiProfile: 'my-sso',
      aiAccessKeyId: 'AKIACAND',
      aiSecretAccessKey: 'cand-secret',
    });
    expect(res.status).toBe(200);
    expect(seen[0]!.aiProvider).toBe('amazon-bedrock'); // from saved config
    expect(seen[0]!.aiRegion).toBe('eu-central-1'); // overlaid
    expect(seen[0]!.aiProfile).toBe('my-sso');
    expect(seen[0]!.aiAccessKeyId).toBe('AKIACAND');
    expect(seen[0]!.aiSecretAccessKey).toBe('cand-secret');
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

describe('POST /api/config/bedrock/models', () => {
  const post = (app: Hono, body: unknown) =>
    app.request('/api/config/bedrock/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('returns the injected model list + resolved region and overlays candidate creds on the saved config', async () => {
    await writeConfig({ aiProvider: 'amazon-bedrock', aiRegion: 'us-east-1' });
    const seen: DiffDadConfig[] = [];
    const { app } = makeApp({
      testers: {
        listBedrockModels: async (config) => {
          seen.push(config);
          return {
            models: [{ id: 'us.anthropic.claude-sonnet', label: 'Claude Sonnet (inference profile)' }],
            region: 'eu-west-1',
          };
        },
      },
    });
    const res = await post(app, {
      aiRegion: 'eu-west-1',
      aiProfile: 'my-sso',
      aiAccessKeyId: 'AKIA',
      aiSecretAccessKey: 'sk',
      aiBedrockApiKey: 'bedrock-api-key-abc',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { models: { id: string; label: string }[]; region?: string };
    expect(body.models).toEqual([{ id: 'us.anthropic.claude-sonnet', label: 'Claude Sonnet (inference profile)' }]);
    // The resolved region is surfaced so the UI can prefill it.
    expect(body.region).toBe('eu-west-1');
    expect(seen[0]!.aiRegion).toBe('eu-west-1'); // candidate overlaid
    expect(seen[0]!.aiProfile).toBe('my-sso');
    expect(seen[0]!.aiAccessKeyId).toBe('AKIA');
    expect(seen[0]!.aiSecretAccessKey).toBe('sk');
    expect(seen[0]!.aiBedrockApiKey).toBe('bedrock-api-key-abc');
  });

  it('returns 502 with the AWS message when the lister throws', async () => {
    const { app } = makeApp({
      testers: {
        listBedrockModels: async () => {
          throw new Error('User is not authorized to perform: bedrock:ListFoundationModels');
        },
      },
    });
    const res = await post(app, { aiRegion: 'us-east-1' });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('not authorized');
  });

  it('tolerates an empty/missing body (falls back to saved config)', async () => {
    await writeConfig({ aiProvider: 'amazon-bedrock', aiRegion: 'us-east-1' });
    const seen: DiffDadConfig[] = [];
    const { app } = makeApp({
      testers: {
        listBedrockModels: async (config) => {
          seen.push(config);
          return { models: [], region: 'us-east-1' };
        },
      },
    });
    const res = await app.request('/api/config/bedrock/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not json',
    });
    expect(res.status).toBe(200);
    expect(seen[0]!.aiRegion).toBe('us-east-1'); // from saved config
  });
});

describe('GET /api/config/aws/profiles', () => {
  it('returns the injected profile list', async () => {
    const { app } = makeApp({
      testers: {
        listAwsProfiles: async () => [{ name: 'default', region: 'us-east-1' }, { name: 'platform-dev' }],
      },
    });
    const res = await app.request('/api/config/aws/profiles');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { profiles: { name: string; region?: string }[] };
    expect(body.profiles).toEqual([{ name: 'default', region: 'us-east-1' }, { name: 'platform-dev' }]);
  });

  it('returns an empty list (200, not an error) when profile enumeration yields nothing', async () => {
    const { app } = makeApp({ testers: { listAwsProfiles: async () => [] } });
    const res = await app.request('/api/config/aws/profiles');
    expect(res.status).toBe(200);
    expect(((await res.json()) as { profiles: unknown[] }).profiles).toEqual([]);
  });
});
