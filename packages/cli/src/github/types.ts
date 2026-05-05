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
};

export type DiffFile = {
  file: string;
  isNewFile: boolean;
  isDeleted: boolean;
  hunks: DiffHunk[];
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
