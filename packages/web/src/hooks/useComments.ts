import { useCallback, useEffect } from "react";
import { useReviewStore } from "../state/review-store";
import type { PRComment } from "../state/types";

type PostCommentOpts = {
  path?: string;
  line?: number;
  side?: string;
  inReplyToId?: number;
};

const POLL_INTERVAL_MS = 30_000;

export function useComments() {
  const addComment = useReviewStore((s) => s.addComment);
  const setComments = useReviewStore((s) => s.setComments);

  const refreshComments = useCallback(async () => {
    try {
      const res = await fetch("/api/comments");
      if (!res.ok) return;
      const comments = (await res.json()) as PRComment[];
      setComments(comments);
    } catch {
      // ignore polling errors
    }
  }, [setComments]);

  const postComment = useCallback(
    async (body: string, opts: PostCommentOpts = {}): Promise<PRComment> => {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, ...opts }),
      });
      if (!res.ok) {
        throw new Error(`Failed to post comment: ${res.status}`);
      }
      const comment = (await res.json()) as PRComment;
      addComment(comment);
      void refreshComments();
      return comment;
    },
    [addComment, refreshComments]
  );

  return { postComment, refreshComments };
}

export function useCommentPolling() {
  const { refreshComments } = useComments();

  useEffect(() => {
    const id = setInterval(() => {
      void refreshComments();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refreshComments]);
}
