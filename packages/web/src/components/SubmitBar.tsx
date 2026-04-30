import { useState } from "react";
import { copy } from "../lib/microcopy";
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

  async function handleSubmit(resolution: string, summary: string) {
    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event: resolution, body: summary }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setOpen(false);
      clearDrafts();
      const toastMsg =
        resolution === "approve"
          ? copy.approvalToast
          : resolution === "request_changes"
            ? copy.requestChangesToast
            : copy.commentToast;
      setToast(toastMsg);
    } catch {
      setToast(copy.errorGeneric);
    }
  }

  return (
    <>
      <div
        className="fixed bottom-4 left-1/2 z-10 -translate-x-1/2 flex items-center gap-3 rounded-[14px] bg-[var(--bg-panel)]"
        style={{
          padding: "8px 8px 8px 14px",
          boxShadow:
            "0 12px 24px -4px rgba(3,2,13,0.18), 0 4px 8px -2px rgba(3,2,13,0.10), inset 0 0 0 1px var(--gray-a6)",
        }}
      >
        <div>
          <div className="text-[12.5px] font-normal text-[var(--fg-2)]">
            {total > 0 && reviewedCount === total && drafts.length === 0 ? (
              <b className="font-bold text-[var(--fg-1)]">
                {copy.allReviewed}
              </b>
            ) : (
              <>
                <b className="font-bold text-[var(--fg-1)]">
                  {reviewedCount} of {total}
                </b>{" "}
                chapters reviewed ·{" "}
                <b className="font-bold text-[var(--fg-1)]">
                  {drafts.length}
                </b>{" "}
                pending {drafts.length === 1 ? "draft" : "drafts"}
              </>
            )}
          </div>
          <div
            className="mt-1 h-[6px] w-[90px] overflow-hidden rounded-full"
            style={{ background: "var(--gray-3)" }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${progress}%`,
                background: "var(--green-9)",
              }}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex h-[30px] items-center gap-1.5 rounded-[6px] bg-[var(--brand)] px-3 text-[12.5px] font-bold text-white hover:bg-[var(--brand-hover)]"
          style={{ boxShadow: "0 1px 2px rgba(3,2,13,0.08)" }}
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
