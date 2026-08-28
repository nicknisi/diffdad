import { useEffect } from 'react';
import { type SseEvent, sseEventSchema } from '@diffdad/contracts';
import { useReviewStore } from '../state/review-store';
import type { CheckRun, LiveEvent, LiveEventKind, PRReview } from '../state/types';
import type { ConfigResponse } from '../lib/config-client';

/** The `data` payload type for a given SSE event name, drawn from the contract union. */
type SseData<E extends SseEvent['event']> = Extract<SseEvent, { event: E }>['data'];

/**
 * Type-level SSE decode: `JSON.parse` the message and hand back the contract-typed payload for
 * `event`. No runtime zod on the hot path — the DEV-only `safeParse` is a drift tripwire, compiled
 * out of production builds by `import.meta.env.DEV`.
 */
function parseSse<E extends SseEvent['event']>(event: E, e: MessageEvent): SseData<E> {
  const data = JSON.parse(e.data) as SseData<E>;
  if (import.meta.env.DEV) {
    const res = sseEventSchema.safeParse({ event, data });
    if (!res.success) console.warn(`[sse] ${event} payload failed contract validation`, res.error.issues);
  }
  return data;
}

function makeEventId(): string {
  return `ev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeEvent(kind: LiveEventKind, summary: string, data?: unknown): LiveEvent {
  return {
    id: makeEventId(),
    kind,
    summary,
    timestamp: Date.now(),
    data,
  };
}

/**
 * Exported for direct unit testing — see __tests__/useLiveStream.test.ts.
 * Streams an in-flight partial narrative into the store while the server is
 * still generating it. Silently ignores malformed payloads.
 */
export function handleNarrativePartialEvent(e: MessageEvent): void {
  try {
    const data = parseSse('narrative.partial', e);
    const store = useReviewStore.getState();
    store.applyPartialNarrative(data.pr, data.narrative, data.files, data.comments);
    store.setLastEventAt(Date.now());
  } catch {
    // ignore malformed partial
  }
}

/**
 * Apply a `collapse` event: the blast radius for the narrative already on screen.
 *
 * Only the PR server sends this, and only on the path where nothing had resolved a repo snapshot yet (a
 * cached narrative skips generation entirely). It carries no narrative, so it must not touch chapters —
 * it fills in a boundary for the chapters the store already holds. Exported for direct unit testing.
 */
export function handleCollapseEvent(e: MessageEvent): void {
  try {
    const data = parseSse('collapse', e);
    const store = useReviewStore.getState();
    // Nothing to say: a snapshot that resolved to no answer at all leaves the screen as it was.
    if (!data.collapse) return;
    store.setBlastRadius({
      collapse: data.collapse,
      callers: data.callers ?? [],
      // The event describes a snapshot, not a generation — keep whatever budget stats the payload that
      // brought the narrative established. The `collapse` event carries no `capStats` of its own
      // (contract: `SseEvent` → `collapse`), so this always reads the store's existing value.
      capStats: store.capStats,
    });
    store.setLastEventAt(Date.now());
  } catch {
    // ignore malformed payload
  }
}

/**
 * Apply a daemon `unit-comment` event (a comment posted on one unit's PR) to the store — but ONLY
 * when that unit is the one currently open in the drill-in. The daemon is multi-unit, so the event
 * is unit-scoped; without this guard a comment on unit B would leak into unit A's open thread.
 * Exported for direct unit testing. Silently ignores malformed payloads.
 */
export function handleUnitCommentEvent(e: MessageEvent): void {
  try {
    const { unitId, comment } = parseSse('unit-comment', e);
    const state = useReviewStore.getState();
    const open = state.mode === 'command-center' && state.route.name === 'unit' && state.route.unitId === unitId;
    if (!open) return;
    if (state.comments.find((c) => c.id === comment.id)) return; // the poster already added it optimistically
    useReviewStore.setState({ comments: [...state.comments, comment] });
    state.setLastEventAt(Date.now());
  } catch {
    // ignore malformed event
  }
}

export function useLiveStream() {
  useEffect(() => {
    const setLiveStatus = (status: 'connected' | 'connecting' | 'disconnected') =>
      useReviewStore.getState().setLiveStatus(status);
    const addLiveEvent = (event: LiveEvent) => useReviewStore.getState().addLiveEvent(event);
    const setLastEventAt = (ts: number) => useReviewStore.getState().setLastEventAt(ts);
    const setCheckRuns = (checks: CheckRun[]) => useReviewStore.getState().setCheckRuns(checks);

    const es = new EventSource('/api/events');

    const onConnected = () => {
      setLiveStatus('connected');
      setLastEventAt(Date.now());
      addLiveEvent(makeEvent('system', 'Connected to Diff Dad server'));
    };

    const onComment = (e: MessageEvent) => {
      try {
        const comment = parseSse('comment', e);
        useReviewStore.setState((state) => {
          if (state.comments.find((c) => c.id === comment.id)) return state;
          return { comments: [...state.comments, comment] };
        });
        setLastEventAt(Date.now());
        addLiveEvent(makeEvent('comment', `${comment.author} commented on ${comment.path ?? 'PR'}`, comment));
      } catch {
        // ignore malformed event
      }
    };

    const onComments = (e: MessageEvent) => {
      try {
        const comments = parseSse('comments', e);
        useReviewStore.getState().setComments(comments);
        setLastEventAt(Date.now());
      } catch {
        // ignore
      }
    };

    const onChecks = (e: MessageEvent) => {
      try {
        const checks = parseSse('checks', e);
        setCheckRuns(checks);
        setLastEventAt(Date.now());
        addLiveEvent(makeEvent('ci', `CI status updated (${checks.length} checks)`, checks));
      } catch {
        // ignore
      }
    };

    const onReviews = (e: MessageEvent) => {
      try {
        const reviews = parseSse('reviews', e);
        useReviewStore.getState().setReviews(reviews);
        setLastEventAt(Date.now());
      } catch {
        // ignore
      }
    };

    // A config PUT (from another tab, or the same-server saving tab) broadcasts the fresh
    // ConfigResponse. Funnel it through `applyConfigResponse` so open settings tabs and the header
    // theme/accent controls converge — this is also what brings a token-less daemon's UI alive when a
    // token is saved elsewhere (the `github` flag flips without a reload).
    const onConfig = (e: MessageEvent) => {
      try {
        const res = JSON.parse(e.data) as ConfigResponse;
        useReviewStore.getState().applyConfigResponse(res);
        setLastEventAt(Date.now());
      } catch {
        // ignore malformed event
      }
    };

    const onPr = (e: MessageEvent) => {
      try {
        const pr = parseSse('pr', e);
        useReviewStore.getState().setPr(pr);
        setLastEventAt(Date.now());
      } catch {
        // ignore
      }
    };

    // Command center: the daemon broadcasts the full cross-repo queue on every unit change.
    const onUnits = (e: MessageEvent) => {
      try {
        const data = parseSse('units', e);
        useReviewStore.getState().setUnits(data.units ?? [], data.dismissed ?? []);
        // Only stamp the freshness caption on real GitHub poll passes: `pollOnce` tags its broadcast
        // with `polledAt`. Other `units` broadcasts (decision/delete/hydrate/review/initial snapshot,
        // and SSE reconnects) never re-query GitHub, so stamping them would falsely reset "checked …".
        if (typeof data.polledAt === 'number') useReviewStore.getState().setLastUnitsAt(data.polledAt);
        setLastEventAt(Date.now());
      } catch {
        // ignore malformed event
      }
    };

    const onRegenerating = (e: MessageEvent) => {
      try {
        const data = parseSse('regenerating', e);
        addLiveEvent(
          makeEvent('system', `New commits detected (${data.previousSha} → ${data.newSha}). Regenerating narrative...`),
        );
        useReviewStore.getState().setRegenerating(true);
        useReviewStore.getState().setNarrativeProgressChars(0);
      } catch {
        // ignore
      }
    };

    const onNarrativeProgress = (e: MessageEvent) => {
      try {
        const data = parseSse('narrative-progress', e);
        useReviewStore.getState().setNarrativeProgressChars(data.chars);
        setLastEventAt(Date.now());
      } catch {
        // ignore
      }
    };

    const onNarrativeError = (e: MessageEvent) => {
      try {
        const data = parseSse('narrative-error', e);
        // Only a successful `narrative` event clears `regenerating`; without this the spinner would spin
        // forever after a failed regeneration. Surface the reason in the activity feed too.
        useReviewStore.getState().setRegenerating(false);
        addLiveEvent(makeEvent('system', `Narrative generation failed: ${data.message}`));
        setLastEventAt(Date.now());
      } catch {
        // ignore
      }
    };

    const onNarrative = (e: MessageEvent) => {
      try {
        const data = parseSse('narrative', e);
        const state = useReviewStore.getState();
        // The narrative that just landed brings its own boundary, committed with it rather than after it:
        // the streaming path already mounted placeholder chapters under these same keys, so a paint with
        // the finished chapters but no decisions would show the divider above four expanded chapters.
        // This is also the only place a first review's collapse can arrive — the bootstrap GET answered
        // before generation finished.
        state.setData(
          data.pr,
          data.narrative,
          data.files,
          data.comments,
          state.repoUrl,
          state.checkRuns,
          state.reviews,
          { collapse: data.collapse ?? null, callers: data.callers ?? [], capStats: data.capStats ?? null },
        );
        useReviewStore.getState().setRegenerating(false);
        useReviewStore.getState().setNarrativeProgressChars(0);
        setLastEventAt(Date.now());
        addLiveEvent(makeEvent('system', `Narrative updated (${data.narrative.chapters.length} chapters)`));
      } catch {
        // ignore
      }
    };

    const onPlanReady = (e: MessageEvent) => {
      try {
        const data = parseSse('plan-ready', e);
        useReviewStore.getState().applyPlan(data.plan);
        setLastEventAt(Date.now());
        addLiveEvent(makeEvent('system', `Plan ready (${data.plan.themes.length} themes) — chapters streaming in...`));
      } catch {
        // ignore
      }
    };

    const onChapterReady = (e: MessageEvent) => {
      try {
        const data = parseSse('chapter-ready', e);
        useReviewStore.getState().applyChapter(data.index, data.chapter, data.themeId);
        setLastEventAt(Date.now());
      } catch {
        // ignore
      }
    };

    const onRecap = (e: MessageEvent) => {
      try {
        const data = parseSse('recap', e);
        useReviewStore.getState().setRecap(data.recap);
        setLastEventAt(Date.now());
        addLiveEvent(makeEvent('system', 'Recap ready'));
      } catch {
        // ignore
      }
    };

    const onRecapGenerating = () => {
      useReviewStore.getState().setRecapStatus('generating');
      setLastEventAt(Date.now());
    };

    const onRecapError = (e: MessageEvent) => {
      try {
        const data = parseSse('recap-error', e);
        useReviewStore.getState().setRecapError(data.error);
      } catch {
        // ignore
      }
    };

    es.addEventListener('connected', onConnected);
    es.addEventListener('comment', onComment as EventListener);
    es.addEventListener('unit-comment', handleUnitCommentEvent as EventListener);
    es.addEventListener('comments', onComments as EventListener);
    es.addEventListener('checks', onChecks as EventListener);
    es.addEventListener('reviews', onReviews as EventListener);
    es.addEventListener('config', onConfig as EventListener);
    es.addEventListener('pr', onPr as EventListener);
    es.addEventListener('units', onUnits as EventListener);
    es.addEventListener('regenerating', onRegenerating as EventListener);
    es.addEventListener('narrative-progress', onNarrativeProgress as EventListener);
    es.addEventListener('narrative-error', onNarrativeError as EventListener);
    es.addEventListener('narrative.partial', handleNarrativePartialEvent as EventListener);
    es.addEventListener('narrative', onNarrative as EventListener);
    es.addEventListener('collapse', handleCollapseEvent as EventListener);
    es.addEventListener('plan-ready', onPlanReady as EventListener);
    es.addEventListener('chapter-ready', onChapterReady as EventListener);
    es.addEventListener('recap', onRecap as EventListener);
    es.addEventListener('recap-generating', onRecapGenerating as EventListener);
    es.addEventListener('recap-error', onRecapError as EventListener);

    es.onopen = () => {
      setLiveStatus('connected');
    };

    es.onerror = () => {
      setLiveStatus('disconnected');
    };

    return () => {
      es.removeEventListener('connected', onConnected);
      es.removeEventListener('comment', onComment as EventListener);
      es.removeEventListener('unit-comment', handleUnitCommentEvent as EventListener);
      es.removeEventListener('comments', onComments as EventListener);
      es.removeEventListener('checks', onChecks as EventListener);
      es.removeEventListener('reviews', onReviews as EventListener);
      es.removeEventListener('config', onConfig as EventListener);
      es.removeEventListener('pr', onPr as EventListener);
      es.removeEventListener('units', onUnits as EventListener);
      es.removeEventListener('regenerating', onRegenerating as EventListener);
      es.removeEventListener('narrative-progress', onNarrativeProgress as EventListener);
      es.removeEventListener('narrative-error', onNarrativeError as EventListener);
      es.removeEventListener('narrative.partial', handleNarrativePartialEvent as EventListener);
      es.removeEventListener('narrative', onNarrative as EventListener);
      es.removeEventListener('collapse', handleCollapseEvent as EventListener);
      es.removeEventListener('plan-ready', onPlanReady as EventListener);
      es.removeEventListener('chapter-ready', onChapterReady as EventListener);
      es.removeEventListener('recap', onRecap as EventListener);
      es.removeEventListener('recap-generating', onRecapGenerating as EventListener);
      es.removeEventListener('recap-error', onRecapError as EventListener);
      es.close();
    };
  }, []);
}
