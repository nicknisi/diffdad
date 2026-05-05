import { useEffect, useState } from 'react';
import type { CheckRun, PRData, PRReview } from '../state/types';
import type { RecapResponse } from '../state/recap-types';

export type RecapData = {
  recap: RecapResponse | null;
  pr: PRData | null;
  checkRuns: CheckRun[];
  reviews: PRReview[];
  repoUrl: string | null;
  loading: boolean;
  generating: boolean;
  error: string | null;
};

type RecapApiResponse = {
  generating?: boolean;
  recap?: RecapResponse;
  pr: PRData;
  checkRuns?: CheckRun[];
  reviews?: PRReview[];
  repoUrl?: string;
};

export function useRecap(): RecapData {
  const [recap, setRecap] = useState<RecapResponse | null>(null);
  const [pr, setPr] = useState<PRData | null>(null);
  const [checkRuns, setCheckRuns] = useState<CheckRun[]>([]);
  const [reviews, setReviews] = useState<PRReview[]>([]);
  const [repoUrl, setRepoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let done = false;

    async function fetchOnce() {
      const res = await fetch('/api/recap');
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      const data = (await res.json()) as RecapApiResponse;
      if (cancelled) return;
      setPr(data.pr);
      setRepoUrl(data.repoUrl ?? null);
      setCheckRuns(data.checkRuns ?? []);
      setReviews(data.reviews ?? []);
      if (data.generating || !data.recap) {
        setGenerating(true);
      } else {
        setGenerating(false);
        setRecap(data.recap);
        done = true;
      }
    }

    async function loop() {
      try {
        await fetchOnce();
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (!cancelled) setLoading(false);
      }
      if (cancelled || done) return;
      timer = setTimeout(loop, 3000);
    }

    void loop();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  return { recap, pr, checkRuns, reviews, repoUrl, loading, generating, error };
}
