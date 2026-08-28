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
  /** Stable theme ID from the planner. Optional for backward compat with single-pass narratives. */
  themeId?: string;
};

export type ReshowEntry = {
  ref: number;
  file?: string;
  framing?: string;
  highlight?: { from: number; to: number };
};

/**
 * Deterministic, content-derived anchor for a diff section, computed server-side alongside the
 * fragile `hunkIndex`. `contentHash` is {@link import('../github/diff-parser').hashHunkLines} over the
 * hunk body: stable across re-fetches, changes when the hunk changes. Used to re-resolve a stale
 * `hunkIndex` after the diff shifts shape instead of dropping the reference.
 */
export type HunkAnchor = {
  file: string;
  newStart: number;
  newLines: number;
  contentHash: string;
};

/**
 * One frame in a base-vs-head call-tree diff. `depth` is the 0-based indent (root frames at 0).
 * `file`+`hunkIndex` optionally link the frame into a diff section the same way a `diff` section does;
 * both must be present for the link to be live. Unlike diff sections, frames carry no re-resolution
 * anchor — the validate/repair path nulls a dead link in place rather than re-resolving it.
 */
export type CallStackFrame = {
  /** e.g. 'handleSubmit — src/form.ts'. */
  label: string;
  change: 'added' | 'removed' | 'unchanged' | 'modified';
  /** 0-based indentation level. Clamped to 0-8 by normalizeNarrative. */
  depth: number;
  file?: string;
  /** 0-based index into DiffFile.hunks — same semantics as a diff section. */
  hunkIndex?: number;
};

export type NarrativeSection =
  | { type: 'narrative'; content: string }
  | {
      type: 'diff';
      file: string;
      startLine: number;
      endLine: number;
      hunkIndex: number;
      /** Content-derived re-resolution anchor. Absent on narratives cached before this field existed. */
      anchor?: HunkAnchor;
    }
  | { type: 'callstack'; title: string; frames: CallStackFrame[] };

const CONCERN_CATEGORIES: ConcernCategory[] = [
  'logic',
  'state',
  'timing',
  'validation',
  'security',
  'test-gap',
  'api-contract',
  'error-handling',
];

function normalizeReadingPlanStep(input: unknown): ReadingPlanStep | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  if (typeof obj.step !== 'string' || obj.step.length === 0) return null;
  return {
    step: obj.step,
    chapterIndex: typeof obj.chapterIndex === 'number' ? obj.chapterIndex : undefined,
    why: typeof obj.why === 'string' ? obj.why : undefined,
  };
}

const CALLSTACK_CHANGES: CallStackFrame['change'][] = ['added', 'removed', 'unchanged', 'modified'];
const MAX_FRAME_DEPTH = 8;
const MAX_FRAMES = 30;

function normalizeCallStackFrame(input: unknown): CallStackFrame | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  if (typeof obj.label !== 'string' || obj.label.length === 0) return null;
  const change = CALLSTACK_CHANGES.includes(obj.change as CallStackFrame['change'])
    ? (obj.change as CallStackFrame['change'])
    : 'unchanged';
  const rawDepth = typeof obj.depth === 'number' && Number.isFinite(obj.depth) ? Math.floor(obj.depth) : 0;
  const depth = Math.min(Math.max(rawDepth, 0), MAX_FRAME_DEPTH);
  return {
    label: obj.label,
    change,
    depth,
    file: typeof obj.file === 'string' ? obj.file : undefined,
    hunkIndex: typeof obj.hunkIndex === 'number' ? obj.hunkIndex : undefined,
  };
}

/**
 * Normalize one section. Prose and diff sections pass through untouched (they are validated elsewhere);
 * callstack sections get defensive frame handling: malformed frames dropped, depth clamped, frame count
 * capped, missing/unknown change coerced to 'unchanged'. Unknown section types pass through so the UI's
 * safe default can drop them.
 */
function normalizeSection(input: unknown): NarrativeSection {
  if (input && typeof input === 'object' && (input as Record<string, unknown>).type === 'callstack') {
    const obj = input as Record<string, unknown>;
    const frames = Array.isArray(obj.frames)
      ? obj.frames
          .map(normalizeCallStackFrame)
          .filter((f): f is CallStackFrame => f !== null)
          .slice(0, MAX_FRAMES)
      : [];
    return { type: 'callstack', title: typeof obj.title === 'string' ? obj.title : '', frames };
  }
  return input as NarrativeSection;
}

function normalizeConcern(input: unknown): Concern | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;
  if (typeof obj.question !== 'string' || obj.question.length === 0) return null;
  const category = CONCERN_CATEGORIES.includes(obj.category as ConcernCategory)
    ? (obj.category as ConcernCategory)
    : 'logic';
  return {
    question: obj.question,
    file: typeof obj.file === 'string' ? obj.file : '',
    line: typeof obj.line === 'number' ? obj.line : 0,
    category,
    why: typeof obj.why === 'string' ? obj.why : '',
  };
}

/**
 * Normalize a parsed narrative (e.g. from cache or LLM JSON) so missing fields
 * don't crash callers that assume the shape. Tolerant of older shapes.
 */
export function normalizeNarrative(input: unknown): NarrativeResponse {
  const obj = (input ?? {}) as Record<string, unknown>;
  const chapters = Array.isArray(obj.chapters) ? (obj.chapters as Record<string, unknown>[]) : [];
  const readingPlan = Array.isArray(obj.readingPlan)
    ? obj.readingPlan.map(normalizeReadingPlanStep).filter((s): s is ReadingPlanStep => s !== null)
    : [];
  const concerns = Array.isArray(obj.concerns)
    ? obj.concerns.map(normalizeConcern).filter((c): c is Concern => c !== null)
    : [];
  return {
    title: typeof obj.title === 'string' ? obj.title : '',
    tldr: typeof obj.tldr === 'string' ? obj.tldr : '',
    verdict: (obj.verdict === 'safe' || obj.verdict === 'caution' || obj.verdict === 'risky'
      ? obj.verdict
      : 'caution') as NarrativeResponse['verdict'],
    readingPlan,
    concerns,
    chapters: chapters.map((c) => ({
      title: typeof c.title === 'string' ? c.title : '',
      summary: typeof c.summary === 'string' ? c.summary : '',
      whyMatters: typeof c.whyMatters === 'string' ? c.whyMatters : '',
      risk: (c.risk === 'low' || c.risk === 'medium' || c.risk === 'high'
        ? c.risk
        : 'medium') as NarrativeChapter['risk'],
      sections: Array.isArray(c.sections) ? c.sections.map(normalizeSection) : [],
      callouts: Array.isArray(c.callouts) ? (c.callouts as Callout[]) : undefined,
      reshow: Array.isArray(c.reshow) ? (c.reshow as ReshowEntry[]) : undefined,
      themeId: typeof c.themeId === 'string' ? c.themeId : undefined,
    })),
    missing: Array.isArray(obj.missing) ? (obj.missing as string[]) : undefined,
  };
}
