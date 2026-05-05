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
import type { RecapResponse } from './recap-types';
import type { AccentId } from '../lib/accents';

type Theme = 'light' | 'dark' | 'auto';
type Density = 'terse' | 'normal' | 'verbose';
type View = 'story' | 'files' | 'recap';
type StoryStructure = 'chapters' | 'linear' | 'outline';
type VisualStyle = 'stripe' | 'linear' | 'github';
type LayoutMode = 'toc' | 'linear';
type DisplayDensity = 'comfortable' | 'compact';
export type RecapStatus = 'idle' | 'generating' | 'ready' | 'error';

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
  /** Anchor of an in-progress multi-line selection. `lineKey` of the first
   * line clicked; `openLine` is the most recently shift-clicked line. The
   * effective range is min..max of these two by line index within the same
   * hunk. Null when the active comment is single-line. */
  commentRangeStart: string | null;
  /** Live state of a click-and-drag from a `+` gutter button. While set, the
   * range between `startKey` and `endKey` is highlighted but the comment
   * composer is NOT opened — that happens on mouseup, when the drag is
   * committed to `openLine` / `commentRangeStart`. */
  commentDrag: { startKey: string; endKey: string } | null;
  theme: Theme;
  accent: AccentId;
  density: Density;
  chapterDensity: Record<string, Density>;
  view: View;
  liveStatus: LiveStatus;
  liveEvents: LiveEvent[];
  lastEventAt: number;
  shortcutsHelpOpen: boolean;
  submitOpen: boolean;
  storyStructure: StoryStructure;
  visualStyle: VisualStyle;
  layoutMode: LayoutMode;
  displayDensity: DisplayDensity;
  collapseNarration: boolean;
  clusterBots: boolean;
  regenerating: boolean;
  narrativeProgressChars: number;
  narrationOverrides: Record<string, string>;
  aiPath: 'api' | 'local-cli' | null;

  recap: RecapResponse | null;
  recapStatus: RecapStatus;
  recapError: string | null;

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
  /** Open a comment thread on `key`. When `extend` is true and `openLine` is
   * already set within the same hunk, anchor a range from the current
   * `openLine` to `key`. */
  openCommentAt: (key: string, extend?: boolean) => void;
  /** Drop the multi-line range anchor without closing the active thread.
   * Used when a range becomes invalid (e.g. user extended across diff sides). */
  clearCommentRange: () => void;
  /** Begin a click-and-drag selection. */
  startCommentDrag: (key: string) => void;
  /** Update the drag end as the mouse moves. */
  updateCommentDrag: (key: string) => void;
  /** Commit the current drag: a same-key drag becomes a single-line click;
   * a cross-key drag becomes a multi-line range with the composer opened. */
  endCommentDrag: () => void;
  /** Discard the in-progress drag without opening a composer. */
  cancelCommentDrag: () => void;
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
  setSubmitOpen: (open: boolean) => void;
  setStoryStructure: (s: StoryStructure) => void;
  setVisualStyle: (s: VisualStyle) => void;
  setLayoutMode: (m: LayoutMode) => void;
  setDisplayDensity: (d: DisplayDensity) => void;
  setCollapseNarration: (v: boolean) => void;
  setClusterBots: (v: boolean) => void;
  setRegenerating: (v: boolean) => void;
  setNarrativeProgressChars: (chars: number) => void;
  setAiPath: (path: 'api' | 'local-cli' | null) => void;
  setPr: (pr: PRData) => void;
  setNarrationOverride: (chapterKey: string, text: string) => void;
  clearNarrationOverride: (chapterKey: string) => void;
  /** Update narrative incrementally as it streams in. Preserves chapter states and drafts. */
  applyPartialNarrative: (pr: PRData, narrative: NarrativeResponse, files?: DiffFile[], comments?: PRComment[]) => void;
  setRecap: (recap: RecapResponse | null) => void;
  setRecapStatus: (status: RecapStatus) => void;
  setRecapError: (error: string | null) => void;
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

type InlineComment = {
  path: string;
  line: number;
  body: string;
  side?: 'LEFT' | 'RIGHT';
  startLine?: number;
  startSide?: 'LEFT' | 'RIGHT';
};

/** Server-streamed narratives can arrive with chapters/sections/etc. still
 * filling in (especially during live regeneration). Render code assumes the
 * usual array fields exist, so normalize at the store boundary — if we don't
 * a `.map` or `.filter` on `undefined` mid-stream will crash the React tree
 * and the user sees a blank page. */
function sanitizeNarrative(n: NarrativeResponse): NarrativeResponse {
  return {
    ...n,
    chapters: Array.isArray(n.chapters)
      ? n.chapters.map((ch) => ({
          ...ch,
          title: typeof ch?.title === 'string' ? ch.title : '',
          summary: typeof ch?.summary === 'string' ? ch.summary : '',
          whyMatters: typeof ch?.whyMatters === 'string' ? ch.whyMatters : '',
          risk: ch?.risk === 'high' || ch?.risk === 'medium' ? ch.risk : 'low',
          sections: Array.isArray(ch?.sections) ? ch.sections : [],
          callouts: Array.isArray(ch?.callouts) ? ch.callouts : undefined,
          reshow: Array.isArray(ch?.reshow) ? ch.reshow : undefined,
        }))
      : [],
    concerns: Array.isArray(n.concerns) ? n.concerns : [],
    readingPlan: Array.isArray(n.readingPlan) ? n.readingPlan : [],
    missing: Array.isArray(n.missing) ? n.missing : undefined,
  };
}

function isSubmittableDraft(d: DraftComment): d is DraftComment & { path: string; line: number } {
  return !!d.path && d.line !== undefined;
}

export function pendingReviewComments(drafts: DraftComment[]): InlineComment[] {
  return drafts.filter(isSubmittableDraft).map((d) => ({
    path: d.path,
    line: d.line,
    body: d.body,
    side: d.side,
    startLine: d.startLine,
    startSide: d.startSide,
  }));
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
  commentRangeStart: null,
  commentDrag: null,
  theme: (localStorage.getItem('diffdad.theme') as Theme) || 'auto',
  accent: (localStorage.getItem('diffdad.accent') as AccentId) || 'classic',
  density: 'normal',
  chapterDensity: {},
  view: 'story',
  liveStatus: 'connecting',
  liveEvents: [],
  lastEventAt: Date.now(),
  shortcutsHelpOpen: false,
  submitOpen: false,
  storyStructure: 'chapters',
  visualStyle: 'stripe',
  layoutMode: 'toc',
  displayDensity: 'comfortable',
  collapseNarration: false,
  clusterBots: true,
  regenerating: false,
  narrativeProgressChars: 0,
  aiPath: null,
  narrationOverrides: {} as Record<string, string>,

  recap: null,
  recapStatus: 'idle',
  recapError: null,

  setData: (pr, narrative, files, comments, repoUrl = null, checkRuns = [], config = null, reviews = []) => {
    const safeNarrative = sanitizeNarrative(narrative);
    const storageKey = `diffdad.reviewed.${pr.number}`;
    let saved: Record<string, ChapterState> = {};
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) saved = JSON.parse(raw);
    } catch {}
    const chapterStates: Record<string, ChapterState> = {};
    safeNarrative.chapters.forEach((_, idx) => {
      const key = `ch-${idx}`;
      chapterStates[key] = saved[key] === 'reviewed' ? 'reviewed' : 'reading';
    });
    const next: Partial<ReviewState> = {
      pr,
      narrative: safeNarrative,
      files,
      comments,
      checkRuns,
      reviews,
      repoUrl,
      chapterStates,
      drafts: loadDrafts(pr.number),
      activeChapterId: safeNarrative.chapters.length > 0 ? 'ch-0' : null,
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

  setOpenLine: (key) => set({ openLine: key, commentRangeStart: null }),

  clearCommentRange: () => set({ commentRangeStart: null }),

  startCommentDrag: (key) => set({ commentDrag: { startKey: key, endKey: key } }),

  updateCommentDrag: (key) =>
    set((state) => {
      if (!state.commentDrag) return state;
      if (state.commentDrag.endKey === key) return state;
      return { commentDrag: { startKey: state.commentDrag.startKey, endKey: key } };
    }),

  endCommentDrag: () =>
    set((state) => {
      const drag = state.commentDrag;
      if (!drag) return state;
      if (drag.startKey === drag.endKey) {
        return { commentDrag: null, openLine: drag.startKey, commentRangeStart: null };
      }
      return { commentDrag: null, openLine: drag.endKey, commentRangeStart: drag.startKey };
    }),

  cancelCommentDrag: () => set({ commentDrag: null }),

  openCommentAt: (key, extend = false) =>
    set((state) => {
      // Only extend within the same hunk. lineKey format: `${file}:${hunkIndex}:${lineIdx}`.
      function hunkPrefix(k: string): string {
        const lastColon = k.lastIndexOf(':');
        return lastColon === -1 ? k : k.slice(0, lastColon);
      }
      if (extend && state.openLine && state.openLine !== key && hunkPrefix(state.openLine) === hunkPrefix(key)) {
        // Anchor the range at whichever side the user already had open.
        const anchor = state.commentRangeStart ?? state.openLine;
        return { openLine: key, commentRangeStart: anchor };
      }
      return { openLine: key, commentRangeStart: null };
    }),

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
  setSubmitOpen: (submitOpen) => set({ submitOpen }),

  setStoryStructure: (storyStructure) => set({ storyStructure }),
  setVisualStyle: (visualStyle) => set({ visualStyle }),
  setLayoutMode: (layoutMode) => set({ layoutMode }),
  setDisplayDensity: (displayDensity) => set({ displayDensity }),
  setCollapseNarration: (collapseNarration) => set({ collapseNarration }),
  setClusterBots: (clusterBots) => set({ clusterBots }),
  setRegenerating: (regenerating) => set({ regenerating }),
  setNarrativeProgressChars: (narrativeProgressChars) =>
    set((state) => (state.narrativeProgressChars === narrativeProgressChars ? state : { narrativeProgressChars })),
  setAiPath: (aiPath) => set({ aiPath }),
  setPr: (pr) => set({ pr }),
  applyPartialNarrative: (pr, narrative, files, comments) =>
    set((state) => {
      const safeNarrative = sanitizeNarrative(narrative);
      const next: Partial<ReviewState> = { pr, narrative: safeNarrative };
      if (files) next.files = files;
      if (comments) next.comments = comments;
      // Initialize chapter states for any newly streamed chapters without
      // clobbering ones the user has already marked reviewed.
      const chapterStates: Record<string, ChapterState> = { ...state.chapterStates };
      safeNarrative.chapters.forEach((_, idx) => {
        const key = `ch-${idx}`;
        if (!chapterStates[key]) chapterStates[key] = 'reading';
      });
      next.chapterStates = chapterStates;
      if (state.activeChapterId === null && safeNarrative.chapters.length > 0) {
        next.activeChapterId = 'ch-0';
      }
      return next;
    }),
  setNarrationOverride: (chapterKey: string, text: string) =>
    set((s) => ({ narrationOverrides: { ...s.narrationOverrides, [chapterKey]: text } })),
  clearNarrationOverride: (chapterKey: string) =>
    set((s) => {
      const { [chapterKey]: _, ...rest } = s.narrationOverrides;
      return { narrationOverrides: rest };
    }),

  setRecap: (recap) => set({ recap, recapStatus: recap ? 'ready' : 'idle', recapError: null }),
  setRecapStatus: (recapStatus) => set({ recapStatus }),
  setRecapError: (recapError) => set({ recapError, recapStatus: recapError ? 'error' : 'idle' }),
}));

export function useResolvedTheme(): 'light' | 'dark' {
  const theme = useReviewStore((s) => s.theme);
  if (theme !== 'auto') return theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
