export type PRMetadata = {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed" | "merged";
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
  body: string;
  createdAt: string;
  updatedAt: string;
  path?: string;
  line?: number;
  side?: "LEFT" | "RIGHT";
  inReplyToId?: number;
  diffHunk?: string;
};

export type DiffLine = {
  type: "add" | "remove" | "context";
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
