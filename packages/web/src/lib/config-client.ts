import type { AccentId } from './accents';
import type { Theme } from './theme';

/**
 * The browser's view of the shared config surface (Phase 1: `GET/PUT /api/config`,
 * `POST /api/config/test`). These wire types mirror the server's `RedactedConfig` / `ConfigResponse`
 * in `packages/cli/src/config-api.ts` — the two packages are separate workspaces, so the shape is
 * duplicated here rather than imported. Secrets are write-only: GET reduces them to `*Set` booleans,
 * PUT accepts a value (or `''` to clear), and the browser never holds the raw secret.
 */

export type StoryStructure = 'chapters' | 'linear' | 'outline';
export type LayoutMode = 'toc' | 'linear';
export type DisplayDensity = 'comfortable' | 'compact';
export type NarrationDensity = 'terse' | 'normal' | 'verbose';
export type AiProvider = 'anthropic' | 'openai' | 'openai-compatible' | 'ollama';
export type LocalCli = 'claude' | 'codex' | 'pi';
export type GitHubTokenSource = 'env' | 'gh' | 'config' | null;

/** Redacted config wire shape — secrets reduced to `*Set` booleans (mirror of the server type). */
export interface RedactedConfig {
  githubTokenSet: boolean;
  aiApiKeySet: boolean;
  aiProvider?: AiProvider;
  aiModel?: string;
  aiBaseUrl?: string;
  defaultCli?: LocalCli;
  cliModels?: Partial<Record<LocalCli, string>>;
  storyStructure?: StoryStructure;
  layoutMode?: LayoutMode;
  displayDensity?: DisplayDensity;
  defaultNarrationDensity?: NarrationDensity;
  clusterBots?: boolean;
  theme?: Theme;
  accent?: AccentId;
  pollIntervalMs?: number;
}

/** Effective GitHub state — not "is a token in the file" but whether one resolves (env → gh → config). */
export interface GitHubState {
  active: boolean;
  source: GitHubTokenSource;
  warning?: string;
}

export interface ConfigResponse {
  config: RedactedConfig;
  github: GitHubState;
}

/** A PUT merge patch: any subset of writable keys. A secret set to `''` clears it; omitted = unchanged. */
export type ConfigPatch = Partial<{
  githubToken: string;
  aiProvider: AiProvider;
  aiApiKey: string;
  aiModel: string;
  aiBaseUrl: string;
  defaultCli: LocalCli;
  cliModels: Partial<Record<LocalCli, string>>;
  storyStructure: StoryStructure;
  layoutMode: LayoutMode;
  displayDensity: DisplayDensity;
  defaultNarrationDensity: NarrationDensity;
  clusterBots: boolean;
  theme: Theme;
  accent: AccentId;
  pollIntervalMs: number;
}>;

/** A 400 from PUT: per-field validation messages keyed by patch key (`_` for the whole body). */
export interface SaveError {
  fields: Record<string, string>;
}

/** Narrow a thrown value to a `SaveError` (a 400 with a `fields` map) vs. any other failure. */
export function isSaveError(err: unknown): err is SaveError {
  return typeof err === 'object' && err !== null && 'fields' in err;
}

export type TestRequest =
  | { kind: 'github'; token?: string }
  | {
      kind: 'ai';
      aiProvider?: AiProvider;
      aiApiKey?: string;
      aiModel?: string;
      aiBaseUrl?: string;
      defaultCli?: LocalCli;
    };

export interface TestResult {
  ok: boolean;
  detail: string;
}

/** Bootstrap read — the single source of prefs for both PR and command-center modes. */
export async function fetchConfig(): Promise<ConfigResponse> {
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error(`GET /api/config failed: ${res.status}`);
  return (await res.json()) as ConfigResponse;
}

/**
 * Persist a merge patch. On a 400 the promise rejects with a {@link SaveError} carrying the server's
 * per-field messages; any other non-2xx rejects with a plain `Error`. On success the fresh
 * `ConfigResponse` (including the possibly-updated `github` state) is returned.
 */
export async function saveConfig(patch: ConfigPatch): Promise<ConfigResponse> {
  const res = await fetch('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { fields?: Record<string, string>; error?: string };
    const fields = body.fields ?? (body.error ? { _: body.error } : { _: 'invalid config' });
    throw { fields } satisfies SaveError;
  }
  if (!res.ok) throw new Error(`PUT /api/config failed: ${res.status}`);
  return (await res.json()) as ConfigResponse;
}

/**
 * Test a candidate GitHub token or AI config without saving it. The endpoint answers 200 for both
 * pass and fail (the outcome rides `ok`); a non-200 is an unexpected transport error, folded into a
 * failing result so callers render one inline surface.
 */
export async function testConnection(body: TestRequest): Promise<TestResult> {
  const res = await fetch('/api/config/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return { ok: false, detail: `test failed: HTTP ${res.status}` };
  return (await res.json()) as TestResult;
}
