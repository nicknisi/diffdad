import { useState } from 'react';
import { useReviewStore } from '../state/review-store';

type Resolution = 'comment' | 'approve' | 'request_changes';

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (resolution: Resolution, summary: string) => void;
};

const OPTIONS: { value: Resolution; label: string; desc: string }[] = [
  {
    value: 'comment',
    label: 'Comment',
    desc: 'General feedback without explicit approval.',
  },
  {
    value: 'approve',
    label: 'Approve',
    desc: 'Mark as ready to merge once any feedback is addressed.',
  },
  {
    value: 'request_changes',
    label: 'Request changes',
    desc: 'Block merge until your concerns are resolved.',
  },
];

export function SubmitDialog({ open, onClose, onSubmit }: Props) {
  const [resolution, setResolution] = useState<Resolution>('comment');
  const [summary, setSummary] = useState('');
  const draftCount = useReviewStore((s) => s.drafts.filter((d) => d.path && d.line !== undefined).length);

  if (!open) return null;

  const submitLabel =
    resolution === 'approve' ? 'Approve' : resolution === 'request_changes' ? 'Request changes' : 'Submit comment';

  const isDanger = resolution === 'request_changes';

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={onClose}
    >
      <div
        className="w-full bg-[var(--bg-panel)]"
        style={{
          maxWidth: 480,
          borderRadius: 12,
          padding: 22,
          boxShadow: '0 24px 48px -8px rgba(3,2,13,0.20), 0 8px 16px -4px rgba(3,2,13,0.10)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="m-0 mb-[6px] text-[18px] font-bold tracking-[-0.01em] text-[var(--fg-1)]">Submit your review</h3>
        <p className="m-0 mb-4 text-[13.5px] text-[var(--fg-2)]">
          {draftCount > 0
            ? `${draftCount} inline ${draftCount === 1 ? 'comment' : 'comments'} will be posted to GitHub along with this summary.`
            : 'Your review will be posted to GitHub.'}
        </p>
        <div className="mb-3.5 flex flex-col gap-2">
          {OPTIONS.map((opt) => {
            const selected = resolution === opt.value;
            return (
              <label
                key={opt.value}
                className="flex cursor-pointer items-start gap-2.5 rounded-[8px] px-3 py-2.5 transition-colors"
                style={
                  selected
                    ? {
                        background: 'var(--purple-2)',
                        boxShadow: 'inset 0 0 0 1.5px var(--purple-9)',
                      }
                    : { boxShadow: 'inset 0 0 0 1px var(--gray-a5)' }
                }
              >
                <input
                  type="radio"
                  name="resolution"
                  value={opt.value}
                  checked={selected}
                  onChange={() => setResolution(opt.value)}
                  className="mt-[3px]"
                  style={{ accentColor: 'var(--purple-9)' }}
                />
                <div>
                  <div
                    className="text-[13.5px] font-semibold"
                    style={{
                      color: selected ? 'var(--purple-12)' : 'var(--fg-1)',
                    }}
                  >
                    {opt.label}
                  </div>
                  <div className="mt-px text-[12.5px] leading-[17px] text-[var(--fg-2)]">{opt.desc}</div>
                </div>
              </label>
            );
          })}
        </div>
        <textarea
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Leave a summary comment (optional)…"
          className="block w-full resize-y px-3 py-2.5 text-[13.5px] leading-[19px] text-[var(--fg-1)] outline-none"
          style={{
            minHeight: 80,
            border: 0,
            borderRadius: 8,
            boxShadow: 'inset 0 0 0 1px var(--gray-a5)',
            background: 'transparent',
          }}
        />
        <div className="mt-3.5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-[30px] items-center rounded-[6px] px-3 text-[12.5px] font-bold text-[var(--fg-2)] hover:bg-[var(--gray-a3)] hover:text-[var(--fg-1)]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit(resolution, summary)}
            className="inline-flex h-[30px] items-center rounded-[6px] px-3 text-[12.5px] font-bold text-white"
            style={{
              background: isDanger ? 'var(--red-9)' : 'var(--brand)',
              boxShadow: '0 1px 2px rgba(3,2,13,0.08)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = isDanger ? 'var(--red-10)' : 'var(--brand-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = isDanger ? 'var(--red-9)' : 'var(--brand)';
            }}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
