import { useEffect, useState } from 'react';
import { useReviewStore } from '../state/review-store';
import type { LiveEvent } from '../state/types';
import { IconChat, IconCheck, IconGitHub, IconRefresh, IconSpark, IconFiles, IconX } from './Icons';

type Props = {
  open: boolean;
  onClose: () => void;
};

function iconFor(kind: string) {
  switch (kind) {
    case 'bot_comment':
      return <IconSpark className="h-[11px] w-[11px]" />;
    case 'human_comment':
    case 'comment':
      return <IconChat className="h-[11px] w-[11px]" />;
    case 'ci':
      return <IconCheck className="h-[11px] w-[11px]" />;
    case 'commit':
      return <IconGitHub className="h-[11px] w-[11px]" />;
    case 'title_edit':
      return <IconFiles className="h-[11px] w-[11px]" />;
    case 'system':
      return <IconRefresh className="h-[11px] w-[11px]" />;
    default:
      return <span className="text-[11px]">•</span>;
  }
}

function iconStyleFor(kind: string): React.CSSProperties {
  switch (kind) {
    case 'bot_comment':
      return { background: 'var(--purple-3)', color: 'var(--purple-11)' };
    case 'human_comment':
    case 'comment':
      return { background: 'var(--blue-3)', color: 'var(--blue-11)' };
    case 'ci':
      return { background: 'var(--green-3)', color: 'var(--green-11)' };
    case 'commit':
      return { background: 'var(--amber-3)', color: 'var(--amber-11)' };
    case 'title_edit':
      return { background: 'var(--gray-3)', color: 'var(--fg-1)' };
    default:
      return { background: 'var(--gray-3)', color: 'var(--fg-2)' };
  }
}

function formatRelative(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function statusLabel(status: string): string {
  switch (status) {
    case 'connected':
      return 'Connected';
    case 'connecting':
      return 'Connecting…';
    case 'disconnected':
      return 'Offline';
    default:
      return status;
  }
}

export function ActivityDrawer({ open, onClose }: Props) {
  const events = useReviewStore((s) => s.liveEvents);
  const status = useReviewStore((s) => s.liveStatus);
  const [now, setNow] = useState(() => Date.now());
  const [mounted, setMounted] = useState(open);
  const [animateIn, setAnimateIn] = useState(false);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => setAnimateIn(true));
      return () => cancelAnimationFrame(id);
    } else {
      setAnimateIn(false);
      const id = setTimeout(() => setMounted(false), 200);
      return () => clearTimeout(id);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  const liveDot = status === 'connected';

  return (
    <>
      <div
        onClick={onClose}
        className={`fixed inset-0 z-[80] transition-opacity duration-200 ${animateIn ? 'opacity-100' : 'opacity-0'}`}
        style={{ background: 'rgba(0,0,0,0.18)' }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Activity"
        className={`fixed right-0 top-0 z-[81] flex h-full max-w-[92vw] flex-col bg-[var(--bg-panel)] transition-transform duration-200 ease-out ${
          animateIn ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{
          width: 420,
          boxShadow: '-1px 0 0 var(--gray-a5), -10px 0 30px rgba(0,0,0,0.08)',
        }}
      >
        <div
          className="flex items-start justify-between px-[18px] pt-4 pb-3"
          style={{ borderBottom: '1px solid var(--gray-a4)' }}
        >
          <div>
            <div className="text-[16px] font-semibold text-[var(--fg-1)]">Activity</div>
            <div className="mt-[2px] text-[12.5px] text-[var(--fg-3)]">
              webhooks streaming from{' '}
              <code className="rounded-[3px] bg-[var(--gray-3)] px-[5px] py-px font-mono text-[11.5px] font-medium">
                bunx diffappointment
              </code>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[6px] text-[var(--fg-2)] hover:bg-[var(--gray-2)] hover:text-[var(--fg-1)]"
            style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a5)' }}
          >
            <IconX className="h-[13px] w-[13px]" />
          </button>
        </div>
        <div
          className="flex items-center gap-2 px-[18px] py-2 text-[12px] font-medium text-[var(--fg-2)]"
          style={{ background: 'var(--gray-2)' }}
        >
          <span
            className={`inline-block h-[7px] w-[7px] rounded-full ${liveDot ? 'live-ping-dot' : ''}`}
            style={{
              background: liveDot ? 'var(--green-10)' : 'var(--gray-9)',
            }}
          />
          <span>
            <b className="font-bold text-[var(--fg-1)]">{statusLabel(status)}</b> · port 4317
          </span>
        </div>
        <div className="overflow-y-auto px-[10px] pt-2 pb-6 flex-1">
          {events.length === 0 ? (
            <div className="p-6 text-center text-sm text-[var(--fg-3)]">No activity yet.</div>
          ) : (
            <div>
              {events.map((ev: LiveEvent, idx) => (
                <div
                  key={ev.id}
                  className="grid items-start gap-2.5 rounded-[6px] px-2 py-2.5 text-[13px]"
                  style={{
                    gridTemplateColumns: '24px 1fr',
                    borderTop: idx === 0 ? 'none' : '1px solid var(--gray-a3)',
                  }}
                >
                  <span
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full"
                    style={iconStyleFor(ev.kind)}
                  >
                    {iconFor(ev.kind)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="leading-[18px] text-[var(--fg-1)]">{ev.summary}</div>
                    <div className="mt-[2px] font-mono text-[11.5px] font-medium" style={{ color: 'var(--fg-3)' }}>
                      {formatRelative(now - ev.timestamp)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
