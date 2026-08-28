export type PRMetadata = {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed' | 'merged';
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
  /**
   * The PR's base repository is archived. Optional because it is a fact we may never have looked up:
   * units persisted before this field existed carry no value, and `false` there would be a claim
   * rather than an absence. Read `archived === true`, never `!archived`.
   */
  archived?: boolean;
};

/**
 * One row of `GET /pulls/:n/files`, minus the patch text. Lives here rather than beside the triage
 * classifier that consumes it because it describes a GitHub payload, and `github/` sits below
 * `narrative/` — the client must not import upward to name its own return type.
 */
export type PrFileSummary = {
  path: string;
  status: string;
  additions: number;
  deletions: number;
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
  side?: 'LEFT' | 'RIGHT';
  startLine?: number;
  startSide?: 'LEFT' | 'RIGHT';
  inReplyToId?: number;
  diffHunk?: string;
};

export type DiffLine = {
  type: 'add' | 'remove' | 'context';
  content: string;
  lineNumber: { old?: number; new?: number };
};

export type DiffHunk = {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
  /**
   * First 12 hex of sha256 over this hunk's line contents (op + content per line). Populated at parse
   * time so the browser can compare anchors by string equality without hashing. Optional because
   * DiffFiles that predate this field (or are constructed by tests) may carry no value.
   */
  contentHash?: string;
};

export type DiffFile = {
  file: string;
  isNewFile: boolean;
  isDeleted: boolean;
  hunks: DiffHunk[];
  /** Working-tree mtime (ms) in watch mode — drives freshest-first ordering. Absent in PR mode. */
  mtime?: number;
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

export type PRCommit = {
  sha: string;
  message: string;
  author: string;
  authoredAt: string;
};

export type ForcePushEvent = {
  /** Commit SHA the branch pointed to before the force push (may be null for initial push). */
  beforeSha: string | null;
  /** Commit SHA the branch points to after the force push. */
  afterSha: string | null;
  actor: string;
  createdAt: string;
};

export type IssueRef = {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed';
  url: string;
};
