import type { DiffDadConfig } from '../config';
import type { DiffFile } from '../github/types';
import { callAi, type AiUsage } from './ai-runtime';
import { parseLooseJson, rawResponseSnippet } from './json-parse';
import { buildWriterPrompt } from './prompt';
import type { Plan, PlanTheme } from './plan-types';
import type { NarrativeChapter, NarrativeSection } from './types';

export type WriterInput = {
  plan: Plan;
  theme: PlanTheme;
  files: DiffFile[];
  fileTree: string[];
  config: DiffDadConfig;
};

export type WriterResult = {
  chapter: NarrativeChapter;
  provider: string;
  usage?: AiUsage;
};

// One chapter is a 1-sentence summary + 1-2-sentence whyMatters + a few short
// narrative sections + cheap diff refs + a few callouts — well under this. The cap
// is a guardrail against a runaway chapter (which also dominates the parallel
// writers' wall-clock), not the target length; the prompt asks for brevity.
const WRITER_MAX_TOKENS = 3_000;

function normalizePath(p: string): string {
  return p
    .trim()
    .replace(/^[ab]\//, '')
    .replace(/^\/+/, '');
}

export async function writeChapter(input: WriterInput): Promise<WriterResult> {
  const { plan, theme, files, fileTree, config } = input;
  const prompt = buildWriterPrompt({ plan, theme, files, fullFileTree: fileTree });

  const result = await callAi(config, prompt.system, prompt.user, WRITER_MAX_TOKENS);
  const parsed = parseChapterResponse(result.text, theme.id);
  const chapter = normalizeChapter(parsed, theme, files);
  return { chapter, provider: result.provider, usage: result.usage };
}

/**
 * Parse the writer's raw LLM response into a chapter object.
 *
 * Salvages a chapter truncated at WRITER_MAX_TOKENS rather than failing the theme — normalizeChapter
 * backfills whatever sections didn't make it. Only a response with no recoverable object at all is
 * fatal, and then we append a snippet of the raw response so an intermittent non-JSON failure is
 * diagnosable from the thrown error alone.
 */
export function parseChapterResponse(text: string, themeId: string): unknown {
  const parsed = parseLooseJson(text);
  if (parsed == null) {
    throw new Error(`Writer for theme ${themeId} returned non-JSON (no recoverable object)${rawResponseSnippet(text)}`);
  }
  return parsed;
}

/**
 * Build a synthetic chapter for a suppressed (mechanical) theme without an
 * LLM call. Skips the writer entirely — these themes are collapsed in the UI.
 */
export function buildSuppressedChapter(theme: PlanTheme): NarrativeChapter {
  const sections: NarrativeSection[] = theme.hunkRefs.map((r) => ({
    type: 'diff',
    file: r.file,
    hunkIndex: r.hunkIndex,
    startLine: 1,
    endLine: 1,
  }));
  return {
    title: theme.title,
    summary: 'Mechanical changes — renames, imports, formatting. No behavior change.',
    whyMatters: '',
    risk: 'low',
    sections,
    themeId: theme.id,
  };
}

/** The hunk's full display range: new side, or old side for a deletion-only hunk (newCount 0). */
function hunkRange(
  files: DiffFile[] | undefined,
  file: string,
  hunkIndex: number,
): {
  startLine: number;
  endLine: number;
} {
  const norm = normalizePath(file);
  const h = files?.find((f) => normalizePath(f.file) === norm)?.hunks[hunkIndex];
  if (!h) return { startLine: 1, endLine: 1 };
  return h.newCount > 0
    ? { startLine: h.newStart, endLine: h.newStart + h.newCount - 1 }
    : { startLine: h.oldStart, endLine: h.oldStart + Math.max(h.oldCount - 1, 0) };
}

/**
 * Coerce a parsed writer output into a valid NarrativeChapter: filter sections to those that
 * reference this theme's hunks, then backfill any planned hunk the output lost (truncation at
 * WRITER_MAX_TOKENS, fabricated-ref filtering) as a bare full-range diff section — a hunk the plan
 * assigned to this theme must never silently vanish from the walkthrough.
 */
export function normalizeChapter(input: unknown, theme: PlanTheme, files?: DiffFile[]): NarrativeChapter {
  const obj = (input ?? {}) as Record<string, unknown>;
  const allowedKeys = new Set(theme.hunkRefs.map((r) => `${normalizePath(r.file)}:${r.hunkIndex}`));
  const fileByNorm = new Map<string, string>();
  for (const r of theme.hunkRefs) fileByNorm.set(normalizePath(r.file), r.file);

  const sectionsRaw = Array.isArray(obj.sections) ? (obj.sections as Record<string, unknown>[]) : [];
  const sections: NarrativeSection[] = [];
  const covered = new Set<string>();
  for (const s of sectionsRaw) {
    if (s.type === 'narrative' && typeof s.content === 'string') {
      sections.push({ type: 'narrative', content: s.content });
    } else if (
      s.type === 'diff' &&
      typeof s.file === 'string' &&
      typeof s.hunkIndex === 'number' &&
      typeof s.startLine === 'number' &&
      typeof s.endLine === 'number'
    ) {
      const norm = normalizePath(s.file);
      const key = `${norm}:${s.hunkIndex}`;
      if (!allowedKeys.has(key)) continue; // silently drop fabricated refs
      covered.add(key);
      sections.push({
        type: 'diff',
        file: fileByNorm.get(norm) ?? s.file,
        hunkIndex: s.hunkIndex,
        startLine: s.startLine,
        endLine: s.endLine,
      });
    }
  }

  for (const r of theme.hunkRefs) {
    const key = `${normalizePath(r.file)}:${r.hunkIndex}`;
    if (covered.has(key)) continue;
    sections.push({ type: 'diff', file: r.file, hunkIndex: r.hunkIndex, ...hunkRange(files, r.file, r.hunkIndex) });
  }

  return {
    title: typeof obj.title === 'string' && obj.title.length > 0 ? obj.title : theme.title,
    summary: typeof obj.summary === 'string' ? obj.summary : '',
    whyMatters: typeof obj.whyMatters === 'string' ? obj.whyMatters : '',
    risk: (obj.risk === 'low' || obj.risk === 'medium' || obj.risk === 'high'
      ? obj.risk
      : theme.riskLevel) as NarrativeChapter['risk'],
    sections,
    callouts: Array.isArray(obj.callouts) ? (obj.callouts as NarrativeChapter['callouts']) : undefined,
    themeId: theme.id,
  };
}
