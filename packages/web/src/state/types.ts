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

export type TriageSeverity = 'risk' | 'warn' | 'info';

export type TriageStatus = 'idle' | 'running' | 'ready' | 'error';

/** A single watch-mode triage flag: "look here first" for an agent-era failure mode. */
export type TriageFlag = {
  file: string;
  line?: number;
  severity: TriageSeverity;
  kind: string;
  message: string;
};

/** Numeric for GitHub comments, string (UUID) for agent comments. */
export type CommentId = number | string;

export type PRComment = {
  // string ids carry agent comments (UUIDs) through the same inline pipeline as GitHub
  // comments (numeric ids); placement is by path+line, threading by id/inReplyToId.
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
  /** Agent-loop fields (watch mode). Absent for GitHub comments. */
  source?: 'agent' | 'github';
  status?: 'open' | 'delivered' | 'addressed';
  addressedNote?: string;
};

// Agent-loop comments (watch mode). Kept distinct from PRComment — string ids and a
// status lifecycle — so they never flow through the numeric-id GitHub comment pipeline.
export type AgentReply = {
  id: string;
  author: 'user' | 'agent';
  body: string;
  createdAt: string;
};

export type AgentComment = {
  id: string;
  path: string;
  line: number;
  side: 'LEFT' | 'RIGHT';
  startLine?: number;
  startSide?: 'LEFT' | 'RIGHT';
  body: string;
  status: 'open' | 'delivered' | 'addressed';
  author: 'user' | 'agent';
  replies: AgentReply[];
  hunkContext: string;
  chapterTitle?: string;
  createdAt: string;
  deliveredAt?: string;
  addressedAt?: string;
  addressedNote?: string;
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
export type UnitStatus =
  | 'submitted'
  | 'reviewing'
  | 'queued'
  | 'approved'
  | 'changes_requested'
  | 'addressing'
  | 'done';

export type UnitDecisionKind = 'approved' | 'changes_requested';

export type Unit = {
  unitId: string;
  repo: string; // owner/name
  taskLabel: string;
  intent: string;
  status: UnitStatus;
  /** Ingestion door (CLI mirror of `UnitSource`). Defaults to `'agent'` server-side for back-compat. */
  source?: 'agent' | 'cli' | 'github';
  /** github-only: the PR this unit mirrors. Drives the author cue + "View on GitHub" link + lazy hydrate. */
  prNumber?: number;
  prUrl?: string;
  prAuthor?: string;
  toResolve: number;
  verdict?: NarrativeResponse['verdict'];
  /** Set when the review worker threw — the unit still queues so it reaches the reviewer. */
  error?: string;
  files?: DiffFile[];
  metadata?: PRData;
  narrative?: NarrativeResponse;
  createdAt: string;
  updatedAt: string;
};
