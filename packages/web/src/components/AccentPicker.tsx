import { useEffect, useRef, useState } from 'react';
import { ACCENTS, getAccentMeta } from '../lib/accents';
import { useReviewStore } from '../state/review-store';

/**
 * The accent-color dropdown — dad's wardrobe. Self-contained (reads accent + setAccent from the
 * store) so the PR AppBar and the daemon surfaces share one control. The accent also tints the
 * DadMark, so giving the command center this picker is what restores the brand's personality there.
 */
export function AccentPicker() {
  const accent = useReviewStore((s) => s.accent);
  const onSelect = useReviewStore((s) => s.setAccent);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = getAccentMeta(accent);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={`Accent: ${current.name}`}
        title={`Accent: ${current.name}`}
        onClick={() => setOpen(!open)}
        className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[6px] bg-[var(--bg-panel)] hover:bg-[var(--gray-2)]"
        style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a5)' }}
      >
        <span
          className="h-3.5 w-3.5 rounded-full"
          style={{
            background: current.dot,
            boxShadow: `0 0 0 1.5px var(--bg-panel), 0 0 0 2.5px ${current.dot}40`,
          }}
        />
      </button>
      {open && (
        <div
          className="absolute right-0 top-[calc(100%+6px)] z-40 rounded-[10px] bg-[var(--bg-panel)] p-2"
          style={{
            boxShadow: 'var(--shadow-elevated), inset 0 0 0 1px var(--gray-a4)',
            animation: 'fade-in 120ms ease-out',
          }}
        >
          <div className="flex flex-col gap-1">
            {ACCENTS.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => {
                  onSelect(a.id);
                  setOpen(false);
                }}
                className="flex items-center gap-2.5 rounded-[6px] px-2.5 py-1.5 text-left text-[12px] font-medium text-[var(--fg-2)] hover:bg-[var(--gray-3)] hover:text-[var(--fg-1)]"
              >
                <span
                  className="h-3 w-3 flex-shrink-0 rounded-full"
                  style={{
                    background: a.dot,
                    boxShadow: accent === a.id ? `0 0 0 2px var(--bg-panel), 0 0 0 3px ${a.dot}` : undefined,
                  }}
                />
                <span className="whitespace-nowrap">{a.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
