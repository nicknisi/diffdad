import { useState, type KeyboardEvent } from 'react';
import { useComments } from '../hooks/useComments';
import { copy } from '../lib/microcopy';
import { useReviewStore } from '../state/review-store';
import { IconChat, IconRefresh, IconSpark, IconX } from './Icons';
import { Markdown } from './markdown/Markdown';

type Density = 'terse' | 'normal' | 'verbose';
type PerspectiveLens = 'security' | 'performance' | 'API consumer';

const DENSITIES: Density[] = ['terse', 'normal', 'verbose'];
const LENS_CYCLE: PerspectiveLens[] = ['security', 'performance', 'API consumer'];

type Props = {
  chapterIndex: number;
};

async function callAi(payload: {
  action: 'ask' | 'renarrate';
  chapterIndex: number;
  question?: string;
  lens?: string;
}): Promise<string> {
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let msg = `Request failed: ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) msg = data.error;
    } catch {
      // ignore
    }
    throw new Error(msg);
  }
  const data = (await res.json()) as { text: string };
  return data.text;
}

export function NarrationAnchor({ chapterIndex }: Props) {
  const chapterKey = `ch-${chapterIndex}`;
  const globalDensity = useReviewStore((s) => s.density);
  const chapterDensityMap = useReviewStore((s) => s.chapterDensity);
  const setChapterDensity = useReviewStore((s) => s.setChapterDensity);
  const activeDensity = chapterDensityMap[chapterKey] ?? globalDensity;

  const mode = useReviewStore((s) => s.mode);
  const narrationOverrides = useReviewStore((s) => s.narrationOverrides);
  const setNarrationOverride = useReviewStore((s) => (s as any).setNarrationOverride) as (
    key: string,
    text: string,
  ) => void;
  const clearNarrationOverride = useReviewStore((s) => (s as any).clearNarrationOverride) as (key: string) => void;

  const [renarrating, setRenarrating] = useState(false);
  const [activeLens, setActiveLens] = useState<PerspectiveLens | null>(null);
  const [renarrateError, setRenarrateError] = useState<string | null>(null);
  const hasOverrideInStore = chapterKey in narrationOverrides;

  const [askOpen, setAskOpen] = useState(false);
  const [askPrompt, setAskPrompt] = useState('');
  const [askLoading, setAskLoading] = useState(false);
  const [askResponse, setAskResponse] = useState<string | null>(null);
  const [askError, setAskError] = useState<string | null>(null);

  const [commentOpen, setCommentOpen] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [commentSubmitting, setCommentSubmitting] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);

  const { postComment } = useComments();

  async function runRenarrate(lens: string) {
    if (renarrating) return;
    setRenarrating(true);
    setRenarrateError(null);
    try {
      const text = await callAi({ action: 'renarrate', chapterIndex, lens });
      setNarrationOverride(chapterKey, text);
    } catch (err) {
      setRenarrateError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setRenarrating(false);
    }
  }

  async function handleRenarrate() {
    if (renarrating) return;
    // Cycle: null -> security -> performance -> API consumer -> null
    const idx = activeLens === null ? 0 : LENS_CYCLE.indexOf(activeLens) + 1;
    const next: PerspectiveLens | null = idx >= LENS_CYCLE.length ? null : (LENS_CYCLE[idx] ?? null);
    setActiveLens(next);
    if (next === null) {
      clearNarrationOverride(chapterKey);
      setRenarrateError(null);
      return;
    }
    await runRenarrate(next);
  }

  function handleRestoreDefault() {
    setActiveLens(null);
    clearNarrationOverride(chapterKey);
    setRenarrateError(null);
  }

  async function handleDensityChange(d: Density) {
    setChapterDensity(chapterKey, d);
    // Re-narrate at the requested density via the AI endpoint.
    setActiveLens(null);
    await runRenarrate(d);
  }

  async function submitAsk() {
    const trimmed = askPrompt.trim();
    if (!trimmed || askLoading) return;
    setAskLoading(true);
    setAskResponse(null);
    setAskError(null);
    try {
      const text = await callAi({
        action: 'ask',
        chapterIndex,
        question: trimmed,
      });
      setAskResponse(text);
    } catch (err) {
      setAskError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setAskLoading(false);
    }
  }

  function onAskKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void submitAsk();
    }
  }

  function closeAsk() {
    setAskOpen(false);
    setAskPrompt('');
    setAskResponse(null);
    setAskError(null);
  }

  async function submitComment() {
    const trimmed = commentBody.trim();
    if (!trimmed || commentSubmitting) return;
    setCommentSubmitting(true);
    setCommentError(null);
    try {
      const body = `[diff.dad: Chapter ${chapterIndex + 1}] ${trimmed}`;
      await postComment(body);
      setCommentBody('');
      setCommentOpen(false);
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : 'Failed to post');
    } finally {
      setCommentSubmitting(false);
    }
  }

  function onCommentKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void submitComment();
    }
  }

  const hasOverride = hasOverrideInStore || activeLens !== null;

  return (
    <div className="ml-[34px] mt-1 mb-[14px]">
      {hasOverride && !renarrating && (
        <div
          className="mb-2 flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px]"
          style={{
            background: 'var(--purple-2)',
            border: '1px solid var(--purple-a4)',
            color: 'var(--purple-11)',
          }}
        >
          <span>
            {activeLens ? (
              <>
                Re-narrated for <b className="font-bold">{activeLens}</b> reviewers
              </>
            ) : (
              <>Narration regenerated</>
            )}
          </span>
          <button
            type="button"
            onClick={handleRestoreDefault}
            className="ml-auto bg-transparent text-[12px] font-medium underline underline-offset-2"
            style={{ color: 'var(--purple-11)' }}
          >
            Restore default
          </button>
        </div>
      )}

      {renarrateError && (
        <div className="mb-2 text-xs" style={{ color: 'var(--red-11)' }}>
          {renarrateError}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-[12px] font-medium text-[var(--fg-3)]">
        <div
          className="inline-flex items-center rounded-[4px] p-[1px]"
          style={{
            background: 'var(--gray-2)',
            boxShadow: 'inset 0 0 0 1px var(--gray-a4)',
          }}
        >
          {DENSITIES.map((d) => {
            const active = d === activeDensity;
            return (
              <button
                key={d}
                type="button"
                disabled={renarrating}
                onClick={() => void handleDensityChange(d)}
                className="rounded-[3px] px-[7px] py-0.5 text-[11px] font-medium capitalize transition-colors"
                style={
                  active
                    ? {
                        background: 'var(--bg-panel)',
                        color: 'var(--fg-1)',
                        boxShadow: '0 1px 1px rgba(3,2,13,0.05)',
                      }
                    : { color: 'var(--fg-3)' }
                }
              >
                {d}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => void handleRenarrate()}
          disabled={renarrating}
          className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-[3px] text-[12px] font-medium text-[var(--fg-3)] hover:bg-[var(--gray-a3)] hover:text-[var(--fg-2)] disabled:opacity-60"
        >
          <IconRefresh className="h-[11px] w-[11px]" />
          {renarrating ? 'Re-narrating...' : 'Re-narrate'}
        </button>

        <button
          type="button"
          onClick={() => setAskOpen((v) => !v)}
          className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-[3px] text-[12px] font-medium hover:bg-[var(--gray-a3)] hover:text-[var(--fg-2)]"
          style={askOpen ? { background: 'var(--brand-soft)', color: 'var(--brand)' } : { color: 'var(--fg-3)' }}
        >
          <IconSpark className="h-[11px] w-[11px]" />
          Ask AI
        </button>

        {mode !== 'watch' ? (
          <button
            type="button"
            onClick={() => setCommentOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-[3px] text-[12px] font-medium hover:bg-[var(--gray-a3)] hover:text-[var(--fg-2)]"
            style={commentOpen ? { background: 'var(--gray-a3)', color: 'var(--fg-1)' } : { color: 'var(--fg-3)' }}
          >
            <IconChat className="h-[11px] w-[11px]" />
            Comment on chapter
          </button>
        ) : null}
      </div>

      {askOpen && (
        <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-2">
          <textarea
            autoFocus
            value={askPrompt}
            onChange={(e) => setAskPrompt(e.target.value)}
            onKeyDown={onAskKeyDown}
            placeholder={copy.askAiPlaceholder}
            className="block w-full resize-y rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--fg-1)] outline-none focus:border-[var(--brand)]"
            rows={2}
          />
          {askLoading && (
            <div className="mt-2 rounded-md bg-[var(--bg-subtle)] p-2 text-sm text-[var(--fg-2)]">Thinking...</div>
          )}
          {askError && !askLoading && (
            <div className="mt-2 rounded-md bg-red-50 p-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
              {askError}
            </div>
          )}
          {askResponse && !askLoading && (
            <div className="mt-2 rounded-md bg-[var(--bg-subtle)] p-3 text-sm text-[var(--fg-1)]">
              <Markdown source={askResponse} />
            </div>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeAsk}
              aria-label="Close"
              className="inline-flex items-center justify-center rounded-md px-2 py-1 text-[var(--fg-2)] hover:bg-[var(--bg-subtle)] hover:text-[var(--fg-1)]"
            >
              <IconX className="h-4 w-4" />
            </button>
            <button
              type="button"
              disabled={!askPrompt.trim() || askLoading}
              onClick={() => void submitAsk()}
              className="rounded-md bg-[var(--brand)] px-3 py-1 text-sm font-semibold text-white shadow-sm hover:bg-[var(--brand-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {askLoading ? 'Asking...' : 'Ask'}
            </button>
          </div>
        </div>
      )}

      {commentOpen && (
        <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] p-2">
          <textarea
            autoFocus
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            onKeyDown={onCommentKeyDown}
            placeholder={`Comment on Chapter ${chapterIndex + 1}. Cmd/Ctrl+Enter to submit.`}
            className="block w-full resize-y rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--fg-1)] outline-none focus:border-[var(--brand)]"
            rows={3}
          />
          {commentError && <div className="mt-1 text-sm text-red-600 dark:text-red-400">{commentError}</div>}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setCommentBody('');
                setCommentOpen(false);
                setCommentError(null);
              }}
              className="rounded-md border border-[var(--border)] px-3 py-1 text-sm font-medium text-[var(--fg-1)] hover:bg-[var(--bg-subtle)]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!commentBody.trim() || commentSubmitting}
              onClick={() => void submitComment()}
              className="rounded-md bg-[var(--brand)] px-3 py-1 text-sm font-semibold text-white shadow-sm hover:bg-[var(--brand-hover)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {commentSubmitting ? 'Posting...' : 'Comment'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
