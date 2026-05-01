import { create } from 'zustand';
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
  PRReview,
} from './types';

type Theme = 'light' | 'dark' | 'auto';
type Density = 'terse' | 'normal' | 'verbose';
type View = 'story' | 'files';
type StoryStructure = 'chapters' | 'linear' | 'outline';
type VisualStyle = 'stripe' | 'linear' | 'github';
type LayoutMode = 'toc' | 'linear';
type DisplayDensity = 'comfortable' | 'compact';

export type BackendConfig = {
  theme?: Theme;
  storyStructure?: StoryStructure;
  layoutMode?: LayoutMode;
  displayDensity?: DisplayDensity;
  defaultNarrationDensity?: Density;
  clusterBots?: boolean;
};

type ReviewState = {
  pr: PRData | null;
  narrative: NarrativeResponse | null;
  files: DiffFile[];
  comments: PRComment[];
  checkRuns: CheckRun[];
  reviews: PRReview[];
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
  storyStructure: StoryStructure;
  visualStyle: VisualStyle;
  layoutMode: LayoutMode;
  displayDensity: DisplayDensity;
  collapseNarration: boolean;
  clusterBots: boolean;
  regenerating: boolean;

  setData: (
    pr: PRData,
    narrative: NarrativeResponse,
    files: DiffFile[],
    comments: PRComment[],
    repoUrl?: string | null,
    checkRuns?: CheckRun[],
    config?: BackendConfig | null,
    reviews?: PRReview[],
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
  setReviews: (reviews: PRReview[]) => void;
  setShortcutsHelpOpen: (open: boolean) => void;
  setStoryStructure: (s: StoryStructure) => void;
  setVisualStyle: (s: VisualStyle) => void;
  setLayoutMode: (m: LayoutMode) => void;
  setDisplayDensity: (d: DisplayDensity) => void;
  setCollapseNarration: (v: boolean) => void;
  setClusterBots: (v: boolean) => void;
  setRegenerating: (v: boolean) => void;
  setPr: (pr: PRData) => void;
};

export const useReviewStore = create<ReviewState>((set) => ({
  pr: null,
  narrative: null,
  files: [],
  comments: [],
  checkRuns: [],
  reviews: [],
  repoUrl: null,
  chapterStates: {},
  activeChapterId: null,
  drafts: [],
  openLine: null,
  theme: (localStorage.getItem('diffdad.theme') as Theme) || 'auto',
  density: 'normal',
  chapterDensity: {},
  view: 'story',
  liveStatus: 'connecting',
  liveEvents: [],
  lastEventAt: Date.now(),
  shortcutsHelpOpen: false,
  storyStructure: 'chapters',
  visualStyle: 'stripe',
  layoutMode: 'toc',
  displayDensity: 'comfortable',
  collapseNarration: false,
  clusterBots: true,
  regenerating: false,
  narrationOverrides: {} as Record<string, string>,

  setData: (pr, narrative, files, comments, repoUrl = null, checkRuns = [], config = null, reviews = []) => {
    const storageKey = `diffdad.reviewed.${pr.number}`;
    let saved: Record<string, ChapterState> = {};
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) saved = JSON.parse(raw);
    } catch {}
    const chapterStates: Record<string, ChapterState> = {};
    narrative.chapters.forEach((_, idx) => {
      const key = `ch-${idx}`;
      chapterStates[key] = saved[key] === 'reviewed' ? 'reviewed' : 'reading';
    });
    const next: Partial<ReviewState> = {
      pr,
      narrative,
      files,
      comments,
      checkRuns,
      reviews,
      repoUrl,
      chapterStates,
      activeChapterId: narrative.chapters.length > 0 ? 'ch-0' : null,
      chapterDensity: {},
    };
    if (config) {
      if (config.theme && !localStorage.getItem('diffdad.theme')) next.theme = config.theme;
      if (config.storyStructure) next.storyStructure = config.storyStructure;
      if (config.layoutMode) next.layoutMode = config.layoutMode;
      if (config.displayDensity) next.displayDensity = config.displayDensity;
      if (config.defaultNarrationDensity) next.density = config.defaultNarrationDensity;
      if (typeof config.clusterBots === 'boolean') next.clusterBots = config.clusterBots;
    }
    set(next);
  },

  setActiveChapter: (id) => set({ activeChapterId: id }),

  toggleReviewed: (idx) =>
    set((state) => {
      const key = `ch-${idx}`;
      const current = state.chapterStates[key];
      const next: ChapterState = current === 'reviewed' ? 'reading' : 'reviewed';
      const updated = { ...state.chapterStates, [key]: next };
      if (state.pr) {
        try {
          localStorage.setItem(`diffdad.reviewed.${state.pr.number}`, JSON.stringify(updated));
        } catch {}
      }
      return { chapterStates: updated };
    }),

  setOpenLine: (key) => set({ openLine: key }),

  addComment: (comment) =>
    set((state) => {
      if (state.comments.some((c) => c.id === comment.id)) return state;
      return { comments: [...state.comments, comment] };
    }),

  setComments: (comments) => set({ comments }),

  addDraft: (draft) => set((state) => ({ drafts: [...state.drafts, draft] })),

  removeDraft: (id) => set((state) => ({ drafts: state.drafts.filter((d) => d.id !== id) })),

  clearDrafts: () => set({ drafts: [] }),

  setTheme: (theme) => {
    localStorage.setItem('diffdad.theme', theme);
    set({ theme });
  },

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
  setReviews: (reviews) => set({ reviews }),

  setShortcutsHelpOpen: (shortcutsHelpOpen) => set({ shortcutsHelpOpen }),

  setStoryStructure: (storyStructure) => set({ storyStructure }),
  setVisualStyle: (visualStyle) => set({ visualStyle }),
  setLayoutMode: (layoutMode) => set({ layoutMode }),
  setDisplayDensity: (displayDensity) => set({ displayDensity }),
  setCollapseNarration: (collapseNarration) => set({ collapseNarration }),
  setClusterBots: (clusterBots) => set({ clusterBots }),
  setRegenerating: (regenerating) => set({ regenerating }),
  setPr: (pr) => set({ pr }),
  setNarrationOverride: (chapterKey: string, text: string) =>
    set((s) => ({ narrationOverrides: { ...s.narrationOverrides, [chapterKey]: text } })),
  clearNarrationOverride: (chapterKey: string) =>
    set((s) => {
      const { [chapterKey]: _, ...rest } = s.narrationOverrides;
      return { narrationOverrides: rest };
    }),
}));

export function useResolvedTheme(): 'light' | 'dark' {
  const theme = useReviewStore((s) => s.theme);
  if (theme !== 'auto') return theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
