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
      <div className="fixed inset-x-0 bottom-0 z-20 flex h-14 items-center justify-between border-t border-gray-200 bg-white px-8 shadow-md dark:border-gray-800 dark:bg-gray-900">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-gray-700 dark:text-gray-300">
            {reviewedCount} of {total} chapters reviewed · {drafts.length}{" "}
            pending {drafts.length === 1 ? "draft" : "drafts"}
          </div>
          <div className="mt-1 h-1 w-full max-w-[420px] overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
            <div
              className="h-full bg-brand transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md bg-brand px-4 py-2 text-[13px] font-medium text-white hover:bg-brand/90"
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
