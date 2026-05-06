import type { DiffDadConfig } from '../config';
import type { DiffFile, PRComment, PRMetadata } from '../github/types';
import { buildNarrativePrompt, type PreviousNarrativeContext, type PromptCapStats } from './prompt';
import { partitionMechanicalFiles } from './diff-filter';
import { normalizeNarrative, type NarrativeChapter, type NarrativeResponse } from './types';
import { formatViolation, validateNarrative } from './validator';
import { callAi as _callAi, resolveAiPath, type AiChunkHandler } from './ai-runtime';
import { extractJson, tryParsePartialJson } from './json-parse';
import { computeHints } from './hints';
import { runPlanner, validatePlan, formatPlanViolation } from './planner';
import { writeChapter, buildSuppressedChapter } from './writer';
import type { Plan, PlanTheme } from './plan-types';
import { cachePlan, getCachedPlan } from './cache';

// Re-exports kept for backward compatibility with cli.ts, server.ts, recap/, eval/, tests.
export {
  callAi,
  inferProviderFromEnv,
  resolveAiPath,
  resolveProviderKey,
  setCliOverride,
  getModel,
  type AiChunkHandler,
  type AiPath,
  type AiResult,
  type AiUsage,
} from './ai-runtime';
export { extractJson, tryParsePartialJson } from './json-parse';

const NARRATIVE_MAX_TOKENS = 16384;
const SMALL_PR_HUNK_THRESHOLD = 3;
const DEFAULT_WRITER_CONCURRENCY = 4;

export type NarrativeProgressHandler = (info: { delta: string; chars: number }) => void;
export type NarrativePartialHandler = (partial: NarrativeResponse) => void;
export type PlanReadyHandler = (plan: Plan) => void;
export type ChapterReadyHandler = (info: { themeId: string; index: number; chapter: NarrativeChapter }) => void;

const DIM = '\x1b[2m';
const YELLOW = '\x1b[38;5;221m';
const RESET = '\x1b[0m';

function logPromptStats(stats: PromptCapStats, mechanicalSkipped: number): void {
  const lines: string[] = [];
  const totalFiles = stats.inputFileCount + mechanicalSkipped;
  const anythingCapped = stats.truncatedFiles.length > 0 || stats.droppedFiles.length > 0;

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

function logNarrativeViolations(narrative: NarrativeResponse, files: DiffFile[]): void {
  const validation = validateNarrative(narrative, files);
  if (validation.ok) return;
  const counts = new Map<string, number>();
  for (const v of validation.violations) counts.set(v.kind, (counts.get(v.kind) ?? 0) + 1);
  const summary = [...counts.entries()].map(([k, n]) => `${n} ${k}`).join(', ');
  console.error(`${YELLOW}  ⚠ Narrative validation: ${summary}${RESET}`);
  for (const v of validation.violations.slice(0, 10)) {
    console.error(`${DIM}      ${formatViolation(v)}${RESET}`);
  }
  if (validation.violations.length > 10) {
    console.error(`${DIM}      … and ${validation.violations.length - 10} more${RESET}`);
  }
}

export type NarrativeGenerationOptions = {
  /** Fires per chunk of streamed model output, with the cumulative char count. */
  onProgress?: NarrativeProgressHandler;
  /** Fires whenever a parseable partial of the JSON narrative is available. */
  onPartial?: NarrativePartialHandler;
  /** Fires once when the planner pass completes (two-pass pipeline only). */
  onPlan?: PlanReadyHandler;
  /** Fires whenever a writer-pass chapter completes (two-pass pipeline only). */
  onChapter?: ChapterReadyHandler;
  /** Optional cache key for storing the plan separately from the assembled narrative. */
  cacheKey?: { owner: string; repo: string; number: number; sha: string };
  /** Existing inline review comments — fed to the planner as hints (hot-zone signal). */
  comments?: PRComment[];
};

export type NarrativeGenerationResult = {
  narrative: NarrativeResponse;
  provider: string;
};

function totalHunkCount(files: DiffFile[]): number {
  return files.reduce((s, f) => s + f.hunks.length, 0);
}

function totalFileCount(files: DiffFile[]): number {
  return files.length;
}

function getWriterConcurrency(): number {
  const raw = process.env.DIFFDAD_WRITER_CONCURRENCY;
  if (!raw) return DEFAULT_WRITER_CONCURRENCY;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_WRITER_CONCURRENCY;
  return Math.floor(parsed);
}

/**
 * Run a list of async tasks with bounded concurrency, in order. Used for
 * parallel writer calls without overwhelming rate limits.
 */
async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], concurrency: number): Promise<T[]> {
  const results: T[] = Array.from({ length: tasks.length });
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]!();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));
  return results;
}

function assembleNarrative(plan: Plan, chapters: NarrativeChapter[]): NarrativeResponse {
  return {
    title: plan.prTitle,
    tldr: plan.prTldr,
    verdict: plan.prVerdict,
    readingPlan: plan.readingPlan,
    concerns: plan.concerns,
    chapters,
    missing: plan.missing,
  };
}

function placeholderChapterFromTheme(theme: PlanTheme): NarrativeChapter {
  return {
    title: theme.title,
    summary: theme.rationale,
    whyMatters: '',
    risk: theme.riskLevel,
    sections: [],
    themeId: theme.id,
  };
}

/**
 * Two-pass narrative generation: a planner call decides theme structure, then
 * a writer call per non-suppressed theme produces prose. Falls back to the
 * single-pass path for very small PRs.
 */
export async function generateNarrative(
  pr: PRMetadata,
  files: DiffFile[],
  fileTree: string[],
  config: DiffDadConfig,
  previousContext?: PreviousNarrativeContext,
  options: NarrativeGenerationOptions = {},
): Promise<NarrativeGenerationResult> {
  const { narrate, skipped } = partitionMechanicalFiles(files);
  const skippedFiles = skipped.map((f) => f.file);

  // Small-PR short-circuit: skip the planner entirely and use the single-pass
  // path. Avoids unnecessary LLM calls when there's nothing to restructure.
  const hunkCount = totalHunkCount(narrate);
  if (totalFileCount(narrate) <= 1 && hunkCount <= SMALL_PR_HUNK_THRESHOLD) {
    return generateNarrativeSinglePass(pr, narrate, fileTree, config, previousContext, skippedFiles, options);
  }

  return generateNarrativeTwoPass(pr, narrate, files, fileTree, config, previousContext, skippedFiles, options);
}

async function generateNarrativeTwoPass(
  pr: PRMetadata,
  narrate: DiffFile[],
  fullFiles: DiffFile[],
  fileTree: string[],
  config: DiffDadConfig,
  previousContext: PreviousNarrativeContext | undefined,
  skippedFiles: string[],
  options: NarrativeGenerationOptions,
): Promise<NarrativeGenerationResult> {
  // Plan: cache hit → use; otherwise call the planner with up-to-1 retry on
  // structural-violation feedback.
  let plan: Plan | null = null;
  let plannerProvider = 'cached';
  if (options.cacheKey) {
    plan = await getCachedPlan(
      options.cacheKey.owner,
      options.cacheKey.repo,
      options.cacheKey.number,
      options.cacheKey.sha,
    );
  }

  if (!plan) {
    const hints = computeHints(narrate, options.comments);
    let retryFeedback: string | undefined;
    for (let attempt = 0; attempt < 2; attempt++) {
      const plannerResult = await runPlanner({
        pr,
        files: narrate,
        fileTree,
        config,
        skippedFiles,
        previousContext,
        hints,
        retryFeedback,
      });
      const validation = validatePlan(plannerResult.plan, narrate);
      if (validation.ok || attempt === 1) {
        plan = plannerResult.plan;
        plannerProvider = plannerResult.provider;
        if (!validation.ok) {
          console.error(`${YELLOW}  ⚠ Plan still has violations after retry — proceeding anyway${RESET}`);
          for (const v of validation.violations.slice(0, 5)) {
            console.error(`${DIM}      ${formatPlanViolation(v)}${RESET}`);
          }
        }
        break;
      }
      retryFeedback = validation.violations.map(formatPlanViolation).join('\n');
      console.error(`${DIM}  Plan had ${validation.violations.length} violation(s); retrying once${RESET}`);
    }
    if (!plan) throw new Error('Planner failed');
    if (options.cacheKey) {
      await cachePlan(
        options.cacheKey.owner,
        options.cacheKey.repo,
        options.cacheKey.number,
        options.cacheKey.sha,
        plan,
      );
    }
  }

  options.onPlan?.(plan);

  // Emit a placeholder narrative immediately so existing onPartial consumers
  // (the SSE outline broadcast) see the chapter shells before any writer
  // returns. Prose fills in as writer calls complete.
  const chapters: NarrativeChapter[] = plan.themes.map(placeholderChapterFromTheme);
  if (options.onPartial) options.onPartial(assembleNarrative(plan, chapters));

  // Writers: parallelize non-suppressed themes; suppressed themes are
  // synthesized without an LLM call.
  const writerConcurrency = getWriterConcurrency();
  let writerProvider = '';
  const tasks = plan.themes.map((theme, idx) => async () => {
    if (theme.suppress) {
      const chapter = buildSuppressedChapter(theme);
      chapters[idx] = chapter;
      options.onChapter?.({ themeId: theme.id, index: idx, chapter });
      if (options.onPartial) options.onPartial(assembleNarrative(plan, chapters));
      return;
    }
    const result = await writeChapter({ plan, theme, files: fullFiles, fileTree, config });
    if (!writerProvider) writerProvider = result.provider;
    chapters[idx] = result.chapter;
    options.onChapter?.({ themeId: theme.id, index: idx, chapter: result.chapter });
    if (options.onPartial) options.onPartial(assembleNarrative(plan, chapters));
  });
  await runWithConcurrency(tasks, writerConcurrency);

  const narrative = normalizeNarrative(assembleNarrative(plan, chapters));
  logNarrativeViolations(narrative, fullFiles);
  const provider = writerProvider ? `${plannerProvider} + ${writerProvider}` : plannerProvider;
  return { narrative, provider };
}

/**
 * Original single-pass narrative generation. Used by the small-PR short-circuit
 * and as a fallback. Behaviorally identical to the v0.9.0 pipeline.
 */
async function generateNarrativeSinglePass(
  pr: PRMetadata,
  narrate: DiffFile[],
  fileTree: string[],
  config: DiffDadConfig,
  previousContext: PreviousNarrativeContext | undefined,
  skippedFiles: string[],
  options: NarrativeGenerationOptions,
): Promise<NarrativeGenerationResult> {
  const { system, user, stats } = buildNarrativePrompt({
    title: pr.title,
    description: pr.body,
    labels: pr.labels,
    files: narrate,
    fileTree,
    skippedFiles,
    previousContext,
  });
  logPromptStats(stats, skippedFiles.length);

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

    const result = await _callAi(config, system, user, NARRATIVE_MAX_TOKENS, onChunk);

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
      logNarrativeViolations(narrative, narrate);
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
