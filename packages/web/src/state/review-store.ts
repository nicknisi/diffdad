import { create } from "zustand";
import type {
  ChapterState,
  CheckRun,
  DiffFile,
  DraftComment,
  LiveEvent,
  LiveStatus,
  NarrativeResponse,
  PRComment,
  PRData,
} from "./types";

type Theme = "light" | "dark";
type Density = "terse" | "normal" | "verbose";
type View = "story" | "files";

type ReviewState = {
  pr: PRData | null;
  narrative: NarrativeResponse | null;
  files: DiffFile[];
  comments: PRComment[];
  checkRuns: CheckRun[];
  repoUrl: string | null;
  chapterStates: Record<string, ChapterState>;
  activeChapterId: string | null;
  drafts: DraftComment[];
  openLine: string | null;
  theme: Theme;
  density: Density;
  chapterDensity: Record<string, Density>;
  view: View;
  liveStatus: LiveStatus;
  liveEvents: LiveEvent[];
  lastEventAt: number;
  shortcutsHelpOpen: boolean;

  setData: (
    pr: PRData,
    narrative: NarrativeResponse,
    files: DiffFile[],
    comments: PRComment[],
    repoUrl?: string | null,
    checkRuns?: CheckRun[]
  ) => void;
  setActiveChapter: (id: string) => void;
  toggleReviewed: (idx: number) => void;
  setOpenLine: (key: string | null) => void;
  addComment: (comment: PRComment) => void;
  setComments: (comments: PRComment[]) => void;
  addDraft: (draft: DraftComment) => void;
  removeDraft: (id: string) => void;
  clearDrafts: () => void;
  setTheme: (theme: Theme) => void;
  setDensity: (d: Density) => void;
  setChapterDensity: (chapterKey: string, density: Density) => void;
  setView: (view: View) => void;
  setLiveStatus: (status: LiveStatus) => void;
  addLiveEvent: (event: LiveEvent) => void;
  setLastEventAt: (ts: number) => void;
  setCheckRuns: (checkRuns: CheckRun[]) => void;
  setShortcutsHelpOpen: (open: boolean) => void;
};

export const useReviewStore = create<ReviewState>((set) => ({
  pr: null,
  narrative: null,
  files: [],
  comments: [],
  checkRuns: [],
  repoUrl: null,
  chapterStates: {},
  activeChapterId: null,
  drafts: [],
  openLine: null,
  theme: "dark",
  density: "normal",
  chapterDensity: {},
  view: "story",
  liveStatus: "connecting",
  liveEvents: [],
  lastEventAt: Date.now(),
  shortcutsHelpOpen: false,

  setData: (pr, narrative, files, comments, repoUrl = null, checkRuns = []) => {
    const chapterStates: Record<string, ChapterState> = {};
    narrative.chapters.forEach((_, idx) => {
      chapterStates[`ch-${idx}`] = "reading";
    });
    set({
      pr,
      narrative,
      files,
      comments,
      checkRuns,
      repoUrl,
      chapterStates,
      activeChapterId: narrative.chapters.length > 0 ? "ch-0" : null,
      chapterDensity: {},
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

  setComments: (comments) => set({ comments }),

  addDraft: (draft) =>
    set((state) => ({ drafts: [...state.drafts, draft] })),

  removeDraft: (id) =>
    set((state) => ({ drafts: state.drafts.filter((d) => d.id !== id) })),

  clearDrafts: () => set({ drafts: [] }),

  setTheme: (theme) => set({ theme }),

  setDensity: (density) => set({ density }),

  setChapterDensity: (chapterKey, density) =>
    set((state) => ({
      chapterDensity: { ...state.chapterDensity, [chapterKey]: density },
    })),

  setView: (view) => set({ view }),

  setLiveStatus: (liveStatus) => set({ liveStatus }),

  addLiveEvent: (event) =>
    set((state) => ({
      liveEvents: [event, ...state.liveEvents].slice(0, 200),
    })),

  setLastEventAt: (lastEventAt) => set({ lastEventAt }),

  setCheckRuns: (checkRuns) => set({ checkRuns }),

  setShortcutsHelpOpen: (shortcutsHelpOpen) => set({ shortcutsHelpOpen }),
}));
