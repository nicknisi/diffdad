import { getAccentMeta } from '../lib/accents';
import { useReviewStore } from '../state/review-store';
import { AccentPicker } from './AccentPicker';
import { DadMark } from './DadMark';
import { LivePill } from './LivePill';
import { ThemeToggle } from './ThemeToggle';
import { IconArrowRight } from './Icons';

function repoSlug(repoUrl: string | null): string | null {
  if (!repoUrl) return null;
  const m = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  return m?.[1] ?? null;
}

type AppBarProps = {
  onOpenActivity: () => void;
};

export function AppBar({ onOpenActivity }: AppBarProps) {
  const pr = useReviewStore((s) => s.pr);
  const accent = useReviewStore((s) => s.accent);
  const repoUrl = useReviewStore((s) => s.repoUrl);
  const mode = useReviewStore((s) => s.mode);

  const slug = repoSlug(repoUrl);
  const { markBg } = getAccentMeta(accent);
  const prNum = pr ? pr.number : null;
  const isWatch = mode === 'watch';

  return (
    <header
      className="sticky top-0 z-30 flex h-[52px] items-center gap-3.5 bg-[var(--bg-panel)] px-[18px]"
      style={{ boxShadow: 'inset 0 -1px 0 var(--gray-a4)' }}
    >
      {/* Brand mark */}
      <DadMark size={26} bg={markBg} shape="circle" showBadge={false} />

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
          {isWatch ? 'dad watch' : `dad review ${prNum ?? '—'}`}
        </span>
        <span className="inline-flex text-[var(--fg-3)]">
          <IconArrowRight className="h-[11px] w-[11px]" />
        </span>
        {isWatch ? (
          <span className="truncate text-[13px] font-medium font-sans">
            <span className="font-semibold" style={{ color: 'var(--purple-11)' }}>
              {slug ?? 'local'}
            </span>
            {pr?.branch ? <span style={{ color: 'var(--fg-1)' }}> @{pr.branch}</span> : null}
          </span>
        ) : slug && repoUrl && prNum != null ? (
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

        {/* Accent picker */}
        <AccentPicker />

        {/* Theme toggle: light → dark → auto */}
        <ThemeToggle />
      </div>
    </header>
  );
}
