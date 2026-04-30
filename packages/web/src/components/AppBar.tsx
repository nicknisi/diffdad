import { copy } from '../lib/microcopy';
import { useReviewStore } from '../state/review-store';
import { LivePill } from './LivePill';
import { IconMoon, IconSun, IconArrowRight } from './Icons';

function repoSlug(repoUrl: string | null): string | null {
  if (!repoUrl) return null;
  const m = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  return m ? m[1] : null;
}

type AppBarProps = {
  onOpenActivity: () => void;
};

export function AppBar({ onOpenActivity }: AppBarProps) {
  const pr = useReviewStore((s) => s.pr);
  const theme = useReviewStore((s) => s.theme);
  const setTheme = useReviewStore((s) => s.setTheme);
  const repoUrl = useReviewStore((s) => s.repoUrl);

  const slug = repoSlug(repoUrl);
  const prNum = pr ? pr.number : null;

  return (
    <header
      className="sticky top-0 z-30 flex h-[52px] items-center gap-3.5 bg-[var(--bg-panel)] px-[18px]"
      style={{ boxShadow: 'inset 0 -1px 0 var(--gray-a4)' }}
    >
      {/* Brand mark */}
      <img
        src="/diff-dad-mark.svg"
        alt="Diff Dad"
        title={copy.brandTooltip}
        className="h-[26px] w-[26px]"
      />

      {/* Separator */}
      <span aria-hidden className="mx-1 inline-block h-5 w-px" style={{ background: 'var(--gray-a4)' }} />

      {/* CLI framing */}
      <div className="flex min-w-0 flex-1 items-center gap-2 font-mono text-[12.5px] font-medium text-[var(--fg-2)]">
        <span className="font-bold text-[var(--purple-10,_var(--brand-hover))]" style={{ color: 'var(--purple-10)' }}>
          $
        </span>
        <span
          className="whitespace-nowrap rounded-[4px] bg-[var(--gray-3)] px-2 py-0.5 text-[var(--fg-1)]"
          style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a5)' }}
        >
          dad review {prNum ?? '—'}
        </span>
        <span className="inline-flex text-[var(--fg-3)]">
          <IconArrowRight className="h-[11px] w-[11px]" />
        </span>
        {slug && repoUrl && prNum != null ? (
          <a
            href={`${repoUrl}/pull/${prNum}`}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-[13px] font-medium font-sans hover:underline"
            title="Open PR on GitHub"
          >
            <span className="font-semibold" style={{ color: 'var(--purple-11)' }}>
              {slug}
            </span>
            <span style={{ color: 'var(--fg-1)' }}>#{prNum}</span>
          </a>
        ) : (
          <span className="text-[var(--fg-3)]">—</span>
        )}
        <span className="ml-auto font-mono text-[11px] font-medium text-[var(--fg-3)]">pid 41278</span>
      </div>

      <div className="flex items-center gap-2">
        {/* Live pill */}
        <LivePill onClick={onOpenActivity} />

        {/* Theme toggle */}
        <button
          type="button"
          aria-label="Toggle theme"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
          className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[6px] bg-[var(--bg-panel)] text-[var(--fg-2)] hover:bg-[var(--gray-2)] hover:text-[var(--fg-1)]"
          style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a5)' }}
        >
          {theme === 'dark' ? <IconSun className="h-[15px] w-[15px]" /> : <IconMoon className="h-[15px] w-[15px]" />}
        </button>

      </div>
    </header>
  );
}
