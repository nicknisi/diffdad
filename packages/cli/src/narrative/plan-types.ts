import type { Concern, NarrativeResponse, ReadingPlanStep } from './types';

export type HunkRef = { file: string; hunkIndex: number };

export type PlanTheme = {
  /** Stable, e.g. `theme-0`. Used for caching, re-narrate, and writer output. */
  id: string;
  title: string;
  riskLevel: 'low' | 'medium' | 'high';
  /** 1 sentence — fed verbatim to the writer pass for this theme. */
  rationale: string;
  hunkRefs: HunkRef[];
  /** When true, this theme is the mechanical-changes bucket and is not narrated. */
  suppress?: boolean;
};

export type Plan = {
  schemaVersion: 1;
  prTitle: string;
  prTldr: string;
  prVerdict: NarrativeResponse['verdict'];
  themes: PlanTheme[];
  readingPlan: ReadingPlanStep[];
  concerns: Concern[];
  missing?: string[];
};

export function isPlan(value: unknown): value is Plan {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.schemaVersion === 1 && Array.isArray(v.themes);
}
