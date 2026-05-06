import { rm } from 'fs/promises';
import { streamText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV1 } from 'ai';
import { DEFAULT_CLI_MODELS, LOCAL_CLIS, type DiffDadConfig, type LocalCli } from '../config';

export type AiChunkHandler = (delta: string) => void;
export type AiUsage = { inputTokens?: number; outputTokens?: number };
export type AiResult = { text: string; truncated: boolean; provider: string; usage?: AiUsage };
export type AiPath = 'api' | 'local-cli';

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const DEFAULT_OPENAI_MODEL = 'gpt-4o';
const DEFAULT_OLLAMA_MODEL = 'llama3.1';
const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434/v1';

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
 *   2. Configured `aiProvider` — user picked an API path in `dad config`.
 *   3. Configured `defaultCli` — user picked local CLI in `dad config`.
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

export function getModel(config: DiffDadConfig): LanguageModelV1 {
  const provider = config.aiProvider ?? 'anthropic';

  switch (provider) {
    case 'anthropic': {
      const anthropic = createAnthropic({ apiKey: config.aiApiKey });
      return anthropic(config.aiModel ?? DEFAULT_ANTHROPIC_MODEL);
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
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unsupported aiProvider: ${exhaustive as string}`);
    }
  }
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
    'No AI CLI found. Install Claude Code (claude), Codex (codex), or pi, or run `dad config` to set an API provider.',
  );
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
  const model = getModel(effectiveConfig);
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
  });

  let text = '';
  for await (const delta of stream.textStream) {
    if (delta.length === 0) continue;
    text += delta;
    onChunk?.(delta);
  }
  const finishReason = await stream.finishReason;
  const usage = await stream.usage.catch(() => undefined);
  return {
    text,
    truncated: finishReason === 'length',
    provider: `${provider} (${effectiveConfig.aiModel ?? 'default'})`,
    usage: usage ? { inputTokens: usage.promptTokens, outputTokens: usage.completionTokens } : undefined,
  };
}
