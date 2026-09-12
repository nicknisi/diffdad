import { useReviewStore } from '../state/review-store';
import { Markdown } from './markdown/Markdown';

/**
 * The PR's full description (the GitHub `body`), so reviewing never requires a tab back to GitHub.
 * Rendered with the shared `<Markdown>` in its `github` variant (sanitized there).
 *
 * Deliberately NO height cap and no inner scroll region: the body flows on the page like GitHub's,
 * and the page scroll is the only scroll. The toggle lives in the store rather than component state
 * so a view switch — which remounts everything below App — doesn't pop a collapsed panel back open.
 * Nothing renders when there is no body (watch mode, PRs without a description).
 */
export function PrDescription() {
  const body = useReviewStore((s) => s.pr?.body ?? '');
  const open = useReviewStore((s) => s.descriptionOpen);
  const setDescriptionOpen = useReviewStore((s) => s.setDescriptionOpen);
  if (!body.trim()) return null;
  return (
    <section
      className="overflow-hidden rounded-[10px] bg-[var(--bg-panel)]"
      style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a5)' }}
    >
      <button
        type="button"
        onClick={() => setDescriptionOpen(!open)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center justify-between px-5 py-2.5 text-left"
      >
        <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--fg-3)]">Description</span>
        <span
          className={`shrink-0 text-[13px] leading-none text-[var(--fg-3)] transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden
        >
          ›
        </span>
      </button>
      {open && (
        <div className="px-5 pb-4 pt-1" style={{ boxShadow: 'inset 0 1px 0 var(--gray-a4)' }}>
          <Markdown source={body} variant="github" />
        </div>
      )}
    </section>
  );
}
