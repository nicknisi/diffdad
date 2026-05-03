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
  tldr?: string;
  verdict?: 'safe' | 'caution' | 'risky';
  chapters: Chapter[];
  missing?: string[];
  suggestedStart?: { chapter: number; reason: string };
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
  risk: 'low' | 'medium' | 'high';
  sections: Section[];
  callouts?: Callout[];
  reshow?: {
    ref: number;
    file?: string;
    framing?: string;
    highlight?: { from: number; to: number };
  }[];
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

export type PRComment = {
  id: number;
  author: string;
  avatarUrl?: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  path?: string;
  line?: number;
  side?: string;
  inReplyToId?: number;
  diffHunk?: string;
};

export type ChapterState = 'reading' | 'reviewing' | 'replied' | 'reviewed';

export type DraftComment = {
  id: string;
  body: string;
  path?: string;
  line?: number;
  side?: 'LEFT' | 'RIGHT';
  chapterIndex?: number;
};

export type WatchCommitSummary = {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  date: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  hasNarrative: boolean;
};

export type WatchSelection =
  | { kind: 'commit'; sha: string }
  | { kind: 'unified' }
  | { kind: 'pending' };

export type SkeletonFileCategory =
  | 'test'
  | 'config'
  | 'schema'
  | 'migration'
  | 'docs'
  | 'public-api'
  | 'source';

export type SkeletonFile = {
  path: string;
  category: SkeletonFileCategory;
  additions: number;
  deletions: number;
  isNewFile: boolean;
  isDeleted: boolean;
};

export type BranchSkeleton = {
  totals: { additions: number; deletions: number; changedFiles: number };
  byCategory: Record<SkeletonFileCategory, number>;
  touchedDirs: { dir: string; count: number }[];
  notable: SkeletonFile[];
  files: SkeletonFile[];
};

export type Addendum = {
  sha: string;
  shortSha: string;
  subject: string;
  additions: number;
  deletions: number;
  narrative: NarrativeResponse | null;
};

export type WatchData = {
  branch: string;
  base: string;
  baseSha: string;
  headSha: string;
  commits: WatchCommitSummary[];
  selection: WatchSelection;
  unifiedReady: boolean;
  unifiedHeadSha: string | null;
  addendums: Addendum[];
  skeleton: BranchSkeleton;
};

export type AppMode = 'pr' | 'watch';

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
