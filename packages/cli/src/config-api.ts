import type { Hono } from 'hono';
import { z } from 'zod';
import { type GitHubTokenSource, resolveGitHubTokenWithSource } from './auth';
import { type DiffDadConfig, readConfig, writeConfig } from './config';
import { GitHubClient } from './github/client';
import type { Broadcast } from './mcp/broadcast';
import { type AwsProfile, listAwsProfiles as defaultListAwsProfiles } from './narrative/aws-profiles';
import { type BedrockModelOption, listBedrockModels as defaultListBedrockModels } from './narrative/bedrock-models';
import { callAi } from './narrative/engine';

/**
 * The single owner of the config wire format. Both HTTP servers (`createServer` for a single PR,
 * `createDaemonApp` for the daemon) register these routes, and the SSE `config` event reuses the
 * exact same response object — so redaction can never disagree across those three paths.
 *
 * Secrets (`githubToken`, `aiApiKey`) are write-only: GET and every broadcast reduce them to
 * `*Set` booleans; PUT accepts a new value, an empty string clears, and an omitted key leaves the
 * stored secret untouched (the browser never holds the raw value, so it cannot echo one back).
 */

/** Wire shape sent to the browser — secrets reduced to flags. */
export interface RedactedConfig extends Omit<
  DiffDadConfig,
  'githubToken' | 'aiApiKey' | 'aiSecretAccessKey' | 'aiBedrockApiKey'
> {
  githubTokenSet: boolean;
  aiApiKeySet: boolean;
  aiSecretAccessKeySet: boolean;
  aiBedrockApiKeySet: boolean;
}

export interface ConfigResponse {
  config: RedactedConfig;
  /** Effective GitHub state — not just "is a token in the file"; the token may come from env or gh. */
  github: { active: boolean; source: GitHubTokenSource; warning?: string };
}

// PUT body: a partial merge patch. Secrets: a string sets, '' clears, omitted leaves unchanged.
// `.strict()` rejects unknown keys with a 400 so typos / stale clients surface instead of silently
// dropping fields.
export const configPatchSchema = z
  .object({
    githubToken: z.string(),
    aiProvider: z.enum(['anthropic', 'openai', 'openai-compatible', 'ollama', 'amazon-bedrock']),
    aiApiKey: z.string(),
    aiModel: z.string(),
    aiBaseUrl: z.string(),
    aiRegion: z.string(),
    aiProfile: z.string(),
    aiAccessKeyId: z.string(),
    aiSecretAccessKey: z.string(),
    aiBedrockApiKey: z.string(),
    defaultCli: z.enum(['claude', 'codex', 'pi']),
    cliModels: z.record(z.enum(['claude', 'codex', 'pi']), z.string()),
    storyStructure: z.enum(['chapters', 'linear', 'outline']),
    layoutMode: z.enum(['toc', 'linear']),
    displayDensity: z.enum(['comfortable', 'compact']),
    defaultNarrationDensity: z.enum(['terse', 'normal', 'verbose']),
    clusterBots: z.boolean(),
    theme: z.enum(['light', 'dark', 'auto']),
    accent: z.enum(['classic', 'paprika', 'tomato', 'forest', 'plum', 'sky', 'dadcore']),
    pollIntervalMs: z.number().int().min(10_000).max(3_600_000),
  })
  .partial()
  .strict();

export type ConfigPatch = z.infer<typeof configPatchSchema>;

/**
 * Daemon-only re-wire hook. Called AFTER the new config is persisted, with the previous and next
 * config, so the daemon can swap its GitHub wiring / restart the poller when a relevant key changed.
 * Returns the effective `githubActive` so the PUT response tells the saving tab the new state.
 * The PR server omits it (persist-only).
 */
export type OnConfigChange = (prev: DiffDadConfig, next: DiffDadConfig) => Promise<{ githubActive: boolean }>;

// The candidate fields the test/list seams accept and overlay on the saved config (undefined =
// keep saved). One list per endpoint, derived not hand-copied, so a new field (e.g. a session
// token) can't be added to one seam and silently ignored by the other — that failure mode is
// invisible: the test would quietly run against the stale saved value.
const BEDROCK_OVERLAY_KEYS = [
  'aiRegion',
  'aiProfile',
  'aiAccessKeyId',
  'aiSecretAccessKey',
  'aiBedrockApiKey',
] as const;
const AI_TEST_OVERLAY_KEYS = [
  'aiProvider',
  'aiApiKey',
  'aiModel',
  'aiBaseUrl',
  'defaultCli',
  ...BEDROCK_OVERLAY_KEYS,
] as const;

type OverlayBody<K extends keyof DiffDadConfig> = Partial<Pick<DiffDadConfig, K>>;

/** Overlay the body's defined candidate keys on the saved config. */
function overlayDefined<K extends keyof DiffDadConfig>(
  saved: DiffDadConfig,
  body: OverlayBody<K>,
  keys: readonly K[],
): DiffDadConfig {
  const overlay: DiffDadConfig = { ...saved };
  for (const key of keys) {
    const value = body[key];
    if (value !== undefined) (overlay as Record<string, unknown>)[key] = value;
  }
  return overlay;
}

const SECRET_KEYS = ['githubToken', 'aiApiKey', 'aiSecretAccessKey', 'aiBedrockApiKey'] as const;
type SecretKey = (typeof SECRET_KEYS)[number];
function isSecretKey(key: string): key is SecretKey {
  return (SECRET_KEYS as readonly string[]).includes(key);
}

/** Reduce a stored config to its redacted wire shape (secrets → `*Set` booleans). */
export function redactConfig(config: DiffDadConfig): RedactedConfig {
  const { githubToken, aiApiKey, aiSecretAccessKey, aiBedrockApiKey, ...rest } = config;
  return {
    ...rest,
    githubTokenSet: typeof githubToken === 'string' && githubToken.length > 0,
    aiApiKeySet: typeof aiApiKey === 'string' && aiApiKey.length > 0,
    aiSecretAccessKeySet: typeof aiSecretAccessKey === 'string' && aiSecretAccessKey.length > 0,
    aiBedrockApiKeySet: typeof aiBedrockApiKey === 'string' && aiBedrockApiKey.length > 0,
  };
}

/** Apply a validated merge patch: omitted keys unchanged; a secret set to '' clears it. */
function mergeConfig(prev: DiffDadConfig, patch: ConfigPatch): DiffDadConfig {
  const next: DiffDadConfig = { ...prev };
  for (const [key, value] of Object.entries(patch) as [keyof DiffDadConfig, unknown][]) {
    if (isSecretKey(key) && value === '') {
      delete next[key];
    } else {
      // The zod schema has already narrowed each value to its declared type.
      (next as Record<string, unknown>)[key] = value;
    }
  }
  return next;
}

/** Injectable connection testers — real implementations shell out / hit AWS; tests fake them. */
export interface ConfigRouteTesters {
  testGitHub?: (token: string) => Promise<{ ok: boolean; detail: string }>;
  testAi?: (config: DiffDadConfig) => Promise<{ ok: boolean; detail: string }>;
  listBedrockModels?: (config: DiffDadConfig) => Promise<{ models: BedrockModelOption[]; region: string | undefined }>;
  listAwsProfiles?: () => Promise<AwsProfile[]>;
}

/** Injectable effective-token resolver (default probes env → gh → config); tests fake it. */
export type ResolveGitHub = () => Promise<{ token: string | null; source: GitHubTokenSource }>;

const AI_TEST_TIMEOUT_MS = 15_000;

const defaultTestGitHub: NonNullable<ConfigRouteTesters['testGitHub']> = async (token) => {
  try {
    const { login } = await new GitHubClient(token).whoAmI();
    return { ok: true, detail: `authenticated as ${login}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
};

const defaultTestAi: NonNullable<ConfigRouteTesters['testAi']> = async (config) => {
  try {
    const result = await Promise.race([
      callAi(config, 'Reply with the word ok.', 'ping', 16),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`AI did not respond within ${AI_TEST_TIMEOUT_MS / 1000}s`)),
          AI_TEST_TIMEOUT_MS,
        ),
      ),
    ]);
    const detail = result.text.trim();
    return { ok: true, detail: detail.length > 0 ? detail : 'ok' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
};

// PUTs are serialized through this module-level chain: a read-merge-write over one JSON file would
// otherwise drop keys under concurrent saves from two tabs. Each task runs after the previous SETTLES;
// the chain itself never stays rejected (errors ride the returned promise, not the chain).
let writeQueue: Promise<unknown> = Promise.resolve();
function serializeWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(task, task);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function flattenIssues(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : '_';
    if (!(path in fields)) fields[path] = issue.message;
  }
  return fields;
}

/**
 * Register the shared config surface on a Hono app:
 *   GET  /api/config        — redacted config + effective GitHub state
 *   PUT  /api/config        — merge-patch; daemon re-wires via `onConfigChange`; returns ConfigResponse
 *   POST /api/config/test   — test a candidate GitHub token or AI config without saving (always 200)
 *
 * Must be registered before a static catch-all (same constraint as `/api/narrative`).
 */
export function registerConfigRoutes(
  app: Hono,
  opts: {
    broadcast: Broadcast;
    onConfigChange?: OnConfigChange;
    testers?: ConfigRouteTesters;
    resolveGitHub?: ResolveGitHub;
  },
): void {
  const resolveGitHub: ResolveGitHub = opts.resolveGitHub ?? (() => resolveGitHubTokenWithSource());
  const testGitHub = opts.testers?.testGitHub ?? defaultTestGitHub;
  const testAi = opts.testers?.testAi ?? defaultTestAi;
  const listBedrockModels = opts.testers?.listBedrockModels ?? defaultListBedrockModels;
  const listAwsProfiles = opts.testers?.listAwsProfiles ?? defaultListAwsProfiles;

  // Effective GitHub state rides every response. `active`/`source` come from probing env → gh →
  // config; when the daemon hook ran, its authoritative `githubActive` overrides (both derive from
  // the same resolution, so they agree — the override just avoids trusting a second probe).
  async function buildResponse(
    config: DiffDadConfig,
    override?: { githubActive: boolean; warning?: string },
  ): Promise<ConfigResponse> {
    const { token, source } = await resolveGitHub();
    const active = override ? override.githubActive : token !== null;
    return {
      config: redactConfig(config),
      github: { active, source: active ? source : null, ...(override?.warning ? { warning: override.warning } : {}) },
    };
  }

  app.get('/api/config', async (c) => {
    const config = await readConfig();
    return c.json(await buildResponse(config));
  });

  app.put('/api/config', async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }

    const parsed = configPatchSchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: 'invalid config', fields: flattenIssues(parsed.error) }, 400);
    }

    // Read-merge-write serialized so racing tab saves of disjoint keys can't lose an update.
    let prev: DiffDadConfig;
    let next: DiffDadConfig;
    try {
      ({ prev, next } = await serializeWrite(async () => {
        const current = await readConfig();
        const merged = mergeConfig(current, parsed.data);
        await writeConfig(merged);
        return { prev: current, next: merged };
      }));
    } catch (err) {
      // writeConfig I/O failure: nothing persisted downstream, no broadcast, wiring untouched.
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
    }

    // The config is already persisted. If the daemon re-wire hook throws (e.g. `gh` missing), don't
    // fail the save — respond 200 with a warning and the effective state we can still observe.
    let override: { githubActive: boolean; warning?: string } | undefined;
    if (opts.onConfigChange) {
      try {
        const { githubActive } = await opts.onConfigChange(prev, next);
        override = { githubActive };
      } catch (err) {
        override = { githubActive: false, warning: err instanceof Error ? err.message : String(err) };
      }
    }

    const response = await buildResponse(next, override);
    // Same object the PUT returns — so a token can never leak into an open tab's SSE stream.
    opts.broadcast('config', response);
    return c.json(response);
  });

  app.post('/api/config/test', async (c) => {
    let body: { kind?: string; token?: string } & OverlayBody<(typeof AI_TEST_OVERLAY_KEYS)[number]>;
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }

    if (body.kind === 'github') {
      // Omitted token → test the effective one (env → gh → config).
      const token = body.token && body.token.length > 0 ? body.token : (await resolveGitHub()).token;
      if (!token) return c.json({ ok: false, detail: 'no GitHub token to test' });
      return c.json(await testGitHub(token));
    }

    if (body.kind === 'ai') {
      // Overlay the candidate fields on the saved config, then run one live call.
      return c.json(await testAi(overlayDefined(await readConfig(), body, AI_TEST_OVERLAY_KEYS)));
    }

    return c.json({ error: `unknown test kind: ${body.kind ?? '(none)'}` }, 400);
  });

  // List available Bedrock text models (foundation + inference profiles). Overlays candidate
  // region/creds on the saved config so the UI can list BEFORE saving (same seam as /config/test).
  // Failure returns 502 with the AWS message — the contract chose "block until fixed" (no free-text
  // fallback), so the UI surfaces this and cannot proceed.
  app.post('/api/config/bedrock/models', async (c) => {
    let body: OverlayBody<(typeof BEDROCK_OVERLAY_KEYS)[number]>;
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      body = {};
    }

    const overlay = overlayDefined(await readConfig(), body, BEDROCK_OVERLAY_KEYS);

    try {
      // listBedrockModels returns { models, region } — pass it straight through so the UI can prefill
      // the region field with what the SDK actually resolved (from the profile / chain when blank).
      return c.json(await listBedrockModels(overlay));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // This path was silent before — a hang or AWS error left no trace in the daemon log.
      console.error(`  \x1b[38;5;204m✗\x1b[0m Bedrock model list failed: ${msg}`);
      return c.json({ error: msg }, 502);
    }
  });

  // List the AWS profiles on this machine (name + region) so the Bedrock settings form can offer a
  // dropdown instead of a free-text profile field. Never fails — an unreadable ~/.aws yields [].
  app.get('/api/config/aws/profiles', async (c) => {
    return c.json({ profiles: await listAwsProfiles() });
  });
}
