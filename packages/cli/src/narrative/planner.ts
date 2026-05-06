import type { DiffDadConfig } from '../config';
import type { DiffFile, PRMetadata } from '../github/types';
import { callAi, type AiUsage } from './ai-runtime';
import { extractJson } from './json-parse';
import { buildPlannerPrompt, type PreviousNarrativeContext } from './prompt';
import type { Plan, PlanTheme } from './plan-types';

export type PlannerInput = {
  pr: PRMetadata;
  files: DiffFile[];
  fileTree: string[];
  config: DiffDadConfig;
  skippedFiles?: string[];
  previousContext?: PreviousNarrativeContext;
  /** Optional violation feedback from a previous failed run; injected into the user prompt. */
  retryFeedback?: string;
};

export type PlannerResult = {
  plan: Plan;
  provider: string;
  usage?: AiUsage;
};

const PLANNER_MAX_TOKENS = 6_000;

function normalizePath(p: string): string {
  return p
    .trim()
    .replace(/^[ab]\//, '')
    .replace(/^\/+/, '');
}

export async function runPlanner(input: PlannerInput): Promise<PlannerResult> {
  const { pr, files, fileTree, config, skippedFiles, previousContext, retryFeedback } = input;
  const prompt = buildPlannerPrompt({
    title: pr.title,
    description: pr.body,
    labels: pr.labels,
    files,
    fileTree,
    skippedFiles,
    previousContext,
  });
  const user = retryFeedback
    ? `${prompt.user}\n\n---\n\nPREVIOUS PLAN HAD VIOLATIONS:\n${retryFeedback}\n\nFix them in this run.`
    : prompt.user;

  const result = await callAi(config, prompt.system, user, PLANNER_MAX_TOKENS);
  const json = extractJson(result.text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`Planner returned non-JSON: ${(err as Error).message}`);
  }
  const plan = normalizePlan(parsed, files);
  return { plan, provider: result.provider, usage: result.usage };
}

/**
 * Normalize and lightly sanitize a parsed plan. Coerces missing fields,
 * filters invalid hunkRefs, and assigns stable theme IDs if absent.
 */
export function normalizePlan(input: unknown, files: DiffFile[]): Plan {
  const obj = (input ?? {}) as Record<string, unknown>;
  const fileMap = new Map<string, DiffFile>();
  for (const f of files) fileMap.set(normalizePath(f.file), f);

  const themesRaw = Array.isArray(obj.themes) ? (obj.themes as Record<string, unknown>[]) : [];
  const themes: PlanTheme[] = themesRaw
    .map((t, i) => {
      const refs = Array.isArray(t.hunkRefs) ? (t.hunkRefs as Record<string, unknown>[]) : [];
      const cleanRefs = refs
        .map((r) => {
          const file = typeof r.file === 'string' ? r.file : '';
          const hunkIndex = typeof r.hunkIndex === 'number' ? r.hunkIndex : -1;
          if (!file || hunkIndex < 0) return null;
          // Reject refs to files we don't have or hunkIndex out of range.
          const f = fileMap.get(normalizePath(file));
          if (!f || hunkIndex >= f.hunks.length) return null;
          return { file, hunkIndex };
        })
        .filter((r): r is { file: string; hunkIndex: number } => r !== null);
      const id = typeof t.id === 'string' && t.id.length > 0 ? t.id : `theme-${i}`;
      return {
        id,
        title: typeof t.title === 'string' ? t.title : `Theme ${i + 1}`,
        riskLevel: (t.riskLevel === 'low' || t.riskLevel === 'medium' || t.riskLevel === 'high'
          ? t.riskLevel
          : 'medium') as PlanTheme['riskLevel'],
        rationale: typeof t.rationale === 'string' ? t.rationale : '',
        hunkRefs: cleanRefs,
        suppress: t.suppress === true ? true : undefined,
      };
    })
    .filter((t) => t.hunkRefs.length > 0);

  return {
    schemaVersion: 1,
    prTitle: typeof obj.prTitle === 'string' ? obj.prTitle : '',
    prTldr: typeof obj.prTldr === 'string' ? obj.prTldr : '',
    prVerdict: (obj.prVerdict === 'safe' || obj.prVerdict === 'caution' || obj.prVerdict === 'risky'
      ? obj.prVerdict
      : 'caution') as Plan['prVerdict'],
    themes,
    readingPlan: Array.isArray(obj.readingPlan) ? (obj.readingPlan as Plan['readingPlan']) : [],
    concerns: Array.isArray(obj.concerns) ? (obj.concerns as Plan['concerns']) : [],
    missing: Array.isArray(obj.missing) ? (obj.missing as string[]) : undefined,
  };
}

export type PlanViolation =
  | { kind: 'orphan-hunk'; file: string; hunkIndex: number }
  | { kind: 'duplicate-ref'; file: string; hunkIndex: number; themeIds: string[] }
  | { kind: 'no-themes' }
  | { kind: 'multiple-suppressed'; themeIds: string[] }
  | { kind: 'too-many-themes'; count: number; max: number };

const MAX_PLAN_THEMES = 7;

export function validatePlan(plan: Plan, files: DiffFile[]): { ok: boolean; violations: PlanViolation[] } {
  const violations: PlanViolation[] = [];
  if (plan.themes.length === 0) {
    violations.push({ kind: 'no-themes' });
    return { ok: false, violations };
  }
  if (plan.themes.length > MAX_PLAN_THEMES) {
    violations.push({ kind: 'too-many-themes', count: plan.themes.length, max: MAX_PLAN_THEMES });
  }
  const suppressed = plan.themes.filter((t) => t.suppress).map((t) => t.id);
  if (suppressed.length > 1) {
    violations.push({ kind: 'multiple-suppressed', themeIds: suppressed });
  }

  const refOwners = new Map<string, string[]>();
  for (const t of plan.themes) {
    for (const r of t.hunkRefs) {
      const key = `${normalizePath(r.file)}:${r.hunkIndex}`;
      const arr = refOwners.get(key);
      if (arr) arr.push(t.id);
      else refOwners.set(key, [t.id]);
    }
  }

  for (const [key, owners] of refOwners) {
    if (owners.length > 1) {
      const sep = key.lastIndexOf(':');
      violations.push({
        kind: 'duplicate-ref',
        file: key.slice(0, sep),
        hunkIndex: Number(key.slice(sep + 1)),
        themeIds: owners,
      });
    }
  }

  for (const f of files) {
    const norm = normalizePath(f.file);
    f.hunks.forEach((_, idx) => {
      if (!refOwners.has(`${norm}:${idx}`)) {
        violations.push({ kind: 'orphan-hunk', file: f.file, hunkIndex: idx });
      }
    });
  }

  return { ok: violations.length === 0, violations };
}

export function formatPlanViolation(v: PlanViolation): string {
  switch (v.kind) {
    case 'orphan-hunk':
      return `orphan: ${v.file}#${v.hunkIndex} not assigned to any theme`;
    case 'duplicate-ref':
      return `duplicate: ${v.file}#${v.hunkIndex} appears in themes ${v.themeIds.join(', ')}`;
    case 'no-themes':
      return 'no themes produced';
    case 'multiple-suppressed':
      return `multiple suppressed themes: ${v.themeIds.join(', ')} — at most one is allowed`;
    case 'too-many-themes':
      return `too many themes: ${v.count} (max ${v.max})`;
  }
}
