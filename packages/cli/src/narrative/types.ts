export type NarrativeResponse = {
  title: string;
  chapters: NarrativeChapter[];
  suggestedStart?: { chapter: number; reason: string };
};

export type NarrativeChapter = {
  title: string;
  summary: string;
  risk: "low" | "medium" | "high";
  sections: NarrativeSection[];
  reshow?: {
    ref: number;
    framing?: string;
    highlight?: { from: number; to: number };
  }[];
};

export type NarrativeSection =
  | { type: "narrative"; content: string }
  | {
      type: "diff";
      file: string;
      startLine: number;
      endLine: number;
      hunkIndex: number;
    };
