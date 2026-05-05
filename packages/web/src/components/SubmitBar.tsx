import { useState } from 'react';
import { pendingReviewComments, useReviewStore } from '../state/review-store';
import { ApprovalCelebration } from './ApprovalCelebration';
import { SubmitDialog } from './SubmitDialog';
import { Toast } from './Toast';
import { copy } from '../lib/microcopy';

export function SubmitBar() {
  const narrative = useReviewStore((s) => s.narrative);
  const chapterStates = useReviewStore((s) => s.chapterStates);
  const drafts = useReviewStore((s) => s.drafts);
  const clearDrafts = useReviewStore((s) => s.clearDrafts);
  const submitOpen = useReviewStore((s) => s.submitOpen);
  const setSubmitOpen = useReviewStore((s) => s.setSubmitOpen);

  const [toast, setToast] = useState<string | null>(null);
  const [celebrating, setCelebrating] = useState(false);

  const open = submitOpen;
  const setOpen = setSubmitOpen;

  if (!narrative) return null;

  const total = narrative.chapters.length;
  const reviewedCount = Object.values(chapterStates).filter((s) => s === 'reviewed').length;
  const progress = total === 0 ? 0 : (reviewedCount / total) * 100;
  const draftCount = drafts.length;
  const allReviewed = total > 0 && reviewedCount === total;
  const ready = allReviewed; // primary callout: every chapter signed off

  // CTA evolves with reviewer progress so the bar feels alive.
  const ctaLabel =
    draftCount > 0 && ready
      ? `Ship ${draftCount} ${draftCount === 1 ? 'comment' : 'comments'} →`
      : draftCount > 0
        ? `Submit ${draftCount} ${draftCount === 1 ? 'comment' : 'comments'} →`
        : ready
          ? 'Approve & ship →'
          : 'Submit review';

  async function handleSubmit(resolution: string, summary: string) {
    try {
      const comments = pendingReviewComments(drafts);
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
          aria-keyshortcuts="s"
          className="inline-flex h-[30px] items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-bold text-white transition-colors"
          style={{
            background: ready ? 'var(--green-9)' : 'var(--brand)',
            boxShadow: '0 1px 2px rgba(3,2,13,0.08)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = ready ? 'var(--green-10)' : 'var(--brand-hover)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = ready ? 'var(--green-9)' : 'var(--brand)';
          }}
        >
          {ctaLabel}
          <kbd
            className="ml-1 hidden rounded-[3px] px-1 text-[10px] font-mono font-medium sm:inline"
            style={{ background: 'rgba(255,255,255,0.2)', color: 'rgba(255,255,255,0.85)' }}
          >
            s
          </kbd>
        </button>
      </div>
      <SubmitDialog open={open} onClose={() => setOpen(false)} onSubmit={handleSubmit} />
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
      {celebrating && <ApprovalCelebration onDone={() => setCelebrating(false)} />}
    </>
  );
}
