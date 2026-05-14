import { useMemo } from 'react';
import { useReviewStore } from '../state/review-store';
import { aggregateFindings } from '../lib/findings';
export type { Finding, ConcernFinding, CalloutFinding } from '../lib/findings';

export function useAggregatedFindings() {
  const narrative = useReviewStore((s) => s.narrative);
  const files = useReviewStore((s) => s.files);

  return useMemo(() => {
    if (!narrative) return [];
    return aggregateFindings(narrative.concerns ?? [], narrative.chapters ?? [], files);
  }, [narrative, files]);
}
