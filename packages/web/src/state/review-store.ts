import { create } from "zustand";
import type {
  ChapterState,
  DiffFile,
  DraftComment,
  NarrativeResponse,
  PRComment,
  PRData,
} from "./types";

type Theme = "light" | "dark";
type Density = "terse" | "normal" | "verbose";

type ReviewState = {
  pr: PRData | null;
  narrative: NarrativeResponse | null;
  files: DiffFile[];
  comments: PRComment[];
  chapterStates: Record<string, ChapterState>;
  activeChapterId: string | null;
  drafts: DraftComment[];
  openLine: string | null;
  theme: Theme;
  density: Density;

  setData: (
    pr: PRData,
    narrative: NarrativeResponse,
    files: DiffFile[],
    comments: PRComment[]
  ) => void;
  setActiveChapter: (id: string) => void;
  toggleReviewed: (idx: number) => void;
  setOpenLine: (key: string | null) => void;
  addComment: (comment: PRComment) => void;
  addDraft: (draft: DraftComment) => void;
  removeDraft: (id: string) => void;
  clearDrafts: () => void;
  setTheme: (theme: Theme) => void;
  setDensity: (d: Density) => void;
};

export const useReviewStore = create<ReviewState>((set) => ({
  pr: null,
  narrative: null,
  files: [],
  comments: [],
  chapterStates: {},
  activeChapterId: null,
  drafts: [],
  openLine: null,
  theme: "dark",
  density: "normal",

  setData: (pr, narrative, files, comments) => {
    const chapterStates: Record<string, ChapterState> = {};
    narrative.chapters.forEach((_, idx) => {
      chapterStates[`ch-${idx}`] = "reading";
    });
    set({
      pr,
      narrative,
      files,
      comments,
      chapterStates,
      activeChapterId: narrative.chapters.length > 0 ? "ch-0" : null,
    });
  },

  setActiveChapter: (id) => set({ activeChapterId: id }),

  toggleReviewed: (idx) =>
    set((state) => {
      const key = `ch-${idx}`;
      const current = state.chapterStates[key];
      const next: ChapterState = current === "reviewed" ? "reading" : "reviewed";
      return {
        chapterStates: { ...state.chapterStates, [key]: next },
      };
    }),

  setOpenLine: (key) => set({ openLine: key }),

  addComment: (comment) =>
    set((state) => ({ comments: [...state.comments, comment] })),

  addDraft: (draft) =>
    set((state) => ({ drafts: [...state.drafts, draft] })),

  removeDraft: (id) =>
    set((state) => ({ drafts: state.drafts.filter((d) => d.id !== id) })),

  clearDrafts: () => set({ drafts: [] }),

  setTheme: (theme) => set({ theme }),

  setDensity: (density) => set({ density }),
}));
