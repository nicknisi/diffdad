import { useState } from "react";

type Resolution = "comment" | "approve" | "request_changes";

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (resolution: Resolution, summary: string) => void;
};

const OPTIONS: { value: Resolution; label: string; desc: string }[] = [
  {
    value: "comment",
    label: "Comment",
    desc: "Submit general feedback without explicit approval.",
  },
  {
    value: "approve",
    label: "Approve",
    desc: "Submit feedback approving these changes.",
  },
  {
    value: "request_changes",
    label: "Request changes",
    desc: "Submit feedback that must be addressed before merging.",
  },
];

export function SubmitDialog({ open, onClose, onSubmit }: Props) {
  const [resolution, setResolution] = useState<Resolution>("approve");
  const [summary, setSummary] = useState("");

  if (!open) return null;

  const submitLabel =
    resolution === "approve"
      ? "Approve PR"
      : resolution === "request_changes"
        ? "Request changes"
        : "Submit comment";

  const submitClasses =
    resolution === "request_changes"
      ? "bg-red-600 hover:bg-red-700"
      : "bg-[var(--brand)] hover:bg-[var(--brand-hover)]";

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[480px] rounded-2xl bg-[var(--bg-panel)] p-6 shadow-[var(--shadow-elevated)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold tracking-[-0.01em] text-[var(--fg-1)]">
          Submit your review
        </h2>
        <div className="mt-4 space-y-2">
          {OPTIONS.map((opt) => {
            const selected = resolution === opt.value;
            return (
              <label
                key={opt.value}
                className={`block cursor-pointer rounded-md border p-3 text-sm ${
                  selected
                    ? "border-[var(--brand)] bg-[var(--brand-soft)]"
                    : "border-[var(--border)] hover:bg-[var(--bg-subtle)]"
                }`}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="resolution"
                    value={opt.value}
                    checked={selected}
                    onChange={() => setResolution(opt.value)}
                    className="mt-1 accent-[var(--brand)]"
                  />
                  <div>
                    <div className="font-semibold text-[var(--fg-1)]">
                      {opt.label}
                    </div>
                    <div className="text-[12.5px] leading-[17px] text-[var(--fg-2)]">
                      {opt.desc}
                    </div>
                  </div>
                </div>
              </label>
            );
          })}
        </div>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Optional summary..."
          className="mt-4 block min-h-[80px] w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--fg-1)] outline-none focus:border-[var(--brand)]"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm font-medium text-[var(--fg-1)] hover:bg-[var(--bg-subtle)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit(resolution, summary)}
            className={`rounded-md px-4 py-1.5 text-sm font-bold text-white shadow-sm ${submitClasses}`}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
