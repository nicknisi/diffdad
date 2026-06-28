import { useCallback } from 'react';
import { commentsEndpoint } from '../lib/units-view';
import { useReviewStore } from '../state/review-store';
import type { CommentId, PRComment } from '../state/types';

/** The comments endpoint for the current surface (PR `/api/comments`, or a unit's PR in the daemon). */
function endpoint(): string {
  const { mode, route } = useReviewStore.getState();
  return commentsEndpoint(mode, route);
}

type PostCommentOpts = {
  path?: string;
  line?: number;
  side?: string;
  startLine?: number;
  startSide?: string;
  inReplyToId?: CommentId;
};

export function useComments() {
  const addComment = useReviewStore((s) => s.addComment);
  const setComments = useReviewStore((s) => s.setComments);

  const refreshComments = useCallback(async () => {
    try {
      const res = await fetch(endpoint());
      if (!res.ok) return;
      const comments = (await res.json()) as PRComment[];
      setComments(comments);
    } catch {
      // ignore fetch errors
    }
  }, [setComments]);

  const postComment = useCallback(
    async (body: string, opts: PostCommentOpts = {}): Promise<PRComment> => {
      const res = await fetch(endpoint(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, ...opts }),
      });
      if (!res.ok) {
        throw new Error(`Failed to post comment: ${res.status}`);
      }
      const comment = (await res.json()) as PRComment;
      addComment(comment);
      return comment;
    },
    [addComment],
  );

  return { postComment, refreshComments };
}
