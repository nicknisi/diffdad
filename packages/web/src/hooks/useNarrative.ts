import { useEffect, useState } from 'react';
import { useReviewStore } from '../state/review-store';
import type { CheckRun, DiffFile, NarrativeResponse, PRComment, PRData, PRReview, Unit } from '../state/types';

type NarrativeApiResponse = {
  generating?: boolean;
  pr: PRData;
  narrative?: NarrativeResponse;
  files: DiffFile[];
  comments: PRComment[];
  checkRuns?: CheckRun[];
  reviews?: PRReview[];
  repoUrl?: string;
  mode?: 'pr' | 'command-center';
  aiPath?: 'api' | 'local-cli';
  /** Command-center bootstrap: the daemon seeds the initial queue so the dashboard paints at once. */
  units?: Unit[];
};

export function useNarrative() {
  const setData = useReviewStore((s) => s.setData);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch('/api/narrative');
        if (!res.ok) {
          throw new Error(`Request failed: ${res.status}`);
        }
        const data = (await res.json()) as NarrativeApiResponse;
        if (cancelled) return;

        if (data.mode === 'command-center') {
          // The daemon declares itself here (no single PR/narrative). Seed the queue; the `units`
          // SSE event keeps it live. Return before the PR/watch branches touch `data.pr` (absent).
          setGenerating(false);
          useReviewStore.getState().setMode('command-center');
          useReviewStore.getState().setUnits(data.units ?? []);
          return;
        }

        if (data.generating && !data.narrative) {
          setGenerating(true);
          useReviewStore.setState({
            pr: data.pr,
            files: data.files,
            comments: data.comments,
            checkRuns: data.checkRuns ?? [],
            reviews: data.reviews ?? [],
            repoUrl: data.repoUrl ?? null,
            aiPath: data.aiPath ?? null,
          });
          // Display prefs come from `GET /api/config` (bootstrapped in App via `applyConfigResponse`),
          // not the narrative payload — the config block was removed from `/api/narrative` in Phase 2.
        } else if (data.narrative) {
          setGenerating(false);
          setData(
            data.pr,
            data.narrative,
            data.files,
            data.comments,
            data.repoUrl ?? null,
            data.checkRuns ?? [],
            data.reviews ?? [],
          );
          useReviewStore.getState().setAiPath(data.aiPath ?? null);
        }

        useReviewStore.getState().setMode(data.mode ?? 'pr');
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [setData]);

  return { loading, generating, setGenerating, error };
}
