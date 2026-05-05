import { useEffect } from 'react';
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
} from '../state/types';
import type { RecapResponse } from '../state/recap-types';

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

    const onNarrativePartial = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as {
          narrative: NarrativeResponse;
          pr: PRData;
          files: DiffFile[];
          comments: PRComment[];
        };
        useReviewStore.getState().applyPartialNarrative(data.pr, data.narrative, data.files, data.comments);
        setLastEventAt(Date.now());
      } catch {
        // ignore
      }
    };

    const onRecap = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { recap: RecapResponse };
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
        const data = JSON.parse(e.data) as { error: string };
        useReviewStore.getState().setRecapError(data.error);
      } catch {
        // ignore
      }
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
    es.addEventListener('narrative.partial', onNarrativePartial as EventListener);
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
      es.removeEventListener('comments', onComments as EventListener);
      es.removeEventListener('checks', onChecks as EventListener);
      es.removeEventListener('reviews', onReviews as EventListener);
      es.removeEventListener('pr', onPr as EventListener);
      es.removeEventListener('regenerating', onRegenerating as EventListener);
      es.removeEventListener('narrative-progress', onNarrativeProgress as EventListener);
      es.removeEventListener('narrative', onNarrative as EventListener);
      es.removeEventListener('narrative.partial', onNarrativePartial as EventListener);
      es.removeEventListener('recap', onRecap as EventListener);
      es.removeEventListener('recap-generating', onRecapGenerating as EventListener);
      es.removeEventListener('recap-error', onRecapError as EventListener);
      es.close();
    };
  }, []);
}
