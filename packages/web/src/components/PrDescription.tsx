import { useReviewStore } from '../state/review-store';
import { Markdown } from './markdown/Markdown';

/**
 * The PR's full description (the GitHub `body`), so reviewing never requires a tab back to GitHub.
 * Rendered with the shared `<Markdown>` (sanitized there). Open by default; the native `<details>`
 * toggle collapses it. React diffs against props, not DOM state, so a live-update re-render never
 * pops a manually collapsed panel back open. Nothing renders when there is no body (watch mode,
 * PRs without a description).
 */
export function PrDescription() {
  const body = useReviewStore((s) => s.pr?.body ?? '');
  if (!body.trim()) return null;
  return (
    <div className="mx-auto max-w-[1100px] px-6 pt-4">
      <details
        open
        className="rounded-[10px] bg-[var(--bg-panel)]"
        style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a5)' }}
      >
        <summary className="cursor-pointer select-none px-5 py-2.5 text-[12px] font-bold uppercase tracking-[0.06em] text-[var(--fg-3)] hover:text-[var(--fg-2)]">
          Description
        </summary>
        {/* Height-capped so a long description can't push the verdict/story off screen; scrolls inside. */}
        <div className="max-h-[420px] overflow-y-auto px-5 pb-4 pt-1">
          <Markdown source={body} />
        </div>
      </details>
    </div>
  );
}
