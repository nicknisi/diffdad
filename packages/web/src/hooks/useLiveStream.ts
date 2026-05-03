import { useEffect } from 'react';
import { applyNarrativeResponse, fetchNarrative } from './useNarrative';
import { useReviewStore } from '../state/review-store';
import type {
  CheckRun,
  DiffFile,
  LiveEvent,
  LiveEventKind,
  NarrativeResponse,
  PRComment,
  PRData,
  PRReview,
  WatchCommitSummary,
} from '../state/types';

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
        const comment = JSON.parse(e.data) as PRComment;
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
        const comments = JSON.parse(e.data) as PRComment[];
        useReviewStore.getState().setComments(comments);
        setLastEventAt(Date.now());
      } catch {
        // ignore
      }
    };

    const onChecks = (e: MessageEvent) => {
      try {
        const checks = JSON.parse(e.data) as CheckRun[];
        setCheckRuns(checks);
        setLastEventAt(Date.now());
        addLiveEvent(makeEvent('ci', `CI status updated (${checks.length} checks)`, checks));
      } catch {
        // ignore
      }
    };

    const onReviews = (e: MessageEvent) => {
      try {
        const reviews = JSON.parse(e.data) as PRReview[];
        useReviewStore.getState().setReviews(reviews);
        setLastEventAt(Date.now());
      } catch {
        // ignore
      }
    };

    const onPr = (e: MessageEvent) => {
      try {
        const pr = JSON.parse(e.data) as PRData;
        useReviewStore.getState().setPr(pr);
        setLastEventAt(Date.now());
      } catch {
        // ignore
      }
    };

    const onRegenerating = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { previousSha: string; newSha: string };
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
        const data = JSON.parse(e.data) as { chars: number };
        useReviewStore.getState().setNarrativeProgressChars(data.chars);
        setLastEventAt(Date.now());
      } catch {
        // ignore
      }
    };

    const onNarrative = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as {
          narrative: NarrativeResponse;
          pr: PRData;
          files: DiffFile[];
          comments: PRComment[];
        };
        const state = useReviewStore.getState();
        state.setData(
          data.pr,
          data.narrative,
          data.files,
          data.comments,
          state.repoUrl,
          state.checkRuns,
          null,
          state.reviews,
        );
        useReviewStore.getState().setRegenerating(false);
        useReviewStore.getState().setNarrativeProgressChars(0);
        setLastEventAt(Date.now());
        addLiveEvent(makeEvent('system', `Narrative updated (${data.narrative.chapters.length} chapters)`));
      } catch {
        // ignore
      }
    };

    const onWatchUpdate = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as {
          branch: string;
          base: string;
          baseSha: string;
          headSha: string;
          commits: WatchCommitSummary[];
          unifiedReady: boolean;
        };
        const store = useReviewStore.getState();
        if (store.watch) {
          store.setWatch({ ...store.watch, ...data });
        }
        setLastEventAt(Date.now());
        addLiveEvent(makeEvent('commit', `${data.commits.length} commits ahead of ${data.base}`));
      } catch {
        // ignore
      }
    };

    const onCommitNarrating = (e: MessageEvent) => {
      try {
        const { sha } = JSON.parse(e.data) as { sha: string };
        addLiveEvent(makeEvent('system', `Narrating ${sha.slice(0, 7)}…`));
      } catch {
        // ignore
      }
    };

    const onCommitNarrative = async (e: MessageEvent) => {
      try {
        const { sha } = JSON.parse(e.data) as { sha: string };
        const store = useReviewStore.getState();
        if (store.watch) {
          const updated = store.watch.commits.map((c) =>
            c.sha === sha ? { ...c, hasNarrative: true } : c,
          );
          store.setWatch({ ...store.watch, commits: updated });
        }
        // If the user is currently looking at this commit, refresh the narrative.
        if (store.watch?.selection.kind === 'commit' && store.watch.selection.sha === sha) {
          const data = await fetchNarrative(`?sha=${encodeURIComponent(sha)}`);
          applyNarrativeResponse(data);
        }
        setLastEventAt(Date.now());
        addLiveEvent(makeEvent('system', `Narrative ready for ${sha.slice(0, 7)}`));
      } catch {
        // ignore
      }
    };

    const onUnifiedNarrative = async () => {
      try {
        const store = useReviewStore.getState();
        if (store.watch) store.setWatch({ ...store.watch, unifiedReady: true });
        if (store.watch?.selection.kind === 'unified') {
          const data = await fetchNarrative('?mode=unified');
          applyNarrativeResponse(data);
        }
        addLiveEvent(makeEvent('system', 'Whole-branch narrative ready'));
        setLastEventAt(Date.now());
      } catch {
        // ignore
      }
    };

    const onUnifiedNarrating = () => {
      const store = useReviewStore.getState();
      if (store.watch) store.setWatch({ ...store.watch, unifiedReady: false });
      addLiveEvent(makeEvent('system', 'Generating whole-branch narrative…'));
    };

    es.addEventListener('connected', onConnected);
    es.addEventListener('comment', onComment as EventListener);
    es.addEventListener('comments', onComments as EventListener);
    es.addEventListener('checks', onChecks as EventListener);
    es.addEventListener('reviews', onReviews as EventListener);
    es.addEventListener('pr', onPr as EventListener);
    es.addEventListener('regenerating', onRegenerating as EventListener);
    es.addEventListener('narrative-progress', onNarrativeProgress as EventListener);
    es.addEventListener('narrative', onNarrative as EventListener);
    es.addEventListener('watch-update', onWatchUpdate as EventListener);
    es.addEventListener('commit-narrating', onCommitNarrating as EventListener);
    es.addEventListener('commit-narrative', onCommitNarrative as EventListener);
    es.addEventListener('unified-narrative', onUnifiedNarrative as EventListener);
    es.addEventListener('unified-narrating', onUnifiedNarrating as EventListener);

    es.onopen = () => {
      setLiveStatus('connected');
    };

    es.onerror = () => {
      setLiveStatus('disconnected');
    };

    return () => {
      es.removeEventListener('connected', onConnected);
      es.removeEventListener('comment', onComment as EventListener);
      es.removeEventListener('comments', onComments as EventListener);
      es.removeEventListener('checks', onChecks as EventListener);
      es.removeEventListener('reviews', onReviews as EventListener);
      es.removeEventListener('pr', onPr as EventListener);
      es.removeEventListener('regenerating', onRegenerating as EventListener);
      es.removeEventListener('narrative-progress', onNarrativeProgress as EventListener);
      es.removeEventListener('narrative', onNarrative as EventListener);
      es.removeEventListener('watch-update', onWatchUpdate as EventListener);
      es.removeEventListener('commit-narrating', onCommitNarrating as EventListener);
      es.removeEventListener('commit-narrative', onCommitNarrative as EventListener);
      es.removeEventListener('unified-narrative', onUnifiedNarrative as EventListener);
      es.removeEventListener('unified-narrating', onUnifiedNarrating as EventListener);
      es.close();
    };
  }, []);
}
