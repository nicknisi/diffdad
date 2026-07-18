import { useEffect, useState } from 'react';
import { loadDrafts, loadResolved, reviewDraftKey, useReviewStore } from '../state/review-store';
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

/**
 * Exported for direct unit testing. Seeds the store while the server is still generating the
 * narrative. The review scope (`reviewKey`) must be established HERE, not at the final `narrative`
 * event: the diff-first UI is already interactive during generation, and every persistence path
 * (drafts, resolved findings, reviewed chapters) silently no-ops without a reviewKey — the final
 * setData would then reload the empty persisted state over the reviewer's in-memory work.
 */
export function seedGeneratingReview(
  data: Pick<NarrativeApiResponse, 'pr' | 'files' | 'comments' | 'checkRuns' | 'reviews' | 'repoUrl' | 'aiPath'>,
): void {
  const reviewKey = reviewDraftKey(data.repoUrl ?? null, data.pr.number);
  useReviewStore.setState({
    pr: data.pr,
    files: data.files,
    comments: data.comments,
    checkRuns: data.checkRuns ?? [],
    reviews: data.reviews ?? [],
    repoUrl: data.repoUrl ?? null,
    aiPath: data.aiPath ?? null,
    reviewKey,
    drafts: loadDrafts(reviewKey, data.pr.number),
    resolved: loadResolved(reviewKey),
  });
}

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
          seedGeneratingReview(data);
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
