import { rm } from 'fs/promises';
import { streamText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV1 } from 'ai';
import { DEFAULT_CLI_MODELS, LOCAL_CLIS, type DiffDadConfig, type LocalCli } from '../config';
import type { DiffFile, PRMetadata } from '../github/types';
import { buildNarrativePrompt, type PreviousNarrativeContext, type PromptCapStats } from './prompt';
import { partitionMechanicalFiles } from './diff-filter';
import { normalizeNarrative, type NarrativeResponse } from './types';

export type AiChunkHandler = (delta: string) => void;

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const DEFAULT_OPENAI_MODEL = 'gpt-4o';
const DEFAULT_OLLAMA_MODEL = 'llama3.1';
const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434/v1';

const NARRATIVE_MAX_TOKENS = 16384;

/**
 * If the user has an env-var API key set but didn't run `dad config`, route
 * through the API path anyway. The local-CLI path is significantly slower
 * (Claude Code harness overhead + buffered piped stdout), so we should never
 * default to it when an API path is freely available.
 *
 * Returns the inferred provider config, or null if no env key is set.
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

/** Resolved AI path the engine will take for a given config + env. */
export type AiPath = 'api' | 'local-cli';

/**
 * Resolves whether to take the API or local-CLI path. Priority:
 *   1. `--with=` flag (cliOverride) — explicit, wins always.
 *   2. `DIFFDAD_CLI` env — explicit, forces local CLI.
 *   3. Configured `aiProvider` — user picked an API path in `dad config`.
 *   4. Configured `defaultCli` — user picked local CLI in `dad config`.
 *   5. Env-inferred API key (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`) — only
 *      kicks in for users who haven't expressed a preference. Local CLI is
 *      ~5-10× slower, so we shouldn't default to it when an API path is
 *      freely available.
 *   6. Local CLI as the final fallback.
 */
export function resolveAiPath(config: DiffDadConfig): { path: AiPath; effectiveConfig: DiffDadConfig } {
  if (cliOverride) return { path: 'local-cli', effectiveConfig: config };
  if (process.env.DIFFDAD_CLI) return { path: 'local-cli', effectiveConfig: config };
  if (config.aiProvider !== undefined) return { path: 'api', effectiveConfig: config };
  if (config.defaultCli) return { path: 'local-cli', effectiveConfig: config };
  const inferred = inferProviderFromEnv();
  if (inferred) {
    return { path: 'api', effectiveConfig: { ...config, ...inferred } };
  }
  return { path: 'local-cli', effectiveConfig: config };
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

export type AiResult = { text: string; truncated: boolean; provider: string };

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

  const forced = (cliOverride ?? process.env.DIFFDAD_CLI) as LocalCli | undefined;
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

let cliOverride: string | undefined;

export function setCliOverride(cli: string) {
  cliOverride = cli;
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
  const forced = cliOverride ?? process.env.DIFFDAD_CLI;

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
  return {
    text,
    truncated: finishReason === 'length',
    provider: `${provider} (${effectiveConfig.aiModel ?? 'default'})`,
  };
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return trimmed;

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

/**
 * Best-effort partial JSON parser. Walks the prefix and emits a JSON object
 * with whatever values have closed cleanly. Used to render incremental
 * narrative updates while the LLM is still streaming.
 *
 * Strategy: try fast-path parsing the prefix as-is, with two fallbacks if it
 * fails:
 *   1. Close any open string + add closing braces/brackets for the open stack.
 *      Works when we're mid-value (e.g. inside a string).
 *   2. Truncate to the last "safe cut" — the position just before a comma or
 *      after a close brace/bracket — then re-close the stack. Works when we're
 *      mid-key (e.g. \`...,"tld\` with no colon yet).
 * Returns the parsed object from the first strategy that succeeds, or null.
 */
export function tryParsePartialJson(text: string): unknown | null {
  const startIdx = text.indexOf('{');
  if (startIdx === -1) return null;
  const body = text.slice(startIdx);

  try {
    return JSON.parse(body);
  } catch {
    // fallthrough
  }

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  /** Position (exclusive end) where we could safely truncate the body. */
  let lastSafeCut = -1;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') {
      stack.pop();
      // Right after a close, safe to cut here (exclusive end).
      lastSafeCut = i + 1;
    } else if (ch === ',') {
      // Right before a comma, safe to cut. We want the body up to but not
      // including the comma so the closing brace/bracket comes right after the
      // last complete pair.
      lastSafeCut = i;
    }
  }

  // Strategy 1: close open string, then close the open stack.
  let candidate1 = body;
  if (inString) candidate1 += '"';
  const stack1 = [...stack];
  while (stack1.length > 0) candidate1 += stack1.pop();
  try {
    return JSON.parse(candidate1);
  } catch {
    // fallthrough
  }

  // Strategy 2: truncate to last safe cut, recompute the open stack at that
  // position, then close.
  if (lastSafeCut > 0) {
    const stack2: string[] = [];
    let inStr2 = false;
    let esc2 = false;
    for (let i = 0; i < lastSafeCut; i++) {
      const ch = body[i]!;
      if (esc2) {
        esc2 = false;
        continue;
      }
      if (inStr2) {
        if (ch === '\\') esc2 = true;
        else if (ch === '"') inStr2 = false;
        continue;
      }
      if (ch === '"') inStr2 = true;
      else if (ch === '{') stack2.push('}');
      else if (ch === '[') stack2.push(']');
      else if (ch === '}' || ch === ']') stack2.pop();
    }
    let candidate2 = body.slice(0, lastSafeCut);
    while (stack2.length > 0) candidate2 += stack2.pop();
    try {
      return JSON.parse(candidate2);
    } catch {
      return null;
    }
  }

  return null;
}

export type NarrativeProgressHandler = (info: { delta: string; chars: number }) => void;
export type NarrativePartialHandler = (partial: NarrativeResponse) => void;

const DIM = '\x1b[2m';
const YELLOW = '\x1b[38;5;221m';
const RESET = '\x1b[0m';

function logPromptStats(stats: PromptCapStats, mechanicalSkipped: number): void {
  const lines: string[] = [];
  const totalFiles = stats.inputFileCount + mechanicalSkipped;
  const anythingCapped = stats.truncatedFiles.length > 0 || stats.droppedFiles.length > 0;

  // Plain summary when nothing was cut: just N files, M lines.
  if (!anythingCapped) {
    const fileSummary =
      mechanicalSkipped > 0
        ? `${stats.narratedFileCount} of ${totalFiles} files (${mechanicalSkipped} mechanical skipped)`
        : `${stats.narratedFileCount} ${stats.narratedFileCount === 1 ? 'file' : 'files'}`;
    const lineLabel = stats.narratedLineCount === 1 ? 'line' : 'lines';
    lines.push(`${DIM}Prompt: ${fileSummary}, ${stats.narratedLineCount.toLocaleString()} ${lineLabel}${RESET}`);
    for (const l of lines) console.error(`  ${l}`);
    return;
  }

  // Caps fired — show what was cut and surface the cap values inline so the
  // user understands why.
  lines.push(
    `${DIM}Prompt: ${stats.narratedFileCount}/${totalFiles} files, ${stats.narratedLineCount.toLocaleString()}/${stats.inputLineCount.toLocaleString()} lines${RESET}`,
  );
  if (mechanicalSkipped > 0) {
    lines.push(`${DIM}  • Skipped ${mechanicalSkipped} mechanical file(s) (lockfiles, generated, minified)${RESET}`);
  }
  if (stats.truncatedFiles.length > 0) {
    const totalDroppedLines = stats.truncatedFiles.reduce((s, t) => s + t.linesDropped, 0);
    lines.push(
      `${YELLOW}  ⚠ Per-file cap (${stats.perFileCap}) hit on ${stats.truncatedFiles.length} file(s): ${totalDroppedLines.toLocaleString()} line(s) truncated${RESET}`,
    );
    for (const t of stats.truncatedFiles) {
      lines.push(
        `${DIM}      ${t.file}: dropped ${t.hunksDropped} hunk(s), ${t.linesDropped.toLocaleString()} line(s)${RESET}`,
      );
    }
  }
  if (stats.droppedFiles.length > 0) {
    lines.push(
      `${YELLOW}  ⚠ Global cap (${stats.globalCap.toLocaleString()}) exhausted: ${stats.droppedFiles.length} file(s) dropped entirely${RESET}`,
    );
    for (const f of stats.droppedFiles) {
      lines.push(`${DIM}      ${f}${RESET}`);
    }
  }
  for (const l of lines) console.error(`  ${l}`);
}

export type NarrativeGenerationOptions = {
  /** Fires per chunk of streamed model output, with the cumulative char count. */
  onProgress?: NarrativeProgressHandler;
  /** Fires whenever a parseable partial of the JSON narrative is available. */
  onPartial?: NarrativePartialHandler;
};

export type NarrativeGenerationResult = {
  narrative: NarrativeResponse;
  provider: string;
};

export async function generateNarrative(
  pr: PRMetadata,
  files: DiffFile[],
  fileTree: string[],
  config: DiffDadConfig,
  previousContext?: PreviousNarrativeContext,
  options: NarrativeGenerationOptions = {},
): Promise<NarrativeGenerationResult> {
  const { narrate, skipped } = partitionMechanicalFiles(files);
  const { system, user, stats } = buildNarrativePrompt({
    title: pr.title,
    description: pr.body,
    labels: pr.labels,
    files: narrate,
    fileTree,
    skippedFiles: skipped.map((f) => f.file),
    previousContext,
  });
  logPromptStats(stats, skipped.length);

  const debugPerf = Boolean(process.env.DIFFDAD_DEBUG_PERF);
  const startedAt = Date.now();

  const MAX_RETRIES = 2;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let chars = 0;
    let buffer = '';
    let lastEmittedHash = '';
    let firstChunkAt: number | undefined;
    let firstPartialAt: number | undefined;

    const emitPartialIfChanged = (onPartial: NarrativePartialHandler) => {
      const parsed = tryParsePartialJson(buffer);
      if (!parsed) return;
      const partial = normalizeNarrative(parsed);
      // Dedupe on total parseable string length so mid-string growth — a
      // chapter's prose getting longer, a concern's question filling in —
      // re-emits even when array counts stop changing.
      const planChars = partial.readingPlan.reduce((s, p) => s + p.step.length + (p.why?.length ?? 0), 0);
      const concernChars = partial.concerns.reduce((s, c) => s + c.question.length + c.why.length, 0);
      const chapterChars = partial.chapters.reduce(
        (s, c) => s + c.title.length + c.summary.length + c.whyMatters.length,
        0,
      );
      const hash = `${partial.title.length}|${partial.tldr.length}|${partial.verdict}|${partial.readingPlan.length}|${partial.concerns.length}|${partial.chapters.length}|${planChars}|${concernChars}|${chapterChars}`;
      if (hash === lastEmittedHash) return;
      lastEmittedHash = hash;
      if (firstPartialAt === undefined) firstPartialAt = Date.now();
      onPartial(partial);
    };

    const onChunk: AiChunkHandler | undefined =
      options.onProgress || options.onPartial || debugPerf
        ? (delta) => {
            chars += delta.length;
            buffer += delta;
            if (firstChunkAt === undefined) firstChunkAt = Date.now();
            options.onProgress?.({ delta, chars });
            if (options.onPartial) emitPartialIfChanged(options.onPartial);
          }
        : undefined;

    const result = await callAi(config, system, user, NARRATIVE_MAX_TOKENS, onChunk);

    const json = extractJson(result.text);
    try {
      const parsed = JSON.parse(json);
      const narrative = normalizeNarrative(parsed);
      if (debugPerf) {
        const { path } = resolveAiPath(config);
        const fmt = (t: number | undefined) => (t === undefined ? '-' : `${((t - startedAt) / 1000).toFixed(1)}s`);
        const total = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.error(
          `Narrative perf: path=${path} provider="${result.provider}" firstChunk=${fmt(firstChunkAt)} firstPartial=${fmt(firstPartialAt)} total=${total}s chapters=${narrative.chapters.length} chars=${chars}`,
        );
      }
      return { narrative, provider: result.provider };
    } catch (err) {
      if (result.truncated && attempt < MAX_RETRIES) {
        console.log(`Narrative truncated (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying...`);
        continue;
      }
      throw new Error(
        `Failed to parse narrative JSON: ${(err as Error).message}${result.truncated ? " (response was truncated — PR may be too large for the model's output limit)" : ''}`,
      );
    }
  }
  throw new Error('Unreachable');
}
