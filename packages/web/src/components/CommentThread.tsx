import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useComments } from '../hooks/useComments';
import { copy } from '../lib/microcopy';
import { useReviewStore } from '../state/review-store';
import type { PRComment } from '../state/types';
import { Comment } from './Comment';

type Props = {
  comments: PRComment[];
  path?: string;
  line?: number;
  chapterIndex?: number;
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

function draftKeyFor(path?: string, line?: number, chapterIndex?: number): string | null {
  if (path && line != null) return `${path}:${line}`;
  if (chapterIndex != null) return `chapter:${chapterIndex}`;
  return null;
}

export function CommentThread({ comments, path, line, chapterIndex, inReplyToId, onClose, autoFocus }: Props) {
  const { postComment } = useComments();
  const drafts = useReviewStore((s) => s.drafts);
  const addDraft = useReviewStore((s) => s.addDraft);
  const removeDraft = useReviewStore((s) => s.removeDraft);

  const draftKey = useMemo(() => draftKeyFor(path, line, chapterIndex), [path, line, chapterIndex]);

  const existingDraft = useMemo(() => {
    if (!draftKey) return undefined;
    return drafts.find((d) => draftKeyFor(d.path, d.line, d.chapterIndex) === draftKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]); // intentionally not depending on drafts to only pre-fill once

  const [body, setBody] = useState(existingDraft?.body ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null);

  // If the draft for this thread is removed externally (e.g. SubmitBar clears all drafts),
  // clear the local body so the conflict banner can't fire when the SSE echo arrives.
  useEffect(() => {
    if (!draftKey) return;
    const hasDraft = drafts.some((d) => draftKeyFor(d.path, d.line, d.chapterIndex) === draftKey);
    if (!hasDraft && !submitting) {
      setBody('');
    }
  }, [drafts, draftKey, submitting]);

  const threads = useMemo(() => groupThreads(comments), [comments]);

  // Track baseline comment count when typing started, for conflict detection.
  const baselineRef = useRef<number>(comments.length);
  const [_baseline, setBaseline] = useState<number>(comments.length);
  const [baselineIds, setBaselineIds] = useState<Set<number>>(() => new Set(comments.map((c) => c.id)));
  const typingStartedRef = useRef<boolean>(false);

  // When body becomes non-empty for the first time, snapshot the baseline.
  useEffect(() => {
    if (body.trim().length > 0 && !typingStartedRef.current) {
      typingStartedRef.current = true;
      baselineRef.current = comments.length;
      setBaseline(comments.length);
      setBaselineIds(new Set(comments.map((c) => c.id)));
    }
    if (body.trim().length === 0 && typingStartedRef.current) {
      typingStartedRef.current = false;
      baselineRef.current = comments.length;
      setBaseline(comments.length);
      setBaselineIds(new Set(comments.map((c) => c.id)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

  const newSinceBaseline = comments.filter((c) => !baselineIds.has(c.id));
  const hasConflict = body.trim().length > 0 && newSinceBaseline.length > 0;

  // Default the reply target to the first root if not explicitly set.
  const replyTarget = inReplyToId ?? (threads.length > 0 ? threads[0]?.root.id : undefined);

  function dismissConflict() {
    baselineRef.current = comments.length;
    setBaseline(comments.length);
    setBaselineIds(new Set(comments.map((c) => c.id)));
  }

  function saveDraft() {
    const trimmed = body.trim();
    if (!trimmed || !draftKey) return;
    // Replace any existing draft for this key.
    if (existingDraft) {
      removeDraft(existingDraft.id);
    }
    // Also clear any other draft pointing at the same logical key (in case
    // existingDraft memo is stale because we only resolve it on mount).
    for (const d of drafts) {
      if (draftKeyFor(d.path, d.line, d.chapterIndex) === draftKey) {
        removeDraft(d.id);
      }
    }
    addDraft({
      id: `draft-${draftKey}-${Date.now()}`,
      body: trimmed,
      path,
      line,
      chapterIndex,
    });
    setDraftSavedAt(Date.now());
  }

  function clearDraftForKey() {
    if (!draftKey) return;
    for (const d of drafts) {
      if (draftKeyFor(d.path, d.line, d.chapterIndex) === draftKey) {
        removeDraft(d.id);
      }
    }
  }

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    // Clear body before the await so the SSE echo of our own comment arrives
    // while body is empty — preventing the "new comment arrived" conflict banner.
    setBody('');
    clearDraftForKey();
    try {
      await postComment(trimmed, { path, line, inReplyToId: replyTarget });
      onClose?.();
    } catch (err) {
      setBody(trimmed); // restore on error so the user doesn't lose their text
      setError(err instanceof Error ? err.message : 'Failed to post');
    } finally {
      setSubmitting(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
  }

  const containerClass = hasConflict ? 'space-y-2 rounded-lg border-2 border-amber-400 p-1' : 'space-y-2';

  return (
    <div className={containerClass}>
      {threads.map((t) => {
        const rootIsNew = !baselineIds.has(t.root.id) && hasConflict;
        const newReplyIds = new Set(t.replies.filter((r) => !baselineIds.has(r.id)).map((r) => r.id));
        const highlight = rootIsNew || newReplyIds.size > 0;
        return (
          <div key={t.root.id} className={highlight ? 'border-l-2 border-amber-400 pl-2 transition-colors' : ''}>
            <Comment comment={t.root} replies={t.replies} />
          </div>
        );
      })}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-2">
        {hasConflict && (
          <div className="mb-2 flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
            <span>
              <strong>
                {newSinceBaseline.length} new {newSinceBaseline.length === 1 ? 'comment' : 'comments'}
              </strong>{' '}
              arrived while you were typing.
            </span>
            <button
              type="button"
              onClick={dismissConflict}
              className="rounded-md border border-amber-400 bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-200 dark:border-amber-600 dark:bg-amber-800/40 dark:text-amber-100 dark:hover:bg-amber-800/60"
            >
              Got it
            </button>
          </div>
        )}
        <textarea
          autoFocus={autoFocus}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={copy.commentPlaceholder}
          className="block w-full resize-y rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--fg-1)] outline-none focus:border-[var(--brand)]"
          rows={3}
        />
        {error && <div className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</div>}
        {draftSavedAt && !error && <div className="mt-1 text-xs text-[var(--fg-3)]">Added to review.</div>}
        <div className="mt-2 flex items-center justify-end gap-2">
          {onClose && (
            <button
              type="button"
              onClick={() => {
                setBody('');
                onClose();
              }}
              className="rounded-md border border-[var(--border)] bg-transparent px-3 py-1 text-sm font-medium text-[var(--fg-1)] hover:bg-[var(--bg-subtle)]"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            disabled={!body.trim() || !draftKey}
            onClick={saveDraft}
            className="rounded-md border border-[var(--border-strong)] bg-[var(--bg-panel)] px-3 py-1 text-sm font-medium text-[var(--fg-1)] shadow-sm hover:bg-[var(--bg-subtle)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Add to review
          </button>
          <button
            type="button"
            disabled={!body.trim() || submitting}
            onClick={() => void submit()}
            className="rounded-md bg-[var(--brand)] px-3 py-1 text-sm font-semibold text-white shadow-sm hover:bg-[var(--brand-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Posting...' : 'Comment'}
          </button>
        </div>
      </div>
    </div>
  );
}
