import { useCallback } from 'react';
import { agentToPRComments } from '../lib/agent-comments';
import { useReviewStore } from '../state/review-store';
import type { AgentComment, CommentId, PRComment } from '../state/types';

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
      const res = await fetch('/api/comments');
      if (!res.ok) return;
      const comments = (await res.json()) as PRComment[];
      setComments(comments);
    } catch {
      // ignore fetch errors
    }
  }, [setComments]);

  const postComment = useCallback(
    async (body: string, opts: PostCommentOpts = {}): Promise<PRComment> => {
      // Watch mode: comments go to the agent, not GitHub. The inline composer always
      // carries a path+line, which is exactly what an agent comment needs.
      if (useReviewStore.getState().mode === 'watch') {
        const res = await fetch('/api/agent-comments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: opts.path, line: opts.line, side: opts.side ?? 'RIGHT', body }),
        });
        if (!res.ok) throw new Error(`Failed to post comment: ${res.status}`);
        const created = (await res.json()) as AgentComment;
        const current = useReviewStore.getState().agentComments;
        if (!current.find((c) => c.id === created.id)) {
          useReviewStore.getState().setAgentComments([...current, created]);
        }
        return agentToPRComments([created])[0]!;
      }

      const res = await fetch('/api/comments', {
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
