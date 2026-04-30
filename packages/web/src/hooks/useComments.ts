import { useReviewStore } from "../state/review-store";
import type { PRComment } from "../state/types";

type PostCommentOpts = {
  path?: string;
  line?: number;
  side?: string;
  inReplyToId?: number;
};

export function useComments() {
  const addComment = useReviewStore((s) => s.addComment);

  async function postComment(
    body: string,
    opts: PostCommentOpts = {}
  ): Promise<PRComment> {
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
    return comment;
  }

  return { postComment };
}
