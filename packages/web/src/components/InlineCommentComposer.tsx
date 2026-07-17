import { useMemo, useState, type KeyboardEvent } from 'react';
import { useComments } from '../hooks/useComments';
import { copy } from '../lib/microcopy';
import { commentTarget } from '../lib/units-view';
import { draftAnchorKey, useReviewStore } from '../state/review-store';
import type { DraftComment } from '../state/types';

type Props = {
  path: string;
  line: number;
  side?: 'LEFT' | 'RIGHT';
  startLine?: number;
  startSide?: 'LEFT' | 'RIGHT';
  chapterIndex?: number;
  initialBody?: string;
  autoFocus?: boolean;
  onCancel?: () => void;
  onHandled?: () => void;
};

export function InlineCommentComposer({
  path,
  line,
  side = 'RIGHT',
  startLine,
  startSide,
  chapterIndex,
  initialBody = '',
  autoFocus,
  onCancel,
  onHandled,
}: Props) {
  const { postComment } = useComments();
  const drafts = useReviewStore((s) => s.drafts);
  const upsertDraft = useReviewStore((s) => s.upsertDraft);
  const removeDraftsAt = useReviewStore((s) => s.removeDraftsAt);
  const target = useReviewStore((s) => commentTarget(s.mode, s.route, s.units));

  const anchor: Pick<DraftComment, 'path' | 'line' | 'chapterIndex'> = { path, line, chapterIndex };
  const anchorKey = draftAnchorKey(anchor);
  const existingDraft = useMemo(() => drafts.find((draft) => draftAnchorKey(draft) === anchorKey), [anchorKey, drafts]);

  const [body, setBody] = useState(existingDraft?.body ?? initialBody);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function saveDraft() {
    const trimmed = body.trim();
    if (!trimmed || !anchorKey) return;
    upsertDraft({
      id: `draft-${anchorKey}-${Date.now()}`,
      body: trimmed,
      path,
      line,
      side,
      startLine,
      startSide,
      chapterIndex,
    });
    setSaved(true);
    onHandled?.();
  }

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await postComment(trimmed, { path, line, side, startLine, startSide });
      removeDraftsAt(anchor);
      setBody('');
      onHandled?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post');
    } finally {
      setSubmitting(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void submit();
    }
    if (event.key === 'Escape' && onCancel) {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-2">
      <textarea
        autoFocus={autoFocus}
        value={body}
        onChange={(event) => {
          setBody(event.target.value);
          setSaved(false);
        }}
        onKeyDown={onKeyDown}
        placeholder={copy.commentPlaceholder}
        className="block w-full resize-y rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--fg-1)] outline-none focus:border-[var(--brand)]"
        rows={3}
      />
      {error && <div className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</div>}
      {saved && !error && <div className="mt-1 text-xs text-[var(--fg-3)]">Added to review.</div>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="mr-auto text-[11px] text-[var(--fg-3)]">
          Inline at{' '}
          <span className="font-mono">
            {path}:{line}
          </span>
        </span>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-[var(--border)] bg-transparent px-3 py-1 text-sm font-medium text-[var(--fg-1)] hover:bg-[var(--bg-subtle)]"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          disabled={!body.trim() || !anchorKey}
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
          {submitting ? 'Posting…' : target === 'github' ? 'Comment on PR' : 'Comment'}
        </button>
      </div>
    </div>
  );
}
