import { useMemo, useState, type KeyboardEvent } from "react";
import { useComments } from "../hooks/useComments";
import type { PRComment } from "../state/types";
import { Comment } from "./Comment";

type Props = {
  comments: PRComment[];
  path?: string;
  line?: number;
  inReplyToId?: number;
  onClose?: () => void;
  autoFocus?: boolean;
};

type Thread = {
  root: PRComment;
  replies: PRComment[];
};

function groupThreads(comments: PRComment[]): Thread[] {
  const roots: PRComment[] = [];
  const repliesByParent = new Map<number, PRComment[]>();

  for (const c of comments) {
    if (c.inReplyToId == null) {
      roots.push(c);
    } else {
      const arr = repliesByParent.get(c.inReplyToId) ?? [];
      arr.push(c);
      repliesByParent.set(c.inReplyToId, arr);
    }
  }

  // Orphan replies (parent not in list) become roots so they still render.
  for (const [parentId, replies] of repliesByParent) {
    if (!comments.some((c) => c.id === parentId)) {
      roots.push(...replies);
      repliesByParent.delete(parentId);
    }
  }

  const sortByCreated = (a: PRComment, b: PRComment) =>
    new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();

  roots.sort(sortByCreated);
  return roots.map((root) => ({
    root,
    replies: (repliesByParent.get(root.id) ?? []).slice().sort(sortByCreated),
  }));
}

export function CommentThread({
  comments,
  path,
  line,
  inReplyToId,
  onClose,
  autoFocus,
}: Props) {
  const { postComment } = useComments();
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const threads = useMemo(() => groupThreads(comments), [comments]);

  // Default the reply target to the first root if not explicitly set.
  const replyTarget =
    inReplyToId ?? (threads.length > 0 ? threads[0]?.root.id : undefined);

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await postComment(trimmed, { path, line, inReplyToId: replyTarget });
      setBody("");
      onClose?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post");
    } finally {
      setSubmitting(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div className="space-y-2">
      {threads.map((t) => (
        <Comment key={t.root.id} comment={t.root} replies={t.replies} />
      ))}
      <div className="rounded-lg border border-gray-200 bg-white p-2 dark:border-gray-800 dark:bg-gray-900">
        <textarea
          autoFocus={autoFocus}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Leave a comment. Cmd/Ctrl+Enter to submit."
          className="block w-full resize-y rounded-md border border-gray-200 bg-transparent px-3 py-2 text-sm text-gray-900 outline-none focus:border-brand dark:border-gray-800 dark:text-gray-100"
          rows={3}
        />
        {error && (
          <div className="mt-1 text-sm text-red-600 dark:text-red-400">
            {error}
          </div>
        )}
        <div className="mt-2 flex justify-end gap-2">
          {onClose && (
            <button
              type="button"
              onClick={() => {
                setBody("");
                onClose();
              }}
              className="rounded-md px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            disabled={!body.trim() || submitting}
            onClick={() => void submit()}
            className="rounded-md bg-brand px-3 py-1 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Posting..." : "Comment"}
          </button>
        </div>
      </div>
    </div>
  );
}
