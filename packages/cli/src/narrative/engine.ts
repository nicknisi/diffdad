import { rm } from 'fs/promises';
import { streamText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModelV1 } from 'ai';

export type AiChunkHandler = (delta: string) => void;
import { DEFAULT_CLI_MODELS, LOCAL_CLIS, type DiffDadConfig, type LocalCli } from '../config';
import type { DiffFile, PRMetadata } from '../github/types';
import {
  buildNarrativePrompt,
  partitionMechanicalFiles,
  type PreviousNarrativeContext,
  type PromptCapStats,
} from './prompt';
import type { NarrativeResponse } from './types';

const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const DEFAULT_OPENAI_MODEL = 'gpt-4o';
const DEFAULT_OLLAMA_MODEL = 'llama3.1';
const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434/v1';

function hasConfiguredProvider(config: DiffDadConfig): boolean {
  return config.aiProvider !== undefined;
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
  jsonSchema?: object,
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
  if (jsonSchema) args.push('--json-schema', JSON.stringify(jsonSchema));
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
  jsonSchema?: object,
): Promise<AiResult> {
  if (cli === 'claude') return callClaude(system, user, config, onChunk, jsonSchema);
  if (cli === 'pi') return callPi(system, user, config, onChunk);
  return callCodex(system, user, config, onChunk);
}

async function callLocalCli(
  system: string,
  user: string,
  config: DiffDadConfig,
  onChunk?: AiChunkHandler,
  jsonSchema?: object,
): Promise<AiResult> {
  const forced = cliOverride ?? process.env.DIFFDAD_CLI;

  if (forced) {
    if (!LOCAL_CLIS.includes(forced as LocalCli)) {
      throw new Error(`Unknown --with value: "${forced}". Use "claude", "codex", or "pi".`);
    }
    return callByCli(forced as LocalCli, system, user, config, onChunk, jsonSchema);
  }

  const order: LocalCli[] = config.defaultCli
    ? [config.defaultCli, ...LOCAL_CLIS.filter((c) => c !== config.defaultCli)]
    : [...LOCAL_CLIS];

  for (const cli of order) {
    if (await whichExists(cli)) {
      return callByCli(cli, system, user, config, onChunk, jsonSchema);
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
  jsonSchema?: object,
): Promise<AiResult> {
  if (cliOverride) {
    return callLocalCli(system, user, config, onChunk, jsonSchema);
  }

  if (!hasConfiguredProvider(config)) {
    return callLocalCli(system, user, config, onChunk, jsonSchema);
  }

  const provider = config.aiProvider ?? 'anthropic';
  const model = getModel(config);
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
    provider: `${provider} (${config.aiModel ?? 'default'})`,
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

export type NarrativeProgressHandler = (info: { delta: string; chars: number }) => void;

const DIM = '\x1b[2m';
const YELLOW = '\x1b[38;5;221m';
const RESET = '\x1b[0m';

function logPromptStats(stats: PromptCapStats, mechanicalSkipped: number): void {
  const lines: string[] = [];
  lines.push(
    `${DIM}Prompt: ${stats.narratedFileCount}/${stats.inputFileCount + mechanicalSkipped} files, ${stats.narratedLineCount.toLocaleString()}/${stats.inputLineCount.toLocaleString()} lines (caps: ${stats.perFileCap}/file, ${stats.globalCap.toLocaleString()} total)${RESET}`,
  );
  if (mechanicalSkipped > 0) {
    lines.push(`${DIM}  • Skipped ${mechanicalSkipped} mechanical file(s) (lockfiles, generated, minified)${RESET}`);
  }
  if (stats.truncatedFiles.length > 0) {
    const totalDroppedLines = stats.truncatedFiles.reduce((s, t) => s + t.linesDropped, 0);
    lines.push(
      `${YELLOW}  ⚠ Per-file cap hit on ${stats.truncatedFiles.length} file(s): ${totalDroppedLines.toLocaleString()} line(s) truncated${RESET}`,
    );
    for (const t of stats.truncatedFiles) {
      lines.push(
        `${DIM}      ${t.file}: dropped ${t.hunksDropped} hunk(s), ${t.linesDropped.toLocaleString()} line(s)${RESET}`,
      );
    }
  }
  if (stats.droppedFiles.length > 0) {
    lines.push(`${YELLOW}  ⚠ Global cap exhausted: ${stats.droppedFiles.length} file(s) dropped entirely${RESET}`);
    for (const f of stats.droppedFiles) {
      lines.push(`${DIM}      ${f}${RESET}`);
    }
  }
  for (const l of lines) console.error(`  ${l}`);
}

export async function generateNarrative(
  pr: PRMetadata,
  files: DiffFile[],
  fileTree: string[],
  config: DiffDadConfig,
  previousContext?: PreviousNarrativeContext,
  onProgress?: NarrativeProgressHandler,
): Promise<{ narrative: NarrativeResponse; provider: string }> {
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

  const MAX_RETRIES = 2;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let chars = 0;
    const onChunk: AiChunkHandler | undefined = onProgress
      ? (delta) => {
          chars += delta.length;
          onProgress({ delta, chars });
        }
      : undefined;
    const result = await callAi(config, system, user, 16384, onChunk);

    const json = extractJson(result.text);
    try {
      return { narrative: JSON.parse(json) as NarrativeResponse, provider: result.provider };
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
