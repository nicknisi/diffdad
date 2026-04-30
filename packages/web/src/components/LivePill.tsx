import { useEffect, useState } from 'react';
import { useReviewStore } from '../state/review-store';

function formatRelative(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

type Props = {
  onClick: () => void;
};

export function LivePill({ onClick }: Props) {
  const status = useReviewStore((s) => s.liveStatus);
  const eventCount = useReviewStore((s) => s.liveEvents.length);
  const lastEventAt = useReviewStore((s) => s.lastEventAt);

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, []);

  let label: string;
  let dotColor: string;
  let containerStyle: React.CSSProperties;
  let labelColor: string;
  let metaColor: string;
  let animateDot = true;

  if (status === 'connected') {
    label = 'Live';
    dotColor = 'var(--green-10)';
    containerStyle = {
      background: 'var(--green-3)',
      color: 'var(--green-11)',
      boxShadow: 'inset 0 0 0 1px var(--green-a5)',
    };
    labelColor = 'var(--green-11)';
    metaColor = 'var(--green-11)';
  } else if (status === 'connecting') {
    label = 'Reconnecting…';
    dotColor = 'var(--amber-10)';
    containerStyle = {
      background: 'var(--amber-3)',
      color: 'var(--amber-11)',
      boxShadow: 'inset 0 0 0 1px var(--amber-a5)',
    };
    labelColor = 'var(--amber-11)';
    metaColor = 'var(--amber-11)';
  } else {
    label = 'Offline';
    dotColor = 'var(--gray-9)';
    containerStyle = {
      background: 'var(--gray-3)',
      color: 'var(--fg-2)',
      boxShadow: 'inset 0 0 0 1px var(--gray-a5)',
    };
    labelColor = 'var(--fg-2)';
    metaColor = 'var(--fg-3)';
    animateDot = false;
  }

  const meta = `:4317 · ${eventCount} event${eventCount === 1 ? '' : 's'} · last ${formatRelative(now - lastEventAt)}`;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open activity drawer"
      className="inline-flex items-center gap-2 rounded-full py-1 pl-2 pr-2.5 text-[12px] font-medium transition-colors"
      style={containerStyle}
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ${animateDot ? 'live-ping-dot' : ''}`}
        style={{ background: dotColor }}
      />
      <span className="font-semibold" style={{ color: labelColor }}>
        {label}
      </span>
      <span className="font-mono text-[11.5px]" style={{ color: metaColor, opacity: 0.78 }}>
        {meta}
      </span>
    </button>
  );
}
