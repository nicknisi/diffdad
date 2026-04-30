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
};

export type NarrativeResponse = {
  title: string;
  chapters: Chapter[];
  suggestedStart?: { chapter: number; reason: string };
};

export type Chapter = {
  title: string;
  summary: string;
  risk: "low" | "medium" | "high";
  sections: Section[];
};

export type Section =
  | { type: "narrative"; content: string }
  | {
      type: "diff";
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
  type: "add" | "remove" | "context";
  content: string;
  lineNumber: { old?: number; new?: number };
};

export type PRComment = {
  id: number;
  author: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  path?: string;
  line?: number;
  side?: string;
  inReplyToId?: number;
};

export type ChapterState = "reading" | "reviewing" | "replied" | "reviewed";

export type DraftComment = {
  id: string;
  body: string;
  path?: string;
  line?: number;
  chapterIndex?: number;
};

export type CheckRun = {
  id: number;
  name: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  detailsUrl: string | null;
  output: { title?: string; summary?: string };
};
