import type {
  CapStats,
  Chapter,
  ChapterCallers,
  CollapseDecision,
  CollapseResult,
  CollapseUnavailableReason,
} from '../state/types';

/**
 * The rules behind the collapse boundary, kept out of the components so they can be tested as
 * functions rather than through a DOM the web suite does not have.
 *
 * Everything here is derived, never stored: the store holds the server's `CollapseResult` verbatim and
 * these read it. That matters because a `CollapseDecision.chapterIndex` is only meaningful against the
 * chapter array it was computed for, so the moment chapters are replaced the whole result is discarded
 * rather than reinterpreted.
 */

/**
 * Mirrors the CLI's `UNAVAILABLE_REASON_TEXT`. A `Record` over the union on purpose — a fifth reason
 * added to the snapshot layer becomes a type error here instead of a blank message, which is how
 * `empty-tree` (a successful fetch that indexed zero source files) survived from Phase 1 to this screen.
 */
export const COLLAPSE_UNAVAILABLE_TEXT: Record<CollapseUnavailableReason, string> = {
  'size-cap': 'the repository exceeds the snapshot size cap',
  'fetch-failed': 'the repository snapshot could not be downloaded',
  'extract-failed': 'the repository snapshot could not be extracted',
  'empty-tree': 'no source files were found in the repository',
};

/** The reason to show in the notice, or `null` — including for "the server never sent a result". */
export function unavailableReason(collapse: CollapseResult | null): CollapseUnavailableReason | null {
  if (!collapse || collapse.available) return null;
  return collapse.reason;
}

/** Decisions keyed by chapter index, for the per-chapter prop. Empty when nothing collapses. */
export function decisionsByChapter(collapse: CollapseResult | null): Record<number, CollapseDecision> {
  const map: Record<number, CollapseDecision> = {};
  if (!collapse?.available) return map;
  for (const decision of collapse.decisions) map[decision.chapterIndex] = decision;
  return map;
}

export function callersByChapter(callers: ChapterCallers[]): Record<number, ChapterCallers> {
  const map: Record<number, ChapterCallers> = {};
  for (const entry of callers) map[entry.chapterIndex] = entry;
  return map;
}

/**
 * Where the single divider goes, strictly `dividerBefore`.
 *
 * Never derived from `decisions.length`: the server withholds `dividerBefore` whenever the collapsed
 * chapters are not a contiguous run at the end of the list, because one line cannot honestly represent
 * that boundary. A chapter can therefore carry a decision while no divider exists at all.
 */
export function dividerIndex(collapse: CollapseResult | null): number | null {
  if (!collapse?.available) return null;
  return collapse.dividerBefore;
}

/**
 * The initial value of a chapter's `collapsed` state. Both inputs are seeds and neither is a lock — the
 * reviewer expanding a chapter keeps it expanded, because nothing writes `collapsed` from a decision
 * after mount.
 */
export function initialCollapsed(reviewed: boolean, decision?: CollapseDecision): boolean {
  return reviewed || Boolean(decision);
}

/**
 * The reason line for a collapsed row, or `null`.
 *
 * `reviewed` wins on conflict. Both seeds produce the same `collapsed: true`, so precedence only shows
 * up here — a chapter the reviewer already marked shows the reviewed treatment, because their own action
 * outranks the tool's inference.
 */
export function collapseReason(decision: CollapseDecision | undefined, reviewed: boolean): string | null {
  if (!decision || reviewed) return null;
  return decision.reason;
}

/**
 * Diff lines a set of chapters puts in front of a reader. Local copy of the CLI's `narratedDiffLines`
 * (the package boundary forbids importing it), including the zero clamp: section line numbers are
 * model-authored and validated only as numbers, so one reversed range must not subtract from the total.
 */
export function narratedDiffLines(chapters: Chapter[]): number {
  let total = 0;
  for (const chapter of chapters) {
    for (const section of chapter.sections) {
      if (section.type !== 'diff') continue;
      total += Math.max(0, section.endLine - section.startLine + 1);
    }
  }
  return total;
}

/**
 * Divider-only copy, and the one place the UI derives text from `evidence.kind` rather than from a
 * server-rendered `reason` (see the rule on `CollapseEvidence` in `state/types.ts`). It has to be derived
 * here: the divider describes the whole collapsed run, and no single decision's `reason` is true of the
 * set. Per-chapter reason lines still come verbatim from the server.
 */
const EVIDENCE_LABELS = {
  'no-external-callers': 'no known callers outside this PR',
  'test-only': 'tests only',
  generated: 'generated or vendored',
} as const;

export type CollapsedSummary = {
  /** How many chapters sit below the divider. */
  count: number;
  /** Their combined narrated diff lines — the unit the goal is measured in. */
  lines: number;
  /** What the collapse rests on, or 'mixed evidence' when the chapters disagree. */
  evidence: string;
};

/**
 * What the divider states: chapters, lines, and the evidence they share. `null` whenever there is no
 * divider, so nothing renders — no summary, no empty state. That is the evidence gate made visible, and
 * it is the specific thing keeping this from becoming another always-on `readingPlan`.
 */
export function collapsedSummary(collapse: CollapseResult | null, chapters: Chapter[]): CollapsedSummary | null {
  if (!collapse?.available || collapse.dividerBefore === null) return null;
  const collapsedChapters: Chapter[] = [];
  const kinds = new Set<string>();
  for (const decision of collapse.decisions) {
    const chapter = chapters[decision.chapterIndex];
    if (!chapter) continue;
    collapsedChapters.push(chapter);
    kinds.add(decision.evidence.kind);
  }
  if (collapsedChapters.length === 0) return null;
  const only = kinds.size === 1 ? [...kinds][0] : null;
  const evidence =
    only && only in EVIDENCE_LABELS ? EVIDENCE_LABELS[only as keyof typeof EVIDENCE_LABELS] : 'mixed evidence';
  return { count: collapsedChapters.length, lines: narratedDiffLines(collapsedChapters), evidence };
}

export type TruncationSummary = {
  /** Files the prompt budget dropped entirely. */
  dropped: number;
  /** Files the prompt budget shortened. */
  shortened: number;
};

/**
 * The two counts the truncation banner states, or `null`.
 *
 * `null` for absent stats (a cache hit measured nothing) *and* for a diff that fit — a banner announcing
 * that zero files were dropped is chrome, and one shown for missing stats would be a claim.
 */
export function truncationSummary(capStats: CapStats | null | undefined): TruncationSummary | null {
  if (!capStats) return null;
  const dropped = capStats.droppedFiles?.length ?? 0;
  const shortened = capStats.truncatedFiles?.length ?? 0;
  if (dropped === 0 && shortened === 0) return null;
  return { dropped, shortened };
}
