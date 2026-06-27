import { useCallback } from 'react';
import { agentToPRComments } from '../lib/agent-comments';
import { agentCommentsEndpoint, commentGoesToAgent, commentsEndpoint } from '../lib/units-view';
import { useReviewStore } from '../state/review-store';
import type { AgentComment, CommentId, PRComment } from '../state/types';

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
      // Agent surfaces (watch, or a LOCAL daemon unit) route comments to the agent loop, not GitHub —
      // a local unit has no PR to comment on (that's the 400). The inline composer always carries a
      // path+line, which is exactly what an agent comment needs. Endpoint is mode-aware: the single
      // mailbox in watch, the per-unit mailbox in the daemon drill-in.
      const { mode, route, units } = useReviewStore.getState();
      if (commentGoesToAgent(mode, route, units)) {
        const res = await fetch(agentCommentsEndpoint(mode, route), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: opts.path,
            line: opts.line,
            side: opts.side ?? 'RIGHT',
            startLine: opts.startLine,
            startSide: opts.startSide,
            // Carry the reply target so the server threads under the parent instead of spawning a
            // sibling. A reply returns the updated PARENT comment (new reply appended), not a new one.
            inReplyToId: opts.inReplyToId,
            body,
          }),
        });
        if (!res.ok) throw new Error(`Failed to post comment: ${res.status}`);
        const created = (await res.json()) as AgentComment;
        // Upsert: a new comment appends; a reply replaces its parent (which now carries the reply).
        const current = useReviewStore.getState().agentComments;
        const exists = current.some((c) => c.id === created.id);
        useReviewStore
          .getState()
          .setAgentComments(exists ? current.map((c) => (c.id === created.id ? created : c)) : [...current, created]);
        return agentToPRComments([created])[0]!;
      }

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
