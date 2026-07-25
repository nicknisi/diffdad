import { rm } from 'fs/promises';
import { streamText, wrapLanguageModel } from 'ai';
import { createAmazonBedrock } from '@ai-sdk/amazon-bedrock';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { FinishReason, LanguageModelUsage, LanguageModelV1, LanguageModelV1Middleware } from 'ai';
import { DEFAULT_CLI_MODELS, LOCAL_CLIS, type DiffDadConfig, type LocalCli } from '../config';
import { resolveBedrockCreds } from './bedrock-credentials';
import { resolveBedrockRegion, toInvokeAuth } from './bedrock-models';

export type AiChunkHandler = (delta: string) => void;
export type AiUsage = { inputTokens?: number; outputTokens?: number };
export type AiResult = { text: string; truncated: boolean; provider: string; usage?: AiUsage };
export type AiPath = 'api' | 'local-cli';

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const DEFAULT_OPENAI_MODEL = 'gpt-4o';
const DEFAULT_OLLAMA_MODEL = 'llama3.1';
const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434/v1';
// Cross-region inference profile id — current Claude Sonnet on Bedrock. Fallback only; the settings
// UI populates the model from the live account, so this applies when aiModel is unset.
const DEFAULT_BEDROCK_MODEL = 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';

let cliOverride: string | undefined;

export function setCliOverride(cli: string | undefined) {
  cliOverride = cli;
}

/**
 * If the user has an env-var API key set but didn't configure an AI provider,
 * route through the API path anyway. The local-CLI path is significantly slower
 * (Claude Code harness overhead + buffered piped stdout), so we should never
 * default to it when an API path is freely available.
 */
export function inferProviderFromEnv(): Pick<DiffDadConfig, 'aiProvider' | 'aiApiKey'> | null {
  if (process.env.ANTHROPIC_API_KEY) {
    return { aiProvider: 'anthropic', aiApiKey: process.env.ANTHROPIC_API_KEY };
  }
  if (process.env.OPENAI_API_KEY) {
    return { aiProvider: 'openai', aiApiKey: process.env.OPENAI_API_KEY };
  }
  return null;
}

/**
 * Resolves whether to take the API or local-CLI path. Priority:
 *   1. `--with=` flag (cliOverride) — explicit, wins always.
 *   2. Configured `aiProvider` — user picked an API path on the settings page.
 *   3. Configured `defaultCli` — user picked local CLI on the settings page.
 *   4. Env-inferred API key (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) — only
 *      kicks in for users who haven't expressed a preference.
 *   5. `DIFFDAD_CLI` env — legacy local-CLI fallback preference, also only
 *      kicks in when no config/API-key preference exists.
 *   6. Local CLI auto-detection as the final fallback.
 */
export function resolveAiPath(config: DiffDadConfig): { path: AiPath; effectiveConfig: DiffDadConfig } {
  if (cliOverride) return { path: 'local-cli', effectiveConfig: config };
  if (config.aiProvider !== undefined) return { path: 'api', effectiveConfig: config };
  if (config.defaultCli) return { path: 'local-cli', effectiveConfig: config };
  const inferred = inferProviderFromEnv();
  if (inferred) {
    return { path: 'api', effectiveConfig: { ...config, ...inferred } };
  }
  return { path: 'local-cli', effectiveConfig: config };
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'unknown'
  );
}

/**
 * Resolves a stable cache key segment identifying the provider+model that will
 * be used for a given config+env. Cached narratives must be keyed by this so
 * switching model (e.g. sonnet → haiku) doesn't serve stale outputs.
 */
export async function resolveProviderKey(config: DiffDadConfig): Promise<string> {
  const { path, effectiveConfig } = resolveAiPath(config);
  if (path === 'api') {
    const provider = effectiveConfig.aiProvider ?? 'anthropic';
    const model = effectiveConfig.aiModel ?? 'default';
    return slugify(`${provider}-${model}`);
  }

  const forced = (cliOverride ?? (!config.defaultCli ? process.env.DIFFDAD_CLI : undefined)) as LocalCli | undefined;
  let cli: LocalCli;
  if (forced && LOCAL_CLIS.includes(forced)) {
    cli = forced;
  } else {
    const order: LocalCli[] = config.defaultCli
      ? [config.defaultCli, ...LOCAL_CLIS.filter((c) => c !== config.defaultCli)]
      : [...LOCAL_CLIS];
    let found: LocalCli | undefined;
    for (const c of order) {
      if (await whichExists(c)) {
        found = c;
        break;
      }
    }
    cli = found ?? order[0]!;
  }
  const model = resolveCliModel(cli, config);
  return slugify(model ? `${cli}-${model}` : cli);
}

/**
 * ai@4 injects `temperature: 0` into every call when none is set, and Claude
 * models from Sonnet 5 / Opus 4.7 onward reject any non-default sampling
 * params with a 400 ("`temperature` is deprecated for this model"). We never
 * set temperature ourselves, so drop it and let the API default apply.
 */
const stripTemperature: LanguageModelV1Middleware = {
  transformParams: async ({ params }) => ({ ...params, temperature: undefined }),
};

export function getModel(config: DiffDadConfig): LanguageModelV1 {
  const provider = config.aiProvider ?? 'anthropic';

  switch (provider) {
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey: config.aiApiKey });
      return wrapLanguageModel({
        model: anthropic(config.aiModel ?? DEFAULT_ANTHROPIC_MODEL),
        middleware: stripTemperature,
      });
    }
    case 'openai': {
      const openai = createOpenAI({ apiKey: config.aiApiKey });
      return openai(config.aiModel ?? DEFAULT_OPENAI_MODEL);
    }
    case 'ollama': {
      const ollama = createOpenAI({
        baseURL: config.aiBaseUrl ?? DEFAULT_OLLAMA_BASE_URL,
        apiKey: 'ollama',
      });
      return ollama(config.aiModel ?? DEFAULT_OLLAMA_MODEL);
    }
    case 'openai-compatible': {
      const compatible = createOpenAI({
        baseURL: config.aiBaseUrl,
        apiKey: config.aiApiKey ?? 'openai-compatible',
      });
      return compatible(config.aiModel ?? DEFAULT_OPENAI_MODEL);
    }
    case 'amazon-bedrock': {
      const bedrock = createAmazonBedrock({
        // `''` (a profile-mode save clears aiRegion by storing the empty string) must become
        // undefined: the SDK treats any string as a set region and would build the malformed host
        // `bedrock-runtime..amazonaws.com` instead of falling back to AWS_REGION / its clear
        // "region is missing" error.
        region: config.aiRegion || undefined,
        // The invoke half of the lockstep choice→auth mapping in bedrock-models.ts, so "Load
        // models" and invoke can't authenticate differently. For an API key this carries a
        // bearer-injecting fetch; otherwise a credentialProvider the SDK uses over its own env.
        ...toInvokeAuth(resolveBedrockCreds(config)),
      });
      return wrapLanguageModel({
        // Bedrock-hosted Claude has the same temperature-deprecation behavior as the direct API.
        // `||` not `??`: the settings form saves '' to mean "use the default model".
        model: bedrock(config.aiModel || DEFAULT_BEDROCK_MODEL),
        middleware: stripTemperature,
      });
    }
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unsupported aiProvider: ${exhaustive as string}`);
    }
  }
}

/**
 * Fill a blank Bedrock region from the profile / ambient chain before `getModel` runs. `getModel` is a
 * synchronous factory and `createAmazonBedrock` needs region as a resolved string (unlike the raw
 * `BedrockClient`, which resolves region itself). So the invoke path resolves region here first — a
 * profile-only config then generates without the user ever typing a region. A no-op for every other
 * provider, and for a Bedrock config that already has an explicit region.
 */
export async function withResolvedBedrockRegion(config: DiffDadConfig): Promise<DiffDadConfig> {
  if (config.aiProvider !== 'amazon-bedrock' || config.aiRegion) return config;
  const region = await resolveBedrockRegion(config);
  return region ? { ...config, aiRegion: region } : config;
}

// One narrative fans out a callAi per chapter (plus the planner), and rebuilding the Bedrock model
// each time re-runs region resolution and discards the credential chain's per-instance memoization —
// re-reading ~/.aws (and re-doing SSO/STS exchanges) N+1 times per PR. Cache the model keyed by the
// fields that shape it; a settings save changes the key and so invalidates. The chain itself
// refreshes expired credentials internally, so holding one instance long-term is safe.
let bedrockModelCache: { key: string; model: LanguageModelV1 } | undefined;

async function getBedrockModel(config: DiffDadConfig): Promise<LanguageModelV1> {
  const key = [
    config.aiModel,
    config.aiRegion,
    config.aiProfile,
    config.aiAccessKeyId,
    config.aiSecretAccessKey,
    config.aiBedrockApiKey,
  ]
    .map((v) => v ?? '')
    .join('\u0000');
  if (bedrockModelCache?.key !== key) {
    bedrockModelCache = { key, model: getModel(await withResolvedBedrockRegion(config)) };
  }
  return bedrockModelCache.model;
}

async function whichExists(cmd: string): Promise<boolean> {
  try {
    const proc = Bun.spawn(['which', cmd], { stdout: 'pipe', stderr: 'pipe' });
    return (await proc.exited) === 0;
  } catch {
    return false;
  }
}

async function spawnCli(
  args: string[],
  input: string,
  onChunk?: AiChunkHandler,
): Promise<{ text: string; truncated: boolean }> {
  const proc = Bun.spawn(args, {
    stdin: new Response(input),
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const decoder = new TextDecoder();
  let text = '';
  const reader = proc.stdout.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      if (chunk.length > 0) {
        text += chunk;
        onChunk?.(chunk);
      }
    }
    const tail = decoder.decode();
    if (tail.length > 0) {
      text += tail;
      onChunk?.(tail);
    }
  } finally {
    reader.releaseLock();
  }

  const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);

  if (exitCode !== 0) {
    const msg = stderr.trim() || `${args[0]} exited with code ${exitCode}`;
    throw new Error(`${args[0]} failed: ${msg}`);
  }

  return { text, truncated: false };
}

function resolveCliModel(cli: LocalCli, config: DiffDadConfig): string | undefined {
  const envOverride = process.env[`DIFFDAD_${cli.toUpperCase()}_MODEL`];
  if (envOverride && envOverride.length > 0) return envOverride;
  const fromConfig = config.cliModels?.[cli];
  if (fromConfig && fromConfig.length > 0) return fromConfig;
  const fallback = DEFAULT_CLI_MODELS[cli];
  return fallback.length > 0 ? fallback : undefined;
}

async function callClaude(
  system: string,
  user: string,
  config: DiffDadConfig,
  onChunk?: AiChunkHandler,
): Promise<AiResult> {
  const args = [
    'claude',
    '-p',
    '--output-format',
    'text',
    '--system-prompt',
    system,
    '--tools',
    '',
    '--disable-slash-commands',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--setting-sources',
    '',
    '--no-session-persistence',
    '--exclude-dynamic-system-prompt-sections',
  ];
  const model = resolveCliModel('claude', config);
  if (model) args.push('--model', model);
  const r = await spawnCli(args, user, onChunk);
  return { ...r, provider: model ? `claude (${model})` : 'claude' };
}

async function callPi(
  system: string,
  user: string,
  config: DiffDadConfig,
  onChunk?: AiChunkHandler,
): Promise<AiResult> {
  const args = ['pi', '-p', '--system-prompt', system, '--no-tools'];
  const model = resolveCliModel('pi', config);
  if (model) args.push('--model', model);
  const r = await spawnCli(args, user, onChunk);
  return { ...r, provider: model ? `pi (${model})` : 'pi' };
}

async function callCodex(
  system: string,
  user: string,
  config: DiffDadConfig,
  onChunk?: AiChunkHandler,
): Promise<AiResult> {
  const prompt = `${system}\n\n---\n\n${user}`;
  const tmpFile = `/tmp/diffdad-codex-${Date.now()}.txt`;
  const args = ['codex', 'exec', '--skip-git-repo-check', '--ignore-rules', '-o', tmpFile];
  const model = resolveCliModel('codex', config);
  if (model) args.push('--model', model);
  try {
    const r = await spawnCli(args, prompt, onChunk);
    const output = await Bun.file(tmpFile)
      .text()
      .catch(() => r.text);
    return { text: output, truncated: false, provider: model ? `codex (${model})` : 'codex' };
  } finally {
    rm(tmpFile, { force: true }).catch(() => {});
  }
}

async function callByCli(
  cli: LocalCli,
  system: string,
  user: string,
  config: DiffDadConfig,
  onChunk?: AiChunkHandler,
): Promise<AiResult> {
  if (cli === 'claude') return callClaude(system, user, config, onChunk);
  if (cli === 'pi') return callPi(system, user, config, onChunk);
  return callCodex(system, user, config, onChunk);
}

async function callLocalCli(
  system: string,
  user: string,
  config: DiffDadConfig,
  onChunk?: AiChunkHandler,
): Promise<AiResult> {
  const forced = cliOverride ?? (!config.defaultCli ? process.env.DIFFDAD_CLI : undefined);

  if (forced) {
    if (!LOCAL_CLIS.includes(forced as LocalCli)) {
      throw new Error(`Unknown --with value: "${forced}". Use "claude", "codex", or "pi".`);
    }
    return callByCli(forced as LocalCli, system, user, config, onChunk);
  }

  const order: LocalCli[] = config.defaultCli
    ? [config.defaultCli, ...LOCAL_CLIS.filter((c) => c !== config.defaultCli)]
    : [...LOCAL_CLIS];

  for (const cli of order) {
    if (await whichExists(cli)) {
      return callByCli(cli, system, user, config, onChunk);
    }
  }

  throw new Error(
    'No AI CLI found. Install Claude Code (claude), Codex (codex), or pi, or set an API provider on the settings page.',
  );
}

/**
 * Coerces an ai@4 fullStream 'error' part into an Error that carries the
 * underlying provider message. Provider errors arrive in two shapes: an
 * APICallError instance (request-level failures) or a bare OpenAI-style error
 * object `{ message, ... }` (mid-stream error events from OpenAI-compatible
 * servers). Both must surface a readable message so the daemon can log it.
 */
function asError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === 'string') return new Error(err);
  if (
    err !== null &&
    typeof err === 'object' &&
    'message' in err &&
    typeof (err as { message: unknown }).message === 'string'
  ) {
    return new Error((err as { message: string }).message);
  }
  return new Error(JSON.stringify(err));
}

export async function callAi(
  config: DiffDadConfig,
  system: string,
  user: string,
  maxTokens?: number,
  onChunk?: AiChunkHandler,
): Promise<AiResult> {
  const { path, effectiveConfig } = resolveAiPath(config);
  if (path === 'local-cli') {
    return callLocalCli(system, user, effectiveConfig, onChunk);
  }

  const provider = effectiveConfig.aiProvider ?? 'anthropic';
  // Bedrock invoke path needs region as a resolved string; fill it from the profile/chain when blank
  // (cached across calls — see getBedrockModel).
  const model = provider === 'amazon-bedrock' ? await getBedrockModel(effectiveConfig) : getModel(effectiveConfig);
  const cacheSystem = provider === 'anthropic';
  const stream = streamText({
    model,
    messages: [
      {
        role: 'system',
        content: system,
        ...(cacheSystem
          ? {
              experimental_providerMetadata: {
                anthropic: { cacheControl: { type: 'ephemeral' } },
              },
            }
          : {}),
      },
      { role: 'user', content: user },
    ],
    maxTokens,
    // Defense-in-depth: the load-bearing error handling is the 'error' part
    // thrown out of the fullStream loop below. This no-op just suppresses ai@4's
    // default onError (a console.error) so the same failure isn't logged twice.
    onError: () => {},
  });

  // Iterate fullStream (not textStream): ai@4's textStream never terminates on
  // an API/stream error, so awaiting stream.finishReason/stream.usage afterward
  // hangs forever. fullStream surfaces an 'error' part we can throw on, plus the
  // terminal 'finish' part carrying finishReason + usage — so we never await the
  // (potentially dangling) stream.finishReason/stream.usage promises.
  let text = '';
  let finishReason: FinishReason | undefined;
  let usage: LanguageModelUsage | undefined;
  for await (const part of stream.fullStream) {
    if (part.type === 'text-delta') {
      if (part.textDelta.length === 0) continue;
      text += part.textDelta;
      onChunk?.(part.textDelta);
    } else if (part.type === 'error') {
      throw asError(part.error);
    } else if (part.type === 'finish') {
      finishReason = part.finishReason;
      usage = part.usage;
    }
  }

  if (text.length === 0) {
    throw new Error(
      `AI returned an empty response (finishReason: ${finishReason ?? 'unknown'}) — the model may have refused or the provider returned no content`,
    );
  }

  return {
    text,
    truncated: finishReason === 'length',
    provider: `${provider} (${effectiveConfig.aiModel ?? 'default'})`,
    usage: usage ? { inputTokens: usage.promptTokens, outputTokens: usage.completionTokens } : undefined,
  };
}
