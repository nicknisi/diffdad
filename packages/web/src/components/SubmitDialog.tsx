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
      : "bg-brand hover:bg-brand/90";

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[480px] rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-[20px] font-bold text-gray-900 dark:text-gray-50">
          Submit your review
        </h2>
        <div className="mt-4 space-y-2">
          {OPTIONS.map((opt) => {
            const selected = resolution === opt.value;
            return (
              <label
                key={opt.value}
                className={`block cursor-pointer rounded-md border p-3 text-[13.5px] ${
                  selected
                    ? "border-brand bg-brand/5"
                    : "border-gray-200 dark:border-gray-800"
                }`}
              >
                <div className="flex items-start gap-2">
                  <input
                    type="radio"
                    name="resolution"
                    value={opt.value}
                    checked={selected}
                    onChange={() => setResolution(opt.value)}
                    className="mt-1 accent-brand"
                  />
                  <div>
                    <div className="font-medium text-gray-900 dark:text-gray-100">
                      {opt.label}
                    </div>
                    <div className="text-[12.5px] text-gray-500 dark:text-gray-400">
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
          className="mt-4 block min-h-[100px] w-full rounded-md border border-gray-200 bg-transparent px-3 py-2 text-[14.5px] outline-none focus:border-brand dark:border-gray-800"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-[13px] text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit(resolution, summary)}
            className={`rounded-md px-4 py-1.5 text-[13px] font-medium text-white ${submitClasses}`}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
