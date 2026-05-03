import { useEffect, useState } from 'react';
import { useReviewStore, type BackendConfig } from '../state/review-store';
import type {
  AppMode,
  CheckRun,
  DiffFile,
  NarrativeResponse,
  PRComment,
  PRData,
  PRReview,
  WatchData,
} from '../state/types';

type NarrativeApiResponse = {
  mode?: AppMode;
  generating?: boolean;
  pr: PRData;
  narrative?: NarrativeResponse;
  files: DiffFile[];
  comments: PRComment[];
  checkRuns?: CheckRun[];
  reviews?: PRReview[];
  repoUrl?: string;
  config?: BackendConfig;
  watch?: WatchData;
};

export async function fetchNarrative(query: string = ''): Promise<NarrativeApiResponse> {
  const res = await fetch(`/api/narrative${query}`);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return (await res.json()) as NarrativeApiResponse;
}

export function applyNarrativeResponse(data: NarrativeApiResponse) {
  const store = useReviewStore.getState();
  const mode: AppMode = data.mode === 'watch' ? 'watch' : 'pr';
  store.setMode(mode);
  if (data.watch) store.setWatch(data.watch);
  else if (mode === 'pr') store.setWatch(null);

  if (data.generating && !data.narrative) {
    useReviewStore.setState({
      pr: data.pr,
      files: data.files,
      comments: data.comments,
      checkRuns: data.checkRuns ?? [],
      reviews: data.reviews ?? [],
      repoUrl: data.repoUrl ?? null,
    });
    if (data.config) {
      const next: Partial<ReturnType<typeof useReviewStore.getState>> = {};
      if (data.config.theme && !localStorage.getItem('diffdad.theme'))
        next.theme = data.config.theme as 'light' | 'dark' | 'auto';
      if (data.config.accent && !localStorage.getItem('diffdad.accent')) next.accent = data.config.accent as any;
      if (data.config.storyStructure) next.storyStructure = data.config.storyStructure as any;
      if (data.config.layoutMode) next.layoutMode = data.config.layoutMode as any;
      if (data.config.displayDensity) next.displayDensity = data.config.displayDensity as any;
      useReviewStore.setState(next);
    }
    return { generating: true };
  }

  if (data.narrative) {
    store.setData(
      data.pr,
      data.narrative,
      data.files,
      data.comments,
      data.repoUrl ?? null,
      data.checkRuns ?? [],
      data.config ?? null,
      data.reviews ?? [],
    );
    return { generating: false };
  }
  return { generating: false };
}

export function useNarrative() {
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchNarrative();
        if (cancelled) return;
        const result = applyNarrativeResponse(data);
        setGenerating(result.generating);
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
  }, []);

  return { loading, generating, setGenerating, error };
}
