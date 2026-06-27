import { useMemo } from 'react';
import { agentToPRComments } from '../lib/agent-comments';
import { useReviewStore } from '../state/review-store';
import type { PRComment } from '../state/types';

/**
 * The comments rendered inline in the diff: GitHub comments plus agent comments (watch mode)
 * mapped into the same PRComment shape. Agent comments stay a separate store field
 * (`agentComments`) — this hook merges them only for rendering, so narrative regeneration
 * (which resets `comments`) never clobbers them.
 */
export function useInlineComments(): PRComment[] {
  const comments = useReviewStore((s) => s.comments);
  const agentComments = useReviewStore((s) => s.agentComments);
  return useMemo(() => [...comments, ...agentToPRComments(agentComments)], [comments, agentComments]);
}
