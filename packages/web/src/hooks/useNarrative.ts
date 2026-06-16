import { useEffect, useState } from 'react';
import { useReviewStore, type BackendConfig } from '../state/review-store';
import type { CheckRun, DiffFile, NarrativeResponse, PRComment, PRData, PRReview } from '../state/types';

type NarrativeApiResponse = {
  generating?: boolean;
  pr: PRData;
  narrative?: NarrativeResponse;
  files: DiffFile[];
  comments: PRComment[];
  checkRuns?: CheckRun[];
  reviews?: PRReview[];
  repoUrl?: string;
  mode?: 'pr' | 'watch';
  aiPath?: 'api' | 'local-cli';
  config?: BackendConfig;
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
          if (data.config) {
            const next: Partial<typeof useReviewStore extends { getState: () => infer S } ? S : never> = {};
            if (data.config.theme && !localStorage.getItem('diffdad.theme'))
              next.theme = data.config.theme as 'light' | 'dark' | 'auto';
            if (data.config.accent && !localStorage.getItem('diffdad.accent')) next.accent = data.config.accent as any;
            if (data.config.storyStructure) next.storyStructure = data.config.storyStructure as any;
            if (data.config.layoutMode) next.layoutMode = data.config.layoutMode as any;
            if (data.config.displayDensity) next.displayDensity = data.config.displayDensity as any;
            useReviewStore.setState(next);
          }
        } else if (data.narrative) {
          setGenerating(false);
          setData(
            data.pr,
            data.narrative,
            data.files,
            data.comments,
            data.repoUrl ?? null,
            data.checkRuns ?? [],
            data.config ?? null,
            data.reviews ?? [],
          );
          useReviewStore.getState().setAiPath(data.aiPath ?? null);
        }

        // Watch mode: load existing agent comments (live updates arrive via the
        // `agent-comment` SSE event in useLiveStream).
        useReviewStore.getState().setMode(data.mode ?? 'pr');
        if (data.mode === 'watch') {
          try {
            const acRes = await fetch('/api/agent-comments');
            if (acRes.ok && !cancelled) {
              const ac = await acRes.json();
              if (Array.isArray(ac)) useReviewStore.getState().setAgentComments(ac);
            }
          } catch {
            // ignore — SSE will backfill
          }
        }
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
