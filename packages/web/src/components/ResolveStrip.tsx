import { useState } from 'react';
import { useReviewStore } from '../state/review-store';
import { Markdown } from './markdown/Markdown';
import type { ResolveItem, ResolveSeverity } from '../lib/walkthrough';

// Strip surface tokens per severity — louder than the inline flag glyph, quieter than a banner.
const STRIP: Record<ResolveSeverity, { bg: string; border: string; accent: string }> = {
  risk: { bg: 'var(--red-2)', border: 'var(--red-a4)', accent: 'var(--red-11)' },
  warn: { bg: 'var(--amber-2)', border: 'var(--amber-a5)', accent: 'var(--amber-11)' },
  info: { bg: 'var(--gray-2)', border: 'var(--gray-a5)', accent: 'var(--fg-2)' },
};

async function askDad(chapterIndex: number, question: string): Promise<string> {
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'ask', chapterIndex, question }),
  });
  if (!res.ok) {
    let msg = `Request failed: ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) msg = data.error;
    } catch {
      // keep the status-code message
    }
    throw new Error(msg);
  }
  const data = (await res.json()) as { text: string };
  return data.text;
}

async function sendToAgent(item: ResolveItem): Promise<void> {
  // Post directly to the agent-comment loop — NOT via useComments.postComment, which routes
  // to GitHub in review mode. The beat's file/line is exactly what an agent comment needs.
  const res = await fetch('/api/agent-comments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: item.file, line: item.line, side: 'RIGHT', body: item.question }),
  });
  if (!res.ok) throw new Error(`Failed to send (${res.status})`);
}

const actionBtn =
  'inline-flex items-center gap-1 rounded-[6px] px-[11px] py-[5px] text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

/**
 * The inline "surface what I should be sure about" strip on a flagged beat. Poses the
 * resolve item's question and offers three exits: clear it locally (Looks fine), interrogate
 * the diff (Ask dad → /api/ai), or hand it to the connected agent (Send to agent → the
 * agent-comment loop). Reuses endpoints that already exist; nothing new server-side.
 */
export function ResolveStrip({ item, inset = false }: { item: ResolveItem; inset?: boolean }) {
  const resolved = useReviewStore((s) => !!s.resolved[item.id]);
  const setResolved = useReviewStore((s) => s.setResolved);

  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const sev = STRIP[item.severity];
  const canAsk = item.chapterIndex >= 0; // orphan beats have no chapter to ask about
  const canSend = !!item.file && item.line != null;

  if (resolved) {
    return (
      <div
        className={`${inset ? '' : 'ml-[34px] '}flex items-center gap-2 rounded-[9px] px-3 py-2 text-[12.5px] text-[var(--fg-3)]`}
      >
        <span style={{ color: 'var(--green-11)' }}>✓</span>
        <span className="min-w-0 flex-1 truncate line-through">{item.question}</span>
        <button
          type="button"
          onClick={() => setResolved(item.id, false)}
          className="bg-transparent text-[12px] font-medium underline underline-offset-2 hover:text-[var(--fg-2)]"
        >
          Undo
        </button>
      </div>
    );
  }

  async function handleAsk() {
    if (asking) return;
    setAsking(true);
    setAskError(null);
    setAnswer(null);
    try {
      setAnswer(await askDad(item.chapterIndex, item.question));
    } catch (err) {
      setAskError(err instanceof Error ? err.message : 'Ask failed');
    } finally {
      setAsking(false);
    }
  }

  async function handleSend() {
    if (sending || sent) return;
    setSending(true);
    setSendError(null);
    try {
      await sendToAgent(item);
      setSent(true);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Send failed');
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className={`${inset ? '' : 'ml-[34px] '}rounded-[9px] px-3 py-2.5`}
      style={{ background: sev.bg, boxShadow: `inset 0 0 0 1px ${sev.border}` }}
    >
      <div className="flex items-start gap-2 text-[12.5px] font-semibold leading-[18px] text-[var(--fg-1)]">
        <span
          aria-hidden
          className="mt-[1px] inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold"
          style={{ color: sev.accent, boxShadow: `inset 0 0 0 1.5px ${sev.accent}` }}
        >
          ?
        </span>
        <span className="min-w-0 flex-1">{item.question}</span>
      </div>

      <div className="mt-2 flex flex-wrap gap-2 pl-6">
        <button
          type="button"
          onClick={() => setResolved(item.id, true)}
          className={actionBtn}
          style={{ color: 'var(--green-11)', boxShadow: 'inset 0 0 0 1px var(--green-a8)' }}
        >
          ✓ Looks fine
        </button>
        {canAsk && (
          <button
            type="button"
            onClick={() => void handleAsk()}
            disabled={asking}
            className={actionBtn}
            style={{ color: 'var(--fg-2)', boxShadow: 'inset 0 0 0 1px var(--gray-a5)' }}
          >
            {asking ? 'Asking…' : 'Ask dad'}
          </button>
        )}
        {canSend && (
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={sending || sent}
            className={actionBtn}
            style={{
              color: 'var(--purple-11)',
              background: 'var(--purple-a3)',
              boxShadow: 'inset 0 0 0 1px var(--purple-a5)',
            }}
          >
            {sent ? 'Sent ✓' : sending ? 'Sending…' : 'Send to agent →'}
          </button>
        )}
      </div>

      {askError && (
        <div className="mt-2 pl-6 text-[12px]" style={{ color: 'var(--red-11)' }}>
          {askError}
        </div>
      )}
      {sendError && (
        <div className="mt-2 pl-6 text-[12px]" style={{ color: 'var(--red-11)' }}>
          {sendError}
        </div>
      )}
      {answer && (
        <div
          className="mt-2 ml-6 rounded-[7px] px-3 py-2 text-[13px] text-[var(--fg-1)]"
          style={{ background: 'var(--bg-panel)', boxShadow: 'inset 0 0 0 1px var(--gray-a5)' }}
        >
          <Markdown source={answer} />
        </div>
      )}
    </div>
  );
}
