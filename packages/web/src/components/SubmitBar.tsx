import { useState } from "react";
import { useReviewStore } from "../state/review-store";
import { SubmitDialog } from "./SubmitDialog";
import { Toast } from "./Toast";

export function SubmitBar() {
  const narrative = useReviewStore((s) => s.narrative);
  const chapterStates = useReviewStore((s) => s.chapterStates);
  const drafts = useReviewStore((s) => s.drafts);
  const clearDrafts = useReviewStore((s) => s.clearDrafts);

  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  if (!narrative) return null;

  const total = narrative.chapters.length;
  const reviewedCount = Object.values(chapterStates).filter(
    (s) => s === "reviewed",
  ).length;
  const progress = total === 0 ? 0 : (reviewedCount / total) * 100;

  function handleSubmit() {
    setOpen(false);
    clearDrafts();
    setToast("✓ Review submitted to GitHub");
  }

  return (
    <>
      <div
        className="fixed bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-[14px] border border-[var(--border-strong)] bg-[var(--bg-panel)] py-2 pl-[14px] pr-2 shadow-[var(--shadow-elevated)]"
      >
        <div className="text-[12.5px] text-[var(--fg-2)]">
          <span className="font-bold text-[var(--fg-1)]">
            {reviewedCount} of {total}
          </span>{" "}
          chapters reviewed ·{" "}
          <span className="font-bold text-[var(--fg-1)]">
            {drafts.length}
          </span>{" "}
          pending {drafts.length === 1 ? "draft" : "drafts"}
        </div>
        <div className="h-1.5 w-[90px] overflow-hidden rounded-full bg-[var(--bg-subtle)]">
          <div
            className="h-full rounded-full bg-green-500 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-[30px] rounded-[8px] bg-[var(--brand)] px-3 text-[12.5px] font-bold text-white shadow-sm hover:bg-[var(--brand-hover)]"
        >
          Submit review
        </button>
      </div>
      <SubmitDialog
        open={open}
        onClose={() => setOpen(false)}
        onSubmit={handleSubmit}
      />
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </>
  );
}
