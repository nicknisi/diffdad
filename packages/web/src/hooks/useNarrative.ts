import { useEffect, useState } from "react";
import { useReviewStore } from "../state/review-store";
import type {
  DiffFile,
  NarrativeResponse,
  PRComment,
  PRData,
} from "../state/types";

type NarrativeApiResponse = {
  pr: PRData;
  narrative: NarrativeResponse;
  files: DiffFile[];
  comments: PRComment[];
  repoUrl?: string;
};

export function useNarrative() {
  const setData = useReviewStore((s) => s.setData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/narrative");
        if (!res.ok) {
          throw new Error(`Request failed: ${res.status}`);
        }
        const data = (await res.json()) as NarrativeApiResponse;
        if (cancelled) return;
        setData(data.pr, data.narrative, data.files, data.comments, data.repoUrl ?? null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [setData]);

  return { loading, error };
}
