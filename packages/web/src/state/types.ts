export type PRData = {
  number: number;
  title: string;
  body: string;
  state: string;
  draft: boolean;
  author: { login: string; avatarUrl: string };
  branch: string;
  base: string;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: number;
  headSha: string;
};

export type NarrativeResponse = {
  title: string;
  tldr: string;
  verdict: 'safe' | 'caution' | 'risky';
  readingPlan: ReadingPlanStep[];
  concerns: Concern[];
  chapters: Chapter[];
  missing?: string[];
};

export type ReadingPlanStep = {
  step: string;
  chapterIndex?: number;
  why?: string;
};

/**
 * Web-side mirror of the CLI's collapse selection (`packages/cli/src/narrative/collapse.ts`),
 * hand-copied for the same reason `NarrativeResponse` is: `packages/web` never imports from
 * `packages/cli`. These ride the narrative API payload beside the narrative, not inside it — collapse is
 * computed per request and must never be cached or sanitized along with the story.
 *
 * `reason` arrives pre-rendered from the server, which is deliberate, and the rule it buys is scoped to
 * the per-chapter reason line: that line states the sentence it was given and never re-derives one from
 * `evidence`, so a chapter can only ever claim what was actually checked about it. The single divider is
 * not covered by that rule — it summarizes a *set* of decisions, which no individual `reason` describes,
 * so it maps `evidence.kind` to a short shared label in `lib/collapse.ts`.
 */
export type CollapseEvidence =
  | { kind: 'no-external-callers'; files: string[]; knownCallers: 0 }
  | { kind: 'test-only'; files: string[] }
  | { kind: 'generated'; files: string[] };

export type CollapseDecision = {
  chapterIndex: number;
  reason: string;
  evidence: CollapseEvidence;
};

/** All four members of the CLI's `CollapseUnavailableReason` — the notice renders every one. */
export type CollapseUnavailableReason = 'size-cap' | 'fetch-failed' | 'extract-failed' | 'empty-tree';

export type CollapseResult =
  | { available: true; decisions: CollapseDecision[]; dividerBefore: number | null }
  | { available: false; reason: CollapseUnavailableReason };

/** Unchanged repository files that import a chapter's files; `callers` is a capped view of `total`. */
export type ChapterCallers = {
  chapterIndex: number;
  callers: string[];
  total: number;
};

/**
 * Prompt budget stats for the generation that produced the narrative — mirror of the CLI's
 * `PromptCapStats`. Absent whenever a narrative came from cache, and absent is load-bearing: the
 * truncation banner says nothing rather than imply a story built from a partial diff was complete.
 */
export type CapStats = {
  perFileCap: number;
  globalCap: number;
  inputFileCount: number;
  inputLineCount: number;
  narratedFileCount: number;
  narratedLineCount: number;
  truncatedFiles: { file: string; hunksDropped: number; linesDropped: number }[];
  droppedFiles: string[];
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
  question: string;
  file: string;
  line: number;
  category: ConcernCategory;
  why: string;
};

export type Callout = {
  file: string;
  line: number;
  level: 'nit' | 'concern' | 'warning';
  message: string;
};

export type Chapter = {
  title: string;
  summary: string;
  whyMatters: string;
  risk: 'low' | 'medium' | 'high';
  sections: Section[];
  callouts?: Callout[];
  reshow?: {
    ref: number;
    file?: string;
    framing?: string;
    highlight?: { from: number; to: number };
  }[];
  themeId?: string;
};

export type HunkRef = { file: string; hunkIndex: number };

export type PlanTheme = {
  id: string;
  title: string;
  riskLevel: 'low' | 'medium' | 'high';
  rationale: string;
  hunkRefs: HunkRef[];
  suppress?: boolean;
};

export type Plan = {
  schemaVersion: 1;
  prTitle: string;
  prTldr: string;
  prVerdict: 'safe' | 'caution' | 'risky';
  themes: PlanTheme[];
  readingPlan: ReadingPlanStep[];
  concerns: Concern[];
  missing?: string[];
};

export type Section =
  | { type: 'narrative'; content: string }
  | {
      type: 'diff';
      file: string;
      startLine: number;
      endLine: number;
      hunkIndex: number;
    };

export type DiffFile = {
  file: string;
  isNewFile: boolean;
  isDeleted: boolean;
  hunks: DiffHunk[];
  /** Working-tree mtime (ms) in watch mode — drives freshest-first ordering. Absent in PR mode. */
  mtime?: number;
};

export type DiffHunk = {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
};

export type DiffLine = {
  type: 'add' | 'remove' | 'context';
  content: string;
  lineNumber: { old?: number; new?: number };
};

/** Shared severity vocabulary for the beat rail + walkthrough resolve strips (see `lib/severity.ts`). */
export type TriageSeverity = 'risk' | 'warn' | 'info';

/** GitHub comment id (numeric). Kept as an alias for the inline-comment pipeline. */
export type CommentId = number | string;

export type PRComment = {
  id: CommentId;
  author: string;
  avatarUrl?: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  path?: string;
  line?: number;
  side?: string;
  startLine?: number;
  startSide?: string;
  inReplyToId?: number | string;
  diffHunk?: string;
};

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

export type PRReview = {
  id: number;
  user: string;
  avatarUrl: string;
  state: 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  submittedAt: string;
};

export type CheckRun = {
  id: number;
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  detailsUrl: string | null;
  output: { title?: string; summary?: string };
};

/**
 * A review unit in the daemon's cross-repo queue. Web-side mirror of the CLI's `ReviewUnit`
 * (packages/cli/src/units/types.ts) — only the fields the command center reads. `metadata` is
 * the CLI's `PRMetadata`, which is structurally a `PRData`, so the drill-in feeds it straight
 * into `setData` as the unit's PR. `narrative`/`files` are absent until the review worker queues
 * the unit; the diff (`files`) is present from submit time so the drill-in renders diff-first.
 */
export type UnitStatus = 'queued' | 'approved' | 'changes_requested' | 'done';

/**
 * Attention lanes — mirror of `packages/cli/src/units/lane.ts`, hand-copied for the same reason
 * `CollapseEvidence` is: `packages/web` never imports from `packages/cli`.
 *
 * Only the *type* is mirrored. The lane itself arrives pre-computed on every payload unit, and that is
 * the whole point: the daemon's lane-split log and these labels are two consumers of one rule, so a
 * second implementation here would drift and corrupt the data the two-week judgment rests on. The
 * browser reads `Unit.lane`; it never derives one.
 */
export type Lane = 'needs-you' | 'probably-not' | 'in-flight' | 'cleared';

/**
 * Triage inputs, mirroring `packages/cli/src/narrative/triage.ts`. Note this is an unrelated vocabulary
 * to {@link TriageSeverity} above, which is the beat rail's risk/warn/info scale — these describe what a
 * *file* is, that one describes how alarming a *finding* is. They share a word and nothing else.
 */
export type CriticalityTag =
  | 'auth'
  | 'security'
  | 'crypto'
  | 'payment'
  | 'migration'
  | 'permission'
  | 'token'
  | 'session'
  | 'database'
  | 'config'
  | 'infra';

/** `source` means "classifies as nothing mechanical" — ordinary code, not an unclassified file. */
export type TriageKind =
  | 'lockfile'
  | 'generated'
  | 'snapshot'
  | 'vendored'
  | 'minified'
  | 'binary'
  | 'oversized'
  | 'manifest'
  | 'test-only'
  | 'docs'
  | 'source';

export type TriagedFile = {
  path: string;
  kind: TriageKind;
  criticality: CriticalityTag[];
};

export type TriageSummary = {
  files: TriagedFile[];
  /** Distinct tags across every file, first-appearance order. Non-empty forces the high-attention lane. */
  criticality: CriticalityTag[];
  additions: number;
  deletions: number;
  /** More files than one page of `/pulls/:n/files`, so `files` is a partial view — never a low-stakes PR. */
  truncated: boolean;
  /** Head SHA these inputs were gathered at, so staleness is detectable without re-fetching. */
  sha: string;
};

export type Unit = {
  unitId: string;
  repo: string; // owner/name
  taskLabel: string;
  intent: string;
  status: UnitStatus;
  /** Ingestion door — github-only now (every unit mirrors a real GitHub PR). */
  source?: 'github';
  /** github-only: the PR this unit mirrors. Drives the author cue + "View on GitHub" link + lazy hydrate. */
  prNumber?: number;
  prUrl?: string;
  prAuthor?: string;
  /**
   * You added this PR by hand (the command center's add-PR field) rather than the poller minting it
   * from a review request. It is exempt from the poller's queue reconciliation, so it stays until you
   * remove it — the row's badge says so.
   */
  pinned?: boolean;
  toResolve: number;
  /**
   * The attention lane the *server* assigned. Optional because a payload from an older daemon carries
   * none; the queue falls back to status-only grouping rather than to an empty screen. Never compute it.
   */
  lane?: Lane;
  /**
   * Path-derived evidence for the lane, gathered at mint from one REST call and zero model tokens.
   * Absent means nobody has looked yet — which is not the same as "nothing found", and the row says so.
   */
  triage?: TriageSummary;
  /** Head SHA at which ✕ hid this row. Present ⇒ dismissed; cleared by the poller once the author pushes. */
  dismissedAtSha?: string;
  /** Latest verdict per reviewer, GitHub's own rollup. Absent means the reviews were never fetched. */
  reviewRollup?: { approved: number; changesRequested: number };
  verdict?: NarrativeResponse['verdict'];
  /** Set when the review worker threw — the unit still queues so it reaches the reviewer. */
  error?: string;
  files?: DiffFile[];
  metadata?: PRData;
  narrative?: NarrativeResponse;
  createdAt: string;
  updatedAt: string;
};
