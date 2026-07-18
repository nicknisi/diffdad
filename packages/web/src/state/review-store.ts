import { create } from 'zustand';
import type {
  Chapter,
  ChapterState,
  CheckRun,
  DiffFile,
  DraftComment,
  LiveEvent,
  LiveStatus,
  NarrativeResponse,
  Plan,
  PRComment,
  PRData,
  PRReview,
  Unit,
} from './types';
import type { RecapResponse } from './recap-types';
import type { AccentId } from '../lib/accents';
import { hashKey } from '../lib/hash';
import { normalizePath } from '../lib/paths';
import { parseRoute, routePath, type Route } from '../lib/units-view';
import type { Theme } from '../lib/theme';
import { type ConfigResponse, type GitHubState, type RedactedConfig, saveConfig } from '../lib/config-client';

type Density = 'terse' | 'normal' | 'verbose';
type View = 'story' | 'files' | 'recap';
type StoryStructure = 'chapters' | 'linear' | 'outline';
type VisualStyle = 'stripe' | 'linear' | 'github';
type LayoutMode = 'toc' | 'linear';
type DisplayDensity = 'comfortable' | 'compact';
export type RecapStatus = 'idle' | 'generating' | 'ready' | 'error';

type ReviewState = {
  pr: PRData | null;
  narrative: NarrativeResponse | null;
  files: DiffFile[];
  comments: PRComment[];
  /**
   * 'command-center' = the daemon's cross-repo dashboard (many units behind one app).
   */
  mode: 'pr' | 'command-center';
  /** Command-center: the daemon's review-unit queue, kept live via the `units` SSE event. */
  units: Unit[];
  /** Wall-clock ms of the last `units` snapshot. Null until the first lands — powers the freshness caption. */
  lastUnitsAt: number | null;
  /** Command-center client-side route (center vs. a drill-in `/units/:id`). */
  route: Route;
  checkRuns: CheckRun[];
  reviews: PRReview[];
  repoUrl: string | null;
  chapterStates: Record<string, ChapterState>;
  activeChapterId: string | null;
  /** Stable repository + PR identity used to isolate browser-local review drafts. */
  reviewKey: string | null;
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
  /** PR-mode settings mount: PR mode has no URL routing, so a full-screen settings view rides this flag. */
  settingsOpen: boolean;
  /** The redacted server config — the settings page's source of truth for field values (null until loaded). */
  serverConfig: RedactedConfig | null;
  /** Effective GitHub state from the server (env → gh → config). Null until the first config load. */
  github: GitHubState | null;
  /** True once `GET /api/config` has landed at least once — the single bootstrap source for prefs. */
  configLoaded: boolean;
  storyStructure: StoryStructure;
  visualStyle: VisualStyle;
  layoutMode: LayoutMode;
  displayDensity: DisplayDensity;
  /** Walkthrough rail (BeatRail) collapsed to a thin strip. Per-browser UI pref, persisted. */
  railCollapsed: boolean;
  collapseNarration: boolean;
  clusterBots: boolean;
  regenerating: boolean;
  narrativeProgressChars: number;
  narrationOverrides: Record<string, string>;
  /** Resolve-item ids the reviewer has marked done (walkthrough resolve strips). */
  resolved: Record<string, boolean>;
  aiPath: 'api' | 'local-cli' | null;

  /** Most recent plan from the planner pass; arrives via the `plan-ready` SSE event before any chapter prose lands. */
  plan: Plan | null;
  /** Theme IDs whose writer call hasn't returned yet — used to render shimmer/loading state on those chapters. */
  pendingChapterThemeIds: Set<string>;

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
  setMode: (mode: 'pr' | 'command-center') => void;
  setUnits: (units: Unit[]) => void;
  /** Stamp the freshness clock when a `units` snapshot lands. */
  setLastUnitsAt: (ts: number) => void;
  /** Navigate the command center, pushing browser history (deep-linkable `/units/:id`). */
  navigate: (route: Route) => void;
  /** Sync the route from the address bar without pushing history (popstate / initial load). */
  setRoute: (route: Route) => void;
  addDraft: (draft: DraftComment) => void;
  upsertDraft: (draft: DraftComment) => void;
  removeDraft: (id: string) => void;
  removeDraftsAt: (draft: Pick<DraftComment, 'path' | 'line' | 'chapterIndex'>) => void;
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
  setSettingsOpen: (open: boolean) => void;
  /**
   * The single funnel for applying server config to state — used by bootstrap, PUT responses, and the
   * SSE `config` event alike, so no two settings tabs can drift. Maps the redacted config onto the
   * display prefs and stores the raw config + effective `github` state for the settings page.
   */
  applyConfigResponse: (res: ConfigResponse) => void;
  setStoryStructure: (s: StoryStructure) => void;
  setVisualStyle: (s: VisualStyle) => void;
  setLayoutMode: (m: LayoutMode) => void;
  setDisplayDensity: (d: DisplayDensity) => void;
  setRailCollapsed: (v: boolean) => void;
  setCollapseNarration: (v: boolean) => void;
  setClusterBots: (v: boolean) => void;
  setRegenerating: (v: boolean) => void;
  setNarrativeProgressChars: (chars: number) => void;
  setAiPath: (path: 'api' | 'local-cli' | null) => void;
  setPr: (pr: PRData) => void;
  setNarrationOverride: (chapterKey: string, text: string) => void;
  clearNarrationOverride: (chapterKey: string) => void;
  /** Mark a walkthrough resolve item done (or undone). */
  setResolved: (id: string, value: boolean) => void;
  /** Update narrative incrementally as it streams in. Preserves chapter states and drafts. */
  applyPartialNarrative: (pr: PRData, narrative: NarrativeResponse, files?: DiffFile[], comments?: PRComment[]) => void;
  /** Apply a planner-pass result: synthesize a placeholder narrative so the outline renders before any prose lands. */
  applyPlan: (plan: Plan) => void;
  /** Replace the chapter at `index` with prose from a writer-pass result. */
  applyChapter: (index: number, chapter: Chapter, themeId: string) => void;
  setRecap: (recap: RecapResponse | null) => void;
  setRecapStatus: (status: RecapStatus) => void;
  setRecapError: (error: string | null) => void;
};

/**
 * `localStorage` is undefined outside a browser — Vitest's node worker, `bun test`, SSR.
 * Referencing it at module-eval time (store init) or in an action would throw and crash the
 * import. Guard every access so the store loads anywhere and persistence simply no-ops when
 * there's no backing storage. Uses the bare `localStorage` identifier (never `safeStorage.`)
 * so call sites elsewhere can be rewritten to `safeStorage.` without touching this wrapper.
 */
function storageBackend(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

const safeStorage = {
  getItem: (key: string): string | null => storageBackend()?.getItem(key) ?? null,
  setItem: (key: string, value: string): void => {
    storageBackend()?.setItem(key, value);
  },
  removeItem: (key: string): void => {
    storageBackend()?.removeItem(key);
  },
};

export function reviewDraftKey(repo: string | null, prNumber: number): string {
  const normalizedRepo = repo?.replace(/^https:\/\/github\.com\//, '').replace(/\/$/, '') || 'local';
  return `${normalizedRepo}#${prNumber}`;
}

function draftStorageKey(reviewKey: string): string {
  return `diffdad.drafts.${reviewKey}`;
}

function legacyDraftStorageKey(prNumber: number): string {
  return `diffdad.drafts.${prNumber}`;
}

export function draftAnchorKey(draft: Pick<DraftComment, 'path' | 'line' | 'chapterIndex'>): string | null {
  if (draft.path && draft.line != null) return `${draft.path}:${draft.line}`;
  if (draft.chapterIndex != null) return `chapter:${draft.chapterIndex}`;
  return null;
}

function persistDrafts(state: ReviewState) {
  if (!state.reviewKey) return;
  try {
    safeStorage.setItem(draftStorageKey(state.reviewKey), JSON.stringify(state.drafts));
  } catch {}
}

function isValidDraft(d: unknown): d is DraftComment {
  if (!d || typeof d !== 'object') return false;
  const obj = d as Record<string, unknown>;
  return typeof obj.id === 'string' && typeof obj.body === 'string';
}

export function loadDrafts(reviewKey: string, legacyPrNumber?: number): DraftComment[] {
  try {
    const scopedRaw = safeStorage.getItem(draftStorageKey(reviewKey));
    if (scopedRaw) {
      const parsed = JSON.parse(scopedRaw);
      if (Array.isArray(parsed)) return parsed.filter(isValidDraft);
    }

    if (legacyPrNumber !== undefined) {
      const legacyKey = legacyDraftStorageKey(legacyPrNumber);
      const legacyRaw = safeStorage.getItem(legacyKey);
      if (legacyRaw) {
        const parsed = JSON.parse(legacyRaw);
        if (Array.isArray(parsed)) {
          const drafts = parsed.filter(isValidDraft);
          safeStorage.setItem(draftStorageKey(reviewKey), JSON.stringify(drafts));
          safeStorage.removeItem(legacyKey);
          return drafts;
        }
      }
    }
  } catch {}
  return [];
}

// ---- Durable review state (resolved findings + reviewed chapters) -------------------------------
//
// Both maps persist per repo+PR (`reviewKey`) and are keyed by CONTENT, never by array position:
// finding ids are content-addressed in walkthrough.ts, and reviewed chapters key on a hash of their
// member hunks. That's what lets the reviewer's work survive reloads, regenerations, and pushes —
// a regeneration that reorders chapters or concerns re-derives the same keys for unchanged content.

function resolvedStorageKey(reviewKey: string): string {
  return `diffdad.resolved.${reviewKey}`;
}

export function loadResolved(reviewKey: string): Record<string, boolean> {
  try {
    const raw = safeStorage.getItem(resolvedStorageKey(reviewKey));
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed && typeof parsed === 'object') {
        const out: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(parsed)) if (v === true) out[k] = true;
        return out;
      }
    }
  } catch {}
  return {};
}

function persistResolved(reviewKey: string, resolved: Record<string, boolean>) {
  try {
    const persisted: Record<string, true> = {};
    for (const [k, v] of Object.entries(resolved)) if (v) persisted[k] = true;
    safeStorage.setItem(resolvedStorageKey(reviewKey), JSON.stringify(persisted));
  } catch {}
}

function reviewedStorageKey(reviewKey: string): string {
  return `diffdad.reviewed.${reviewKey}`;
}

function loadReviewed(reviewKey: string): Record<string, 'reviewed'> {
  try {
    const raw = safeStorage.getItem(reviewedStorageKey(reviewKey));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, 'reviewed'>;
    }
  } catch {}
  return {};
}

/**
 * A chapter's stable identity: hash of its member hunks' content (sorted, so writer reordering
 * within the chapter doesn't matter). A push that changes a chapter's hunks changes its key —
 * resetting reviewed-state for exactly the chapters whose code changed. Chapters with no
 * resolvable diff sections (plan placeholders, empty chapters) fall back to a title hash.
 */
export function chapterContentKey(chapter: Chapter, files: DiffFile[]): string {
  const parts: string[] = [];
  for (const s of chapter.sections ?? []) {
    if (s.type !== 'diff') continue;
    const norm = normalizePath(s.file);
    const hunk = files.find((f) => normalizePath(f.file) === norm)?.hunks[s.hunkIndex];
    parts.push(hunk ? hashKey(hunk.lines.map((l) => `${l.type}${l.content}`).join('\n')) : `${norm}:${s.hunkIndex}`);
  }
  if (parts.length === 0) return `title:${hashKey(chapter.title ?? '')}`;
  parts.sort();
  return hashKey(parts.join('|'));
}

/** Runtime chapter states (`ch-${idx}` keys) rebuilt from the persisted content-keyed reviewed map. */
function buildChapterStates(
  narrative: NarrativeResponse,
  files: DiffFile[],
  reviewKey: string,
): Record<string, ChapterState> {
  const saved = loadReviewed(reviewKey);
  const states: Record<string, ChapterState> = {};
  (narrative.chapters ?? []).forEach((ch, idx) => {
    states[`ch-${idx}`] = saved[chapterContentKey(ch, files)] === 'reviewed' ? 'reviewed' : 'reading';
  });
  return states;
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

export const useReviewStore = create<ReviewState>((set, get) => ({
  pr: null,
  narrative: null,
  files: [],
  comments: [],
  mode: 'pr',
  units: [],
  lastUnitsAt: null,
  route: typeof window !== 'undefined' ? parseRoute(window.location.pathname) : { name: 'center' },
  checkRuns: [],
  reviews: [],
  repoUrl: null,
  chapterStates: {},
  activeChapterId: null,
  reviewKey: null,
  drafts: [],
  openLine: null,
  commentRangeStart: null,
  commentDrag: null,
  // Prefs are no longer read from localStorage — `GET /api/config` (applied via `applyConfigResponse`
  // at bootstrap) is the single source. Start on `auto`/`classic` so a cold load tracks the OS theme
  // until config lands (a sub-100ms flash to the configured theme is accepted).
  theme: 'auto',
  accent: 'classic',
  density: 'normal',
  chapterDensity: {},
  view: 'story',
  liveStatus: 'connecting',
  liveEvents: [],
  lastEventAt: Date.now(),
  shortcutsHelpOpen: false,
  submitOpen: false,
  settingsOpen: false,
  serverConfig: null,
  github: null,
  configLoaded: false,
  storyStructure: 'chapters',
  visualStyle: 'stripe',
  layoutMode: 'toc',
  displayDensity: 'comfortable',
  railCollapsed: safeStorage.getItem('diffdad.railCollapsed') === '1',
  collapseNarration: false,
  clusterBots: true,
  regenerating: false,
  narrativeProgressChars: 0,
  aiPath: null,
  narrationOverrides: {} as Record<string, string>,
  resolved: {},

  recap: null,
  recapStatus: 'idle',
  recapError: null,

  plan: null,
  pendingChapterThemeIds: new Set<string>(),

  setData: (pr, narrative, files, comments, repoUrl = null, checkRuns = [], reviews = []) => {
    const safeNarrative = sanitizeNarrative(narrative);
    const nextReviewKey = reviewDraftKey(repoUrl, pr.number);
    const next: Partial<ReviewState> = {
      pr,
      narrative: safeNarrative,
      files,
      comments,
      checkRuns,
      reviews,
      repoUrl,
      chapterStates: buildChapterStates(safeNarrative, files, nextReviewKey),
      reviewKey: nextReviewKey,
      drafts: loadDrafts(nextReviewKey, pr.number),
      activeChapterId: safeNarrative.chapters.length > 0 ? 'ch-0' : null,
      chapterDensity: {},
      // Resolved findings are durable (content-addressed ids) — restore, never wipe. Ids that no
      // longer match any current finding simply don't render.
      resolved: loadResolved(nextReviewKey),
      narrationOverrides: {},
      openLine: null,
      commentRangeStart: null,
      commentDrag: null,
    };
    // Display prefs are seeded by `applyConfigResponse` (from `GET /api/config`), not from the
    // narrative payload — see Phase 2. `setData` no longer touches theme/accent/etc.
    set(next);
  },

  setActiveChapter: (id) => set({ activeChapterId: id }),

  toggleReviewed: (idx) =>
    set((state) => {
      const key = `ch-${idx}`;
      const current = state.chapterStates[key];
      const next: ChapterState = current === 'reviewed' ? 'reading' : 'reviewed';
      const updated = { ...state.chapterStates, [key]: next };
      // Persist by the chapter's content identity, merged into the existing map — stale keys from
      // earlier narrative versions are harmless and keep resolution stable across regenerations.
      const chapter = state.narrative?.chapters[idx];
      if (state.reviewKey && chapter) {
        try {
          const saved = loadReviewed(state.reviewKey);
          const contentKey = chapterContentKey(chapter, state.files);
          if (next === 'reviewed') saved[contentKey] = 'reviewed';
          else delete saved[contentKey];
          safeStorage.setItem(reviewedStorageKey(state.reviewKey), JSON.stringify(saved));
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
  setMode: (mode) => set({ mode }),
  setUnits: (units) => set({ units }),
  setLastUnitsAt: (lastUnitsAt) => set({ lastUnitsAt }),

  navigate: (route) => {
    if (typeof window !== 'undefined') window.history.pushState(null, '', routePath(route));
    set({ route });
  },
  setRoute: (route) => set({ route }),

  addDraft: (draft) =>
    set((state) => {
      const next = { drafts: [...state.drafts, draft] };
      persistDrafts({ ...state, ...next });
      return next;
    }),

  upsertDraft: (draft) =>
    set((state) => {
      const key = draftAnchorKey(draft);
      const drafts = key
        ? [...state.drafts.filter((existing) => draftAnchorKey(existing) !== key), draft]
        : [...state.drafts, draft];
      const next = { drafts };
      persistDrafts({ ...state, ...next });
      return next;
    }),

  removeDraft: (id) =>
    set((state) => {
      const next = { drafts: state.drafts.filter((d) => d.id !== id) };
      persistDrafts({ ...state, ...next });
      return next;
    }),

  removeDraftsAt: (draft) =>
    set((state) => {
      const key = draftAnchorKey(draft);
      if (!key) return state;
      const next = { drafts: state.drafts.filter((existing) => draftAnchorKey(existing) !== key) };
      persistDrafts({ ...state, ...next });
      return next;
    }),

  clearDrafts: () =>
    set((state) => {
      if (state.reviewKey) {
        try {
          safeStorage.removeItem(draftStorageKey(state.reviewKey));
        } catch {}
      }
      return { drafts: [] };
    }),

  // Theme/accent write through to the server config: flip the store optimistically (the UI reacts
  // instantly), then PUT the one-key patch and reconcile via `applyConfigResponse` (last write wins;
  // Phase 1 serializes writes server-side). A failed save keeps the optimistic value — the user can
  // retry by re-toggling — and never throws out of the fire-and-forget promise.
  setTheme: (theme) => {
    set({ theme });
    void saveConfig({ theme })
      .then((res) => get().applyConfigResponse(res))
      .catch(() => {});
  },

  setAccent: (accent) => {
    set({ accent });
    void saveConfig({ accent })
      .then((res) => get().applyConfigResponse(res))
      .catch(() => {});
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
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),

  applyConfigResponse: (res) => {
    const cfg = res.config;
    const next: Partial<ReviewState> = {
      serverConfig: cfg,
      github: res.github,
      configLoaded: true,
    };
    // Map the redacted config onto the display-pref state. Guard each key so a partial config never
    // clobbers a good default with `undefined`. `defaultNarrationDensity` lands on the store's `density`.
    if (cfg.theme) next.theme = cfg.theme;
    if (cfg.accent) next.accent = cfg.accent;
    if (cfg.storyStructure) next.storyStructure = cfg.storyStructure;
    if (cfg.layoutMode) next.layoutMode = cfg.layoutMode;
    if (cfg.displayDensity) next.displayDensity = cfg.displayDensity;
    if (cfg.defaultNarrationDensity) next.density = cfg.defaultNarrationDensity;
    if (typeof cfg.clusterBots === 'boolean') next.clusterBots = cfg.clusterBots;
    set(next);
  },

  setStoryStructure: (storyStructure) => set({ storyStructure }),
  setVisualStyle: (visualStyle) => set({ visualStyle }),
  setLayoutMode: (layoutMode) => set({ layoutMode }),
  setDisplayDensity: (displayDensity) => set({ displayDensity }),
  setRailCollapsed: (railCollapsed) => {
    safeStorage.setItem('diffdad.railCollapsed', railCollapsed ? '1' : '0');
    set({ railCollapsed });
  },
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

  applyPlan: (plan) =>
    set((state) => {
      // Build a placeholder narrative from the plan so existing components
      // (StoryView, Chapter, etc.) can render an outline immediately. Each
      // chapter shows its title and risk; prose fills in as writer-pass
      // chapters arrive via `applyChapter`.
      const placeholderChapters: Chapter[] = plan.themes.map((t) => ({
        title: t.title,
        summary: t.rationale,
        whyMatters: '',
        risk: t.riskLevel,
        sections: [],
        themeId: t.id,
      }));
      const skeleton: NarrativeResponse = {
        title: plan.prTitle,
        tldr: plan.prTldr,
        verdict: plan.prVerdict,
        readingPlan: plan.readingPlan,
        concerns: plan.concerns,
        chapters: placeholderChapters,
        missing: plan.missing,
      };
      const safeNarrative = sanitizeNarrative(skeleton);
      // Fresh states, never merged: carrying `ch-${idx}` entries across a plan that reorders
      // chapters would transfer "reviewed" to the wrong chapter. `applyChapter` restores each
      // chapter's persisted reviewed-state by content identity once its real hunks land.
      const chapterStates: Record<string, ChapterState> = {};
      safeNarrative.chapters.forEach((_, idx) => (chapterStates[`ch-${idx}`] = 'reading'));
      const pending = new Set<string>();
      for (const t of plan.themes) {
        if (!t.suppress) pending.add(t.id);
      }
      return {
        plan,
        narrative: safeNarrative,
        chapterStates,
        pendingChapterThemeIds: pending,
        narrationOverrides: {},
        chapterDensity: {},
        // `resolved` is deliberately NOT wiped: finding ids are content-addressed, so items the
        // reviewer already cleared stay cleared when the new plan re-raises the same questions.
        activeChapterId: state.activeChapterId ?? (placeholderChapters.length > 0 ? 'ch-0' : null),
      };
    }),

  applyChapter: (index, chapter, themeId) =>
    set((state) => {
      if (!state.narrative) return state;
      const chapters = [...state.narrative.chapters];
      if (index < 0 || index >= chapters.length) return state;
      chapters[index] = chapter;
      const next: NarrativeResponse = { ...state.narrative, chapters };
      const pending = new Set(state.pendingChapterThemeIds);
      pending.delete(themeId);
      const result: Partial<ReviewState> = { narrative: sanitizeNarrative(next), pendingChapterThemeIds: pending };
      // The chapter's content identity is only known once its real hunks land — restore any
      // persisted reviewed-state now, so an unchanged chapter stays reviewed across regeneration.
      if (state.reviewKey && loadReviewed(state.reviewKey)[chapterContentKey(chapter, state.files)] === 'reviewed') {
        result.chapterStates = { ...state.chapterStates, [`ch-${index}`]: 'reviewed' };
      }
      return result;
    }),
  setNarrationOverride: (chapterKey: string, text: string) =>
    set((s) => ({ narrationOverrides: { ...s.narrationOverrides, [chapterKey]: text } })),
  clearNarrationOverride: (chapterKey: string) =>
    set((s) => {
      const { [chapterKey]: _, ...rest } = s.narrationOverrides;
      return { narrationOverrides: rest };
    }),

  setResolved: (id, value) =>
    set((s) => {
      const resolved = { ...s.resolved, [id]: value };
      if (s.reviewKey) persistResolved(s.reviewKey, resolved);
      return { resolved };
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

/**
 * Feed a daemon unit's diff slice + brief into the review store so the existing review surface
 * (StoryView / ClassicView, both store-driven) renders it. Set directly rather than via `setData`
 * so PR-mode-only behaviors (legacy draft migration, reviewed-chapter restore) can't bleed in.
 *
 * Drafts are keyed by repo+PR (`reviewKey`). Switching to a DIFFERENT review resets the PR-scoped
 * transient state (resolve work, narration overrides, open composers, recap); a same-unit re-apply
 * (SSE tick, hydrate response) preserves all of it. A stale `recap` view coerces to `story` because
 * units have no unit-scoped recap endpoint.
 *
 * Comments are intentionally NOT set here: they're loaded live from GitHub by the drill-in's
 * comment effect. Clobbering them on every live re-apply would wipe the loaded thread each time
 * the unit's `updatedAt` ticks.
 */
export function applyUnitToStore(unit: Unit): void {
  const narrative = unit.narrative ?? null;
  const files = unit.files ?? [];

  const current = useReviewStore.getState();
  const nextReviewKey = reviewDraftKey(unit.repo, unit.metadata?.number ?? unit.prNumber ?? 0);
  const switchingReview = current.reviewKey !== nextReviewKey;

  useReviewStore.setState({
    pr: unit.metadata ?? null,
    files,
    narrative,
    repoUrl: `https://github.com/${unit.repo}`,
    reviewKey: nextReviewKey,
    // Rebuilt from the persisted content-keyed map — lossless on same-unit re-applies because
    // toggleReviewed writes through on every change.
    chapterStates: narrative ? buildChapterStates(narrative, files, nextReviewKey) : {},
    activeChapterId: narrative && narrative.chapters.length > 0 ? 'ch-0' : null,
    view: current.view === 'recap' ? 'story' : current.view,
    drafts: loadDrafts(nextReviewKey),
    ...(switchingReview
      ? {
          resolved: loadResolved(nextReviewKey),
          narrationOverrides: {},
          chapterDensity: {},
          openLine: null,
          commentRangeStart: null,
          commentDrag: null,
          submitOpen: false,
          recap: null,
          recapStatus: 'idle' as const,
          recapError: null,
        }
      : {}),
  });
}
