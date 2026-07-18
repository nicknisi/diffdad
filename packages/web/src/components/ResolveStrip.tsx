import { useState } from 'react';
import { aiEndpoint } from '../lib/units-view';
import { useReviewStore } from '../state/review-store';
import { Markdown } from './markdown/Markdown';
import { InlineCommentComposer } from './InlineCommentComposer';
import type { ResolveItem, ResolveSeverity } from '../lib/walkthrough';

// Strip surface tokens per severity — louder than the inline flag glyph, quieter than a banner.
const STRIP: Record<ResolveSeverity, { bg: string; border: string; accent: string }> = {
  risk: { bg: 'var(--red-2)', border: 'var(--red-a4)', accent: 'var(--red-11)' },
  warn: { bg: 'var(--amber-2)', border: 'var(--amber-a5)', accent: 'var(--amber-11)' },
  info: { bg: 'var(--gray-2)', border: 'var(--gray-a5)', accent: 'var(--fg-2)' },
};

async function askDad(chapterIndex: number, question: string): Promise<string> {
  const { mode, route } = useReviewStore.getState();
  const res = await fetch(aiEndpoint(mode, route), {
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

const actionBtn =
  'inline-flex items-center gap-1 rounded-[6px] px-[11px] py-[5px] text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';

/**
 * The inline "surface what I should be sure about" strip on a flagged beat. Poses the
 * resolve item's question and offers explicit exits: clear it locally, interrogate the diff,
 * comment immediately, or batch an editable comment into the pending review.
 */
export function ResolveStrip({ item, inset = false }: { item: ResolveItem; inset?: boolean }) {
  const resolved = useReviewStore((s) => !!s.resolved[item.id]);
  const setResolved = useReviewStore((s) => s.setResolved);

  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [askError, setAskError] = useState<string | null>(null);
  const [commentOpen, setCommentOpen] = useState(false);
  const [commentSeed, setCommentSeed] = useState(item.question);

  const sev = STRIP[item.severity];
  const canAsk = item.chapterIndex >= 0; // orphan beats have no chapter to ask about
  const canComment = !!item.file && item.line != null;

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
        {canComment && (
          <button
            type="button"
            onClick={() => {
              setCommentSeed(item.question);
              setCommentOpen((open) => !open);
            }}
            className={actionBtn}
            style={{ color: 'var(--blue-11)', boxShadow: 'inset 0 0 0 1px var(--blue-a6)' }}
          >
            {commentOpen ? 'Cancel comment' : 'Comment'}
          </button>
        )}
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
      </div>

      {commentOpen && item.file && item.line != null && (
        <div className="mt-2 ml-6">
          <InlineCommentComposer
            key={commentSeed}
            path={item.file}
            line={item.line}
            initialBody={commentSeed}
            autoFocus
            onCancel={() => setCommentOpen(false)}
            onHandled={() => setResolved(item.id, true)}
          />
        </div>
      )}

      {askError && (
        <div className="mt-2 pl-6 text-[12px]" style={{ color: 'var(--red-11)' }}>
          {askError}
        </div>
      )}
      {answer && (
        <div
          className="mt-2 ml-6 rounded-[7px] px-3 py-2 text-[13px] text-[var(--fg-1)]"
          style={{ background: 'var(--bg-panel)', boxShadow: 'inset 0 0 0 1px var(--gray-a5)' }}
        >
          <Markdown source={answer} />
          {canComment && (
            <button
              type="button"
              onClick={() => {
                setCommentSeed(answer);
                setCommentOpen(true);
              }}
              className="mt-2 rounded-md px-2.5 py-1 text-[11.5px] font-semibold"
              style={{ color: 'var(--blue-11)', boxShadow: 'inset 0 0 0 1px var(--blue-a6)' }}
            >
              Use in comment
            </button>
          )}
        </div>
      )}
    </div>
  );
}
