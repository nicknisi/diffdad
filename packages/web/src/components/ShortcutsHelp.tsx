import { useEffect } from 'react';
import { copy } from '../lib/microcopy';

type Props = {
  open: boolean;
  onClose: () => void;
};

const SHORTCUTS: { keys: string; desc: string }[] = [
  { keys: 'j / k', desc: 'Next / previous chapter' },
  { keys: 'r', desc: 'Toggle reviewed on current chapter' },
  { keys: 'c', desc: 'Open comment on current chapter' },
  { keys: 's', desc: 'Open the submit-review dialog' },
  { keys: 'Shift-click +', desc: 'Extend a comment to span multiple lines' },
  { keys: '?', desc: 'Show this help' },
  { keys: 'Esc', desc: 'Close overlays' },
];

export function ShortcutsHelp({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[420px] rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id="shortcuts-title" className="text-lg font-bold text-gray-900 dark:text-gray-50">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800"
          >
            ×
          </button>
        </div>
        <ul className="mt-4 space-y-2">
          {SHORTCUTS.map((s) => (
            <li key={s.keys} className="flex items-center gap-4 text-sm text-gray-700 dark:text-gray-300">
              <kbd className="inline-block min-w-[72px] rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-center font-mono text-xs font-semibold text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
                {s.keys}
              </kbd>
              <span>{s.desc}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 italic text-xs text-gray-500 dark:text-gray-400">{copy.shortcutsFooter}</p>
      </div>
    </div>
  );
}
