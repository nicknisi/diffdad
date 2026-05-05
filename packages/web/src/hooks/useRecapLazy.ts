import { useEffect, useState } from 'react';
import { useReviewStore } from '../state/review-store';
import type { RecapResponse } from '../state/recap-types';

type RecapApiResponse =
  | { status: 'idle' }
  | { status: 'generating' }
  | { status: 'ready'; recap: RecapResponse }
  | { status: 'error'; error: string };

/**
 * Lazy-fetch the recap on first mount. Idempotent: if a recap is already
 * loaded, this does nothing. The first POST kicks off generation server-side
 * if it hasn't started; subsequent GETs poll until ready or errored.
 */
export function useRecapLazy(): { retry: () => void } {
  const recap = useReviewStore((s) => s.recap);
  const setRecap = useReviewStore((s) => s.setRecap);
  const setRecapStatus = useReviewStore((s) => s.setRecapStatus);
  const setRecapError = useReviewStore((s) => s.setRecapError);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (recap) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function handle(data: RecapApiResponse): boolean {
      if (cancelled) return true;
      if (data.status === 'ready') {
        setRecap(data.recap);
        return true;
      }
      if (data.status === 'error') {
        setRecapError(data.error);
        return true;
      }
      setRecapStatus('generating');
      return false;
    }

    async function poll() {
      try {
        const res = await fetch('/api/recap');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as RecapApiResponse;
        if (handle(data)) return;
        timer = setTimeout(poll, 2000);
      } catch (err) {
        if (cancelled) return;
        setRecapError(err instanceof Error ? err.message : 'Recap request failed');
      }
    }

    async function start() {
      try {
        const res = await fetch('/api/recap', { method: 'POST' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as RecapApiResponse;
        if (handle(data)) return;
        timer = setTimeout(poll, 2000);
      } catch (err) {
        if (cancelled) return;
        setRecapError(err instanceof Error ? err.message : 'Recap request failed');
      }
    }

    void start();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [retryNonce, recap, setRecap, setRecapError, setRecapStatus]);

  function retry() {
    setRecapError(null);
    setRecap(null);
    setRetryNonce((n) => n + 1);
  }

  return { retry };
}
