import { useState } from 'react';
import { useAgentComments } from '../hooks/useAgentComments';
import type { AgentComment } from '../state/types';
import { IconX } from './Icons';

type Props = {
  open: boolean;
  onClose: () => void;
};

const STATUS_STYLE: Record<AgentComment['status'], React.CSSProperties> = {
  open: { background: 'var(--blue-3)', color: 'var(--blue-11)' },
  delivered: { background: 'var(--amber-3)', color: 'var(--amber-11)' },
  addressed: { background: 'var(--green-3)', color: 'var(--green-11)' },
};

const STATUS_LABEL: Record<AgentComment['status'], string> = {
  open: 'open',
  delivered: 'delivered',
  addressed: 'addressed',
};

function CommentCard({ c }: { c: AgentComment }) {
  return (
    <div className="rounded-md border p-3 text-[13px]" style={{ borderColor: 'var(--gray-5)', background: 'var(--gray-2)' }}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-mono text-[12px]" style={{ color: 'var(--fg-2)' }}>
          {c.path}:{c.line}
        </span>
        <span className="rounded px-1.5 py-0.5 text-[11px] font-medium" style={STATUS_STYLE[c.status]}>
          {STATUS_LABEL[c.status]}
        </span>
      </div>
      {c.chapterTitle ? (
        <div className="mb-1 text-[11px] italic" style={{ color: 'var(--fg-3)' }}>
          {c.chapterTitle}
        </div>
      ) : null}
      <div style={{ color: 'var(--fg-1)' }}>{c.body}</div>
      {c.replies.map((r) => (
        <div
          key={r.id}
          className="mt-2 rounded border-l-2 pl-2 text-[12px]"
          style={{ borderColor: 'var(--purple-7)', color: 'var(--fg-2)' }}
        >
          <span className="font-medium" style={{ color: 'var(--purple-11)' }}>
            {r.author === 'agent' ? '🤖 agent' : r.author}
          </span>{' '}
          {r.body}
        </div>
      ))}
      {c.addressedNote ? (
        <div className="mt-1 text-[11px]" style={{ color: 'var(--green-11)' }}>
          ✓ {c.addressedNote}
        </div>
      ) : null}
    </div>
  );
}

export function AgentComments({ open, onClose }: Props) {
  const { agentComments, compose, copyForAgent } = useAgentComments();
  const [path, setPath] = useState('');
  const [line, setLine] = useState('');
  const [body, setBody] = useState('');
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const canSubmit = path.trim() !== '' && /^\d+$/.test(line.trim()) && body.trim() !== '';

  const submit = async () => {
    if (!canSubmit) return;
    const created = await compose({ path: path.trim(), line: Number(line.trim()), body: body.trim() });
    if (created) {
      setBody('');
      setLine('');
    }
  };

  const onCopy = async () => {
    if (await copyForAgent()) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  const inputStyle: React.CSSProperties = { background: 'var(--gray-1)', borderColor: 'var(--gray-6)', color: 'var(--fg-1)' };

  return (
    <div
      className="fixed right-0 top-0 z-40 flex h-full w-[360px] flex-col border-l shadow-xl"
      style={{ background: 'var(--gray-1)', borderColor: 'var(--gray-5)' }}
    >
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--gray-5)' }}>
        <span className="text-[13px] font-semibold" style={{ color: 'var(--fg-1)' }}>
          Agent Comments ({agentComments.length})
        </span>
        <button onClick={onClose} className="rounded p-1 hover:opacity-70" aria-label="Close">
          <IconX className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {agentComments.length === 0 ? (
          <p className="text-[12px]" style={{ color: 'var(--fg-3)' }}>
            No comments yet. Leave one below and your agent can fetch it over MCP.
          </p>
        ) : (
          agentComments.map((c) => <CommentCard key={c.id} c={c} />)
        )}
      </div>

      <div className="space-y-2 border-t p-3" style={{ borderColor: 'var(--gray-5)' }}>
        <div className="flex gap-2">
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="path/to/file.ts"
            className="min-w-0 flex-1 rounded border px-2 py-1 text-[12px]"
            style={inputStyle}
          />
          <input
            value={line}
            onChange={(e) => setLine(e.target.value)}
            placeholder="line"
            className="w-16 rounded border px-2 py-1 text-[12px]"
            style={inputStyle}
          />
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Comment for your agent…"
          rows={3}
          className="w-full rounded border px-2 py-1 text-[13px]"
          style={inputStyle}
        />
        <div className="flex items-center justify-between">
          <button
            onClick={onCopy}
            className="rounded px-2 py-1 text-[12px] hover:opacity-80"
            style={{ background: 'var(--gray-3)', color: 'var(--fg-2)' }}
          >
            {copied ? 'Copied!' : 'Copy for agent'}
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="rounded px-3 py-1 text-[12px] font-medium disabled:opacity-40"
            style={{ background: 'var(--purple-9)', color: 'white' }}
          >
            Add comment
          </button>
        </div>
      </div>
    </div>
  );
}
