import { useEffect, useState } from 'react';
import { useReviewStore } from '../state/review-store';
import { DadMark } from './DadMark';
import { getAccentMeta } from '../lib/accents';

type Props = {
  message: string;
  compact?: boolean;
  subtitle?: string;
};

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

export function GeneratingScreen({ message, compact = false, subtitle }: Props) {
  const pr = useReviewStore((s) => s.pr);
  const files = useReviewStore((s) => s.files);
  const accent = useReviewStore((s) => s.accent);
  const mode = useReviewStore((s) => s.mode);
  const progressChars = useReviewStore((s) => s.narrativeProgressChars);
  const { markBg } = getAccentMeta(accent);

  const [elapsedMs, setElapsedMs] = useState(0);
  useEffect(() => {
    const startedAt = Date.now();
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt), 500);
    return () => clearInterval(id);
  }, []);

  const wrapperClass = compact
    ? 'flex flex-col items-center justify-center px-6 py-16'
    : 'flex min-h-screen flex-col items-center justify-center bg-[var(--bg-page)] px-6';
  const markSize = compact ? 48 : 64;

  return (
    <main className={wrapperClass}>
      <div className="flex flex-col items-center gap-6 text-center">
        <div style={{ animation: 'generating-bob 2s ease-in-out infinite' }}>
          <DadMark size={markSize} bg={markBg} shape="circle" showBadge={false} showWink />
        </div>

        {!compact && pr && mode === 'pr' && (
          <div className="space-y-1">
            <h1 className="m-0 text-[22px] font-bold tracking-tight text-[var(--fg-1)]">
              <span className="font-normal text-[var(--fg-3)]">#{pr.number}</span> {pr.title}
            </h1>
            <div className="text-[13px] text-[var(--fg-3)]">
              <span style={{ color: 'var(--green-11)' }}>+{pr.additions}</span>{' '}
              <span style={{ color: 'var(--red-11)' }}>-{pr.deletions}</span>
              {' across '}
              {files.length} {files.length === 1 ? 'file' : 'files'}
              {' by '}
              <span className="font-medium text-[var(--fg-2)]">{pr.author?.login}</span>
            </div>
          </div>
        )}

        {subtitle ? <p className="text-[13px] text-[var(--fg-3)]">{subtitle}</p> : null}

        <div className="flex items-center gap-3">
          <div className="generating-dots flex gap-1">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: 'var(--purple-9)', animation: 'generating-dot 1.4s ease-in-out infinite' }}
            />
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: 'var(--purple-9)', animation: 'generating-dot 1.4s ease-in-out 0.2s infinite' }}
            />
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: 'var(--purple-9)', animation: 'generating-dot 1.4s ease-in-out 0.4s infinite' }}
            />
          </div>
          <p
            className="text-[14px] italic text-[var(--fg-2)]"
            style={{ animation: 'generating-fade 2.5s ease-in-out infinite' }}
          >
            {message}
          </p>
        </div>

        <div className="text-[12px] tabular-nums text-[var(--fg-3)]">
          {formatElapsed(elapsedMs)} elapsed
          {progressChars > 0 ? ` — ${progressChars.toLocaleString()} characters` : ''}
        </div>
      </div>
    </main>
  );
}
