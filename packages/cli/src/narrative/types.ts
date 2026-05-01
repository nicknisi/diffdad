export type NarrativeResponse = {
  title: string;
  tldr?: string;
  verdict?: 'safe' | 'caution' | 'risky';
  chapters: NarrativeChapter[];
  missing?: string[];
  suggestedStart?: { chapter: number; reason: string };
};

export type Callout = {
  file: string;
  line: number;
  level: 'nit' | 'concern' | 'warning';
  message: string;
};

export type NarrativeChapter = {
  title: string;
  summary: string;
  risk: 'low' | 'medium' | 'high';
  sections: NarrativeSection[];
  callouts?: Callout[];
  reshow?: {
    ref: number;
    framing?: string;
    highlight?: { from: number; to: number };
  }[];
};

export type NarrativeSection =
  | { type: 'narrative'; content: string }
  | {
      type: 'diff';
      file: string;
      startLine: number;
      endLine: number;
      hunkIndex: number;
    };
