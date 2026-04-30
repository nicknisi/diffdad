import { useState } from 'react';
import { getAuthorInfo } from '../lib/authors';
import type { PRComment } from '../state/types';
import { IconCheck, IconRefresh } from './Icons';
import { Markdown } from './markdown/Markdown';

const RECENT_SYNC_WINDOW_MS = 60_000;

function relativeTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

type Props = {
  comment: PRComment;
  replies?: PRComment[];
  isReply?: boolean;
  showFilePath?: boolean;
};

type Provenance = 'draft' | 'synced' | 'github' | 'syncing';

function provenance(comment: PRComment): Provenance {
  if (comment.id < 0) return 'draft';
  const created = new Date(comment.createdAt).getTime();
  if (!Number.isNaN(created) && Date.now() - created < RECENT_SYNC_WINDOW_MS && comment.id > 0) {
    return 'synced';
  }
  return 'github';
}

function SourceBadge({ kind }: { kind: Provenance }) {
  const baseStyle =
    'inline-flex items-center gap-1 rounded-[3px] px-[5px] py-px text-[10.5px] font-medium tracking-[0.02em]';
  if (kind === 'syncing') {
    return (
      <span className={baseStyle} style={{ background: 'var(--yellow-3)', color: 'var(--yellow-11)' }}>
        <IconRefresh className="h-[9px] w-[9px] animate-spin" />
        syncing…
      </span>
    );
  }
  if (kind === 'draft') {
    return (
      <span className={baseStyle} style={{ background: 'var(--gray-3)', color: 'var(--fg-2)' }}>
        pending
      </span>
    );
  }
  if (kind === 'github') {
    return (
      <span className={baseStyle} style={{ background: 'var(--green-3)', color: 'var(--green-11)' }}>
        from GitHub
      </span>
    );
  }
  return (
    <span className={baseStyle} style={{ background: 'var(--green-3)', color: 'var(--green-11)' }}>
      <IconCheck className="h-[9px] w-[9px]" />
      synced to GitHub
    </span>
  );
}

export function Comment({ comment, replies = [], isReply = false, showFilePath = false }: Props) {
  const info = getAuthorInfo(comment.author);
  const isBot = info.isBot;
  const kind = provenance(comment);
  const [collapsed, setCollapsed] = useState(false);

  const containerClass = isReply ? 'flex gap-2.5 py-2' : 'flex gap-2.5 py-2';

  return (
    <div className={containerClass}>
      <span
        className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
        style={{
          background: info.color,
          ...(isBot
            ? {
                boxShadow: '0 0 0 1.5px var(--bg-panel), 0 0 0 2.5px var(--purple-a5)',
              }
            : null),
        }}
      >
        {info.initials}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] font-medium text-[var(--fg-1)]">
          <b className="font-medium">{info.displayName}</b>
          {isBot && (
            <span
              className="ml-1 rounded-[3px] px-[5px] py-px font-mono text-[9.5px] font-semibold uppercase tracking-[0.06em]"
              style={{
                background: 'var(--purple-3)',
                color: 'var(--purple-11)',
              }}
            >
              bot
            </span>
          )}
          <span className="font-normal text-[var(--fg-3)]">{relativeTime(comment.createdAt)}</span>
          <span className="ml-auto">
            <SourceBadge kind={kind} />
          </span>
        </div>
        {showFilePath && comment.path && (
          <div
            className="mt-1 mb-1 inline-flex items-center gap-1 rounded-[3px] px-1.5 py-px font-mono text-[11px]"
            style={{ background: 'var(--gray-3)', color: 'var(--fg-3)' }}
          >
            {comment.path}
            {comment.line !== undefined && <span>:L{comment.line}</span>}
          </div>
        )}
        <div className="mt-[3px] text-[13.5px] leading-[19px] text-[var(--fg-1)]">
          <Markdown source={comment.body} />
        </div>
        {replies.length > 0 && (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setCollapsed((c) => !c)}
              className="text-[11px] font-medium text-[var(--fg-3)] hover:text-[var(--fg-1)]"
            >
              {collapsed
                ? `Show ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`
                : `Hide ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`}
            </button>
            {!collapsed && (
              <div className="mt-2 space-y-2 border-l-2 pl-3" style={{ borderColor: 'var(--gray-a4)' }}>
                {replies.map((r) => (
                  <Comment key={r.id} comment={r} isReply />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
