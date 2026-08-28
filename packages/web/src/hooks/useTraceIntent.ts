import { useEffect, useState } from 'react';
import type { TraceSessionSummary } from '@diffdad/contracts';

/**
 * Fetch local authoring-session intent once on mount, mirroring {@link useRecapLazy}'s fetch-once
 * pattern. Best-effort and invisible on empty: any error or empty response yields `[]`, so the
 * consuming section renders nothing rather than empty-state chrome.
 */
export function useTraceIntent(): { sessions: TraceSessionSummary[] } {
  const [sessions, setSessions] = useState<TraceSessionSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/trace/intent');
        if (!res.ok) return;
        const data = (await res.json()) as { sessions?: TraceSessionSummary[] };
        if (!cancelled && Array.isArray(data.sessions)) setSessions(data.sessions);
      } catch {
        // best-effort: leave sessions empty so the feature stays invisible
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { sessions };
}
