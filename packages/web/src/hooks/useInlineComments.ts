import { useReviewStore } from '../state/review-store';
import type { PRComment } from '../state/types';

/** The GitHub PR comments rendered inline in the diff for the active surface. */
export function useInlineComments(): PRComment[] {
  return useReviewStore((s) => s.comments);
}
