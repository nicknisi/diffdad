import { useMemo } from 'react';
import { buildWalkthrough, type WalkthroughModel } from '../lib/walkthrough';
import { useReviewStore } from '../state/review-store';

/**
 * The derived walkthrough model, memoized on (narrative, files). The single derivation every
 * progress surface — Overview, BeatRail, StoryView's per-chapter resolve strips — reads, so no
 * two surfaces can disagree about beats, finding ids, or counts.
 */
export function useWalkthrough(): WalkthroughModel | null {
  const narrative = useReviewStore((s) => s.narrative);
  const files = useReviewStore((s) => s.files);
  return useMemo(() => (narrative ? buildWalkthrough(narrative, files) : null), [narrative, files]);
}
