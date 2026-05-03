import { useEffect, useRef, useState } from 'react';
import { ACCENTS, getAccentMeta } from '../lib/accents';
import { useReviewStore } from '../state/review-store';
import { DadMark } from './DadMark';
import { LivePill } from './LivePill';
import { IconMoon, IconMonitor, IconSun, IconArrowRight } from './Icons';

function repoSlug(repoUrl: string | null): string | null {
  if (!repoUrl) return null;
  const m = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  return m ? m[1] : null;
}

function AccentPicker({
  accent,
  onSelect,
}: {
  accent: string;
  onSelect: (id: (typeof ACCENTS)[number]['id']) => void;
}) {
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

  const current = getAccentMeta(accent as (typeof ACCENTS)[number]['id']);

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

type AppBarProps = {
  onOpenActivity: () => void;
};

export function AppBar({ onOpenActivity }: AppBarProps) {
  const pr = useReviewStore((s) => s.pr);
  const theme = useReviewStore((s) => s.theme);
  const setTheme = useReviewStore((s) => s.setTheme);
  const accent = useReviewStore((s) => s.accent);
  const setAccent = useReviewStore((s) => s.setAccent);
  const repoUrl = useReviewStore((s) => s.repoUrl);
  const mode = useReviewStore((s) => s.mode);
  const watch = useReviewStore((s) => s.watch);

  const slug = repoSlug(repoUrl);
  const { markBg } = getAccentMeta(accent);
  const isWatch = mode === 'watch' || !!watch;
  const prNum = !isWatch && pr ? pr.number : null;

  const cliLabel = isWatch ? (watch ? `dad watch ${watch.branch}` : 'dad watch') : `dad review ${prNum ?? '—'}`;

  let target: { href: string | null; primary: string; secondary?: string; title: string } = {
    href: null,
    primary: '—',
    title: '',
  };
  if (isWatch) {
    if (watch) {
      if (slug && repoUrl) {
        target = {
          href: `${repoUrl}/tree/${watch.branch}`,
          primary: slug,
          secondary: `${watch.branch} → ${watch.base}`,
          title: 'Open branch on GitHub',
        };
      } else {
        target = {
          href: null,
          primary: watch.branch,
          secondary: `→ ${watch.base}`,
          title: '',
        };
      }
    } else {
      target = { href: null, primary: '—', title: '' };
    }
  } else if (slug && repoUrl && prNum != null) {
    target = {
      href: `${repoUrl}/pull/${prNum}`,
      primary: slug,
      secondary: `#${prNum}`,
      title: 'Open PR on GitHub',
    };
  }

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
          {cliLabel}
        </span>
        <span className="inline-flex text-[var(--fg-3)]">
          <IconArrowRight className="h-[11px] w-[11px]" />
        </span>
        {target.href ? (
          <a
            href={target.href}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-[13px] font-medium font-sans hover:underline"
            title={target.title}
          >
            <span className="font-semibold" style={{ color: 'var(--purple-11)' }}>
              {target.primary}
            </span>
            {target.secondary ? (
              <span className="ml-1" style={{ color: 'var(--fg-1)' }}>
                {target.secondary}
              </span>
            ) : null}
          </a>
        ) : (
          <span className="truncate text-[13px] font-medium font-sans">
            <span className="font-semibold" style={{ color: 'var(--purple-11)' }}>
              {target.primary}
            </span>
            {target.secondary ? (
              <span className="ml-1" style={{ color: 'var(--fg-1)' }}>
                {target.secondary}
              </span>
            ) : null}
          </span>
        )}
        <span className="ml-auto font-mono text-[11px] font-medium text-[var(--fg-3)]">pid 41278</span>
      </div>

      <div className="flex items-center gap-2">
        {/* Live pill */}
        <LivePill onClick={onOpenActivity} />

        {/* Accent picker */}
        <AccentPicker accent={accent} onSelect={setAccent} />

        {/* Theme toggle: light → dark → auto */}
        <button
          type="button"
          aria-label={`Theme: ${theme}`}
          title={`Theme: ${theme}`}
          onClick={() => setTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'auto' : 'light')}
          className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[6px] bg-[var(--bg-panel)] text-[var(--fg-2)] hover:bg-[var(--gray-2)] hover:text-[var(--fg-1)]"
          style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a5)' }}
        >
          {theme === 'light' ? (
            <IconSun className="h-[15px] w-[15px]" />
          ) : theme === 'dark' ? (
            <IconMoon className="h-[15px] w-[15px]" />
          ) : (
            <IconMonitor className="h-[15px] w-[15px]" />
          )}
        </button>
      </div>
    </header>
  );
}
