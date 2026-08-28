import type { WireUnit } from '@diffdad/contracts';

/**
 * Wire types are the single source of truth in `@diffdad/contracts` (Zod schemas + inferred types).
 * They are re-exported here so component imports keep pointing at `../state/types` and never churn.
 * `NarrativeChapter`/`NarrativeSection` are re-aliased to the names the web has always used
 * (`Chapter`/`Section`), and `PRMetadata` to `PRData`.
 */
export type {
  Callout,
  CapStats,
  ChapterCallers,
  CheckRun,
  CollapseDecision,
  CollapseEvidence,
  CollapseResult,
  CollapseUnavailableReason,
  Concern,
  ConcernCategory,
  CriticalityTag,
  DiffFile,
  DiffHunk,
  DiffLine,
  HunkAnchor,
  HunkRef,
  Lane,
  NarrativeChapter as Chapter,
  NarrativeResponse,
  NarrativeSection as Section,
  Plan,
  PlanTheme,
  PRComment,
  PRMetadata as PRData,
  PRReview,
  ReadingPlanStep,
  ReviewRound,
  TriagedFile,
  TriageKind,
  TriageSummary,
  UnitStatus,
} from '@diffdad/contracts';

/** Shared severity vocabulary for the beat rail + walkthrough resolve strips (see `lib/severity.ts`). */
export type TriageSeverity = 'risk' | 'warn' | 'info';

/** GitHub comment id (numeric). Kept as an alias for the inline-comment pipeline's map keys. */
export type CommentId = number | string;

export type ChapterState = 'reading' | 'reviewing' | 'replied' | 'reviewed';

export type DraftComment = {
  id: string;
  body: string;
  path?: string;
  line?: number;
  side?: 'LEFT' | 'RIGHT';
  startLine?: number;
  startSide?: 'LEFT' | 'RIGHT';
  chapterIndex?: number;
};

export type LiveEventKind = 'comment' | 'ci' | 'commit' | 'system';

export type LiveStatus = 'connected' | 'connecting' | 'disconnected';

export type LiveEvent = {
  id: string;
  kind: LiveEventKind | string;
  summary: string;
  timestamp: number;
  data?: unknown;
};

/**
 * UI view of a wire unit (contract `WireUnit`). The command center reads a subset of the broadcast
 * shape, so fields it never touches (`worktreePath`, `uncertainties`, `baseRef`, `diffContentKey`,
 * `capStats`, `decision`, `lastReviewedSha`) are dropped. Optionality is relaxed relative to the
 * contract: `lane`/`source`/`files`/`metadata` are always present on today's wire, but the queue
 * degrades gracefully for older-daemon payloads (`laneOf` falls back to status grouping), so they
 * stay optional here. See the drift report for the full list of relaxations.
 */
export type Unit = Pick<
  WireUnit,
  'unitId' | 'repo' | 'taskLabel' | 'intent' | 'status' | 'toResolve' | 'createdAt' | 'updatedAt'
> &
  Partial<
    Pick<
      WireUnit,
      | 'source'
      | 'prNumber'
      | 'prUrl'
      | 'prAuthor'
      | 'pinned'
      | 'lane'
      | 'triage'
      | 'dismissedAtSha'
      | 'reviewRollup'
      | 'verdict'
      | 'error'
      | 'files'
      | 'metadata'
      | 'narrative'
    >
  >;
