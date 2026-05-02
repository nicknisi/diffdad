import { useState } from 'react';
import { copy } from '../lib/microcopy';
import { pendingReviewComments, useReviewStore } from '../state/review-store';
import type { DraftComment, PRComment } from '../state/types';
import { ApprovalCelebration } from './ApprovalCelebration';
import { SubmitDialog } from './SubmitDialog';
import { Toast } from './Toast';

export function SubmitBar() {
  const narrative = useReviewStore((s) => s.narrative);
  const chapterStates = useReviewStore((s) => s.chapterStates);
  const drafts = useReviewStore((s) => s.drafts);
  const clearDrafts = useReviewStore((s) => s.clearDrafts);
  const removeDraft = useReviewStore((s) => s.removeDraft);
  const addComment = useReviewStore((s) => s.addComment);
  const sourceType = useReviewStore((s) => s.sourceType);

  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState(false);

  if (!narrative) return null;

  const total = narrative.chapters.length;
  const reviewedCount = Object.values(chapterStates).filter((s) => s === 'reviewed').length;
  const progress = total === 0 ? 0 : (reviewedCount / total) * 100;

  async function handleSubmit(resolution: string, summary: string) {
    try {
      const comments = pendingReviewComments(drafts);
      if (sourceType === 'commit') {
        // For commits: post each pending inline comment then a summary comment if provided.
        // Call addComment immediately with each response so the SSE echo is deduped away
        // and doesn't trigger the "new comment arrived" conflict banner in open threads.
        // Use Promise.allSettled so a single failure doesn't abort the whole batch.
        // Only remove drafts that were successfully posted; keep failed ones so the user can retry.
        const submittableDrafts = drafts.filter(
          (d): d is DraftComment & { path: string; line: number } => !!d.path && d.line !== undefined,
        );
        const results = await Promise.allSettled(
          submittableDrafts.map(async (d) => {
            const res = await fetch('/api/comments', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: d.path, line: d.line, side: d.side, body: d.body }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            addComment((await res.json()) as PRComment);
            return d.id;
          }),
        );
        for (const r of results) {
          if (r.status === 'fulfilled') removeDraft(r.value);
        }
        const failedCount = results.filter((r) => r.status === 'rejected').length;
        if (failedCount > 0) {
          setToast(copy.errorGeneric);
          return;
        }
        if (summary.trim()) {
          try {
            const res = await fetch('/api/comments', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ body: summary }),
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            addComment((await res.json()) as PRComment);
          } catch {
            // Inline comments already landed — close the dialog and report partial success
            // rather than showing a generic error that implies everything failed.
            setOpen(false);
            setToast(copy.commitSummaryError);
            return;
          }
        }
        setOpen(false);
        setToast(copy.commentToast);
        return;
      }
      const res = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: resolution, body: summary, comments }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setOpen(false);
      clearDrafts();
      if (resolution === 'approve') {
        setCelebrating(true);
      } else {
        const toastMsg = resolution === 'request_changes' ? copy.requestChangesToast : copy.commentToast;
        setToast(toastMsg);
      }
    } catch {
      setToast(copy.errorGeneric);
    }
  }

  return (
    <>
      <div
        className="fixed bottom-4 left-1/2 z-10 -translate-x-1/2 flex items-center gap-3 rounded-[14px] bg-[var(--bg-panel)]"
        style={{
          padding: '8px 8px 8px 14px',
          boxShadow:
            '0 12px 24px -4px rgba(3,2,13,0.18), 0 4px 8px -2px rgba(3,2,13,0.10), inset 0 0 0 1px var(--gray-a6)',
        }}
      >
        <div>
          <div className="text-[12.5px] font-normal text-[var(--fg-2)]">
            {total > 0 && reviewedCount === total && drafts.length === 0 ? (
              <b className="font-bold text-[var(--fg-1)]">{copy.allReviewed}</b>
            ) : (
              <>
                <b className="font-bold text-[var(--fg-1)]">
                  {reviewedCount} of {total}
                </b>{' '}
                chapters reviewed · <b className="font-bold text-[var(--fg-1)]">{drafts.length}</b> pending{' '}
                {drafts.length === 1 ? 'comment' : 'comments'}
              </>
            )}
          </div>
          <div className="mt-1 h-[6px] w-[90px] overflow-hidden rounded-full" style={{ background: 'var(--gray-3)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${progress}%`,
                background: 'var(--green-9)',
              }}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-[30px] items-center gap-1.5 rounded-[6px] bg-[var(--brand)] px-3 text-[12.5px] font-bold text-white hover:bg-[var(--brand-hover)]"
          style={{ boxShadow: '0 1px 2px rgba(3,2,13,0.08)' }}
        >
          Submit review
        </button>
      </div>
      <SubmitDialog open={open} onClose={() => setOpen(false)} onSubmit={handleSubmit} />
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      {celebrating && <ApprovalCelebration onDone={() => setCelebrating(false)} />}
    </>
  );
}
