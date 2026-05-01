import { useState, type KeyboardEvent } from 'react';
import { useComments } from '../hooks/useComments';
import { getAuthorInfo } from '../lib/authors';
import type { PRComment } from '../state/types';
import { IconCheck, IconRefresh, IconReply } from './Icons';
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

function ReplyBox({ inReplyToId, onClose }: { inReplyToId: number; onClose: () => void }) {
  const { postComment } = useComments();
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = body.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await postComment(trimmed, { inReplyToId });
      setBody('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post');
    } finally {
      setSubmitting(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void submit();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  }

  return (
    <div className="mt-2">
      <textarea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Write a reply..."
        className="block w-full resize-y rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--fg-1)] outline-none focus:border-[var(--brand)]"
        rows={2}
      />
      {error && <div className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</div>}
      <div className="mt-1.5 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2.5 py-1 text-[12px] font-medium text-[var(--fg-2)] hover:text-[var(--fg-1)]"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!body.trim() || submitting}
          onClick={() => void submit()}
          className="rounded-md bg-[var(--brand)] px-2.5 py-1 text-[12px] font-semibold text-white shadow-sm hover:bg-[var(--brand-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? 'Posting...' : 'Reply'}
        </button>
      </div>
    </div>
  );
}

export function Comment({ comment, replies = [], isReply = false, showFilePath = false }: Props) {
  const info = getAuthorInfo(comment.author);
  const isBot = info.isBot;
  const kind = provenance(comment);
  const [collapsed, setCollapsed] = useState(false);
  const [replying, setReplying] = useState(false);

  const containerClass = isReply ? 'flex gap-2.5 py-2' : 'flex gap-2.5 py-2';

  return (
    <div className={containerClass}>
      {comment.avatarUrl ? (
        <img
          src={comment.avatarUrl}
          alt={comment.author}
          className="h-[22px] w-[22px] flex-shrink-0 rounded-full"
          style={
            isBot ? { boxShadow: '0 0 0 1.5px var(--bg-panel), 0 0 0 2.5px var(--purple-a5)' } : undefined
          }
        />
      ) : (
        <span
          className="flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
          style={{
            background: info.color,
            ...(isBot ? { boxShadow: '0 0 0 1.5px var(--bg-panel), 0 0 0 2.5px var(--purple-a5)' } : null),
          }}
        >
          {info.initials}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] font-medium text-[var(--fg-1)]">
          <b className="font-medium">{comment.author}</b>
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
          <span className="ml-auto flex items-center gap-2">
            {comment.id > 0 && !replying && (
              <button
                type="button"
                onClick={() => setReplying(true)}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--fg-3)] hover:text-[var(--brand)]"
              >
                <IconReply className="h-[10px] w-[10px]" />
                Reply
              </button>
            )}
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
        {replying && <ReplyBox inReplyToId={comment.id} onClose={() => setReplying(false)} />}
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
