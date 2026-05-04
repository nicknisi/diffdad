export type NarrativeResponse = {
  title: string;
  /** 1-sentence headline of what this PR does. */
  tldr: string;
  /** Overall reviewer signal. */
  verdict: 'safe' | 'caution' | 'risky';
  /** Ordered reading plan: where to look first, and why. 3-5 steps. */
  readingPlan: ReadingPlanStep[];
  /** Top-level reviewer concerns, framed as questions. */
  concerns: Concern[];
  chapters: NarrativeChapter[];
  /** Things notably absent from this PR. */
  missing?: string[];
};

export type ReadingPlanStep = {
  /** Imperative instruction, e.g. "Start at chapter 3 — that's where the auth boundary moved." */
  step: string;
  /** Optional jump target, 0-based index into chapters. */
  chapterIndex?: number;
  /** Optional explanation. */
  why?: string;
};

export type ConcernCategory =
  | 'logic'
  | 'state'
  | 'timing'
  | 'validation'
  | 'security'
  | 'test-gap'
  | 'api-contract'
  | 'error-handling';

export type Concern = {
  /** Must be phrased as a question. */
  question: string;
  file: string;
  /** 1-based line number on the new side. */
  line: number;
  category: ConcernCategory;
  /** 1 sentence explaining why this is worth asking. */
  why: string;
};

export type Callout = {
  file: string;
  line: number;
  level: 'nit' | 'concern' | 'warning';
  message: string;
};

export type NarrativeChapter = {
  title: string;
  /** 1 sentence — what this chapter covers. */
  summary: string;
  /** 1-2 sentences — what breaks if this is wrong (the "rationality" axis). */
  whyMatters: string;
  risk: 'low' | 'medium' | 'high';
  sections: NarrativeSection[];
  callouts?: Callout[];
  reshow?: ReshowEntry[];
};

export type ReshowEntry = {
  ref: number;
  file?: string;
  framing?: string;
  highlight?: { from: number; to: number };
};

export type NarrativeSection =
  | { type: 'narrative'; content: string }
  | {
      type: 'diff';
      file: string;
      startLine: number;
      endLine: number;
      hunkIndex: number;
    };

/**
 * Normalize a parsed narrative (e.g. from cache or LLM JSON) so missing fields
 * don't crash callers that assume the shape. Tolerant of older shapes.
 */
export function normalizeNarrative(input: unknown): NarrativeResponse {
  const obj = (input ?? {}) as Record<string, unknown>;
  const chapters = Array.isArray(obj.chapters) ? (obj.chapters as Record<string, unknown>[]) : [];
  return {
    title: typeof obj.title === 'string' ? obj.title : '',
    tldr: typeof obj.tldr === 'string' ? obj.tldr : '',
    verdict: (obj.verdict === 'safe' || obj.verdict === 'caution' || obj.verdict === 'risky'
      ? obj.verdict
      : 'caution') as NarrativeResponse['verdict'],
    readingPlan: Array.isArray(obj.readingPlan) ? (obj.readingPlan as ReadingPlanStep[]) : [],
    concerns: Array.isArray(obj.concerns) ? (obj.concerns as Concern[]) : [],
    chapters: chapters.map((c) => ({
      title: typeof c.title === 'string' ? c.title : '',
      summary: typeof c.summary === 'string' ? c.summary : '',
      whyMatters: typeof c.whyMatters === 'string' ? c.whyMatters : '',
      risk: (c.risk === 'low' || c.risk === 'medium' || c.risk === 'high'
        ? c.risk
        : 'medium') as NarrativeChapter['risk'],
      sections: Array.isArray(c.sections) ? (c.sections as NarrativeSection[]) : [],
      callouts: Array.isArray(c.callouts) ? (c.callouts as Callout[]) : undefined,
      reshow: Array.isArray(c.reshow) ? (c.reshow as ReshowEntry[]) : undefined,
    })),
    missing: Array.isArray(obj.missing) ? (obj.missing as string[]) : undefined,
  };
}
