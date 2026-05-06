import type { DiffDadConfig } from '../config';
import type { DiffFile } from '../github/types';
import { callAi, type AiUsage } from './ai-runtime';
import { extractJson } from './json-parse';
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

const WRITER_MAX_TOKENS = 4_000;

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
  const json = extractJson(result.text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`Writer for theme ${theme.id} returned non-JSON: ${(err as Error).message}`);
  }
  const chapter = normalizeChapter(parsed, theme);
  return { chapter, provider: result.provider, usage: result.usage };
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

/**
 * Coerce a parsed writer output into a valid NarrativeChapter, filtering
 * sections to those that reference this theme's hunks.
 */
export function normalizeChapter(input: unknown, theme: PlanTheme): NarrativeChapter {
  const obj = (input ?? {}) as Record<string, unknown>;
  const allowedKeys = new Set(theme.hunkRefs.map((r) => `${normalizePath(r.file)}:${r.hunkIndex}`));
  const fileByNorm = new Map<string, string>();
  for (const r of theme.hunkRefs) fileByNorm.set(normalizePath(r.file), r.file);

  const sectionsRaw = Array.isArray(obj.sections) ? (obj.sections as Record<string, unknown>[]) : [];
  const sections: NarrativeSection[] = [];
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
      sections.push({
        type: 'diff',
        file: fileByNorm.get(norm) ?? s.file,
        hunkIndex: s.hunkIndex,
        startLine: s.startLine,
        endLine: s.endLine,
      });
    }
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
