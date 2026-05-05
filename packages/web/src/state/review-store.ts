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
import type { AccentId } from '../lib/accents';

type Theme = 'light' | 'dark' | 'auto';
type Density = 'terse' | 'normal' | 'verbose';
type View = 'story' | 'files';
type StoryStructure = 'chapters' | 'linear' | 'outline';
type VisualStyle = 'stripe' | 'linear' | 'github';
type LayoutMode = 'toc' | 'linear';
type DisplayDensity = 'comfortable' | 'compact';

export type BackendConfig = {
  theme?: Theme;
  accent?: AccentId;
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
  accent: AccentId;
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
  narrativeProgressChars: number;
  narrationOverrides: Record<string, string>;

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
  setAccent: (accent: AccentId) => void;
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
  setNarrativeProgressChars: (chars: number) => void;
  setPr: (pr: PRData) => void;
  setNarrationOverride: (chapterKey: string, text: string) => void;
  clearNarrationOverride: (chapterKey: string) => void;
};

function draftStorageKey(prNumber: number): string {
  return `diffdad.drafts.${prNumber}`;
}

function persistDrafts(state: ReviewState) {
  if (!state.pr) return;
  try {
    localStorage.setItem(draftStorageKey(state.pr.number), JSON.stringify(state.drafts));
  } catch {}
}

function isValidDraft(d: unknown): d is DraftComment {
  if (!d || typeof d !== 'object') return false;
  const obj = d as Record<string, unknown>;
  return typeof obj.id === 'string' && typeof obj.body === 'string';
}

function loadDrafts(prNumber: number): DraftComment[] {
  try {
    const raw = localStorage.getItem(draftStorageKey(prNumber));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.filter(isValidDraft);
    }
  } catch {}
  return [];
}

type InlineComment = { path: string; line: number; body: string; side?: 'LEFT' | 'RIGHT' };

function isSubmittableDraft(d: DraftComment): d is DraftComment & { path: string; line: number } {
  return !!d.path && d.line !== undefined;
}

export function pendingReviewComments(drafts: DraftComment[]): InlineComment[] {
  return drafts.filter(isSubmittableDraft).map((d) => ({ path: d.path, line: d.line, body: d.body, side: d.side }));
}

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
  accent: (localStorage.getItem('diffdad.accent') as AccentId) || 'classic',
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
  narrativeProgressChars: 0,
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
      drafts: loadDrafts(pr.number),
      activeChapterId: narrative.chapters.length > 0 ? 'ch-0' : null,
      chapterDensity: {},
    };
    if (config) {
      if (config.theme && !localStorage.getItem('diffdad.theme')) next.theme = config.theme;
      if (config.accent && !localStorage.getItem('diffdad.accent')) next.accent = config.accent;
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

  addDraft: (draft) =>
    set((state) => {
      const next = { drafts: [...state.drafts, draft] };
      persistDrafts({ ...state, ...next });
      return next;
    }),

  removeDraft: (id) =>
    set((state) => {
      const next = { drafts: state.drafts.filter((d) => d.id !== id) };
      persistDrafts({ ...state, ...next });
      return next;
    }),

  clearDrafts: () =>
    set((state) => {
      if (state.pr) {
        try {
          localStorage.removeItem(draftStorageKey(state.pr.number));
        } catch {}
      }
      return { drafts: [] };
    }),

  setTheme: (theme) => {
    localStorage.setItem('diffdad.theme', theme);
    set({ theme });
  },

  setAccent: (accent) => {
    localStorage.setItem('diffdad.accent', accent);
    set({ accent });
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
  setNarrativeProgressChars: (narrativeProgressChars) => set({ narrativeProgressChars }),
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
