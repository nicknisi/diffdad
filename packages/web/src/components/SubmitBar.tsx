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
        className="fixed bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-[14px] border border-black/[0.08] bg-white py-2 pl-[14px] pr-2 dark:border-white/10 dark:bg-gray-900"
        style={{
          boxShadow:
            "0 12px 24px -4px rgba(3,2,13,0.18), 0 4px 8px -2px rgba(3,2,13,0.10)",
        }}
      >
        <div className="text-sm text-gray-700 dark:text-gray-300">
          <span className="font-semibold text-gray-900 dark:text-gray-100">
            {reviewedCount} of {total}
          </span>{" "}
          chapters reviewed ·{" "}
          <span className="font-semibold text-gray-900 dark:text-gray-100">
            {drafts.length}
          </span>{" "}
          pending {drafts.length === 1 ? "draft" : "drafts"}
        </div>
        <div className="h-1.5 w-[90px] overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
          <div
            className="h-full rounded-full bg-green-500 transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg bg-brand px-3 py-1.5 text-sm font-medium text-white hover:bg-brand/90"
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
