import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { useComments } from '../hooks/useComments';
import { normalizePath } from '../lib/paths';
import { useReviewStore } from '../state/review-store';
import type { Concern, ConcernCategory, DiffFile } from '../state/types';
import { IconChat, IconCheck, IconX } from './Icons';

const CATEGORY_LABELS: Record<ConcernCategory, string> = {
  logic: 'Logic',
  state: 'State',
  timing: 'Timing',
  validation: 'Validation',
  security: 'Security',
  'test-gap': 'Test gap',
  'api-contract': 'API contract',
  'error-handling': 'Error handling',
};

const CATEGORY_STYLES: Record<ConcernCategory, { bg: string; color: string }> = {
  logic: { bg: 'var(--blue-3)', color: 'var(--blue-11)' },
  state: { bg: 'var(--purple-3)', color: 'var(--purple-11)' },
  timing: { bg: 'var(--cyan-3)', color: 'var(--cyan-11)' },
  validation: { bg: 'var(--amber-3)', color: 'var(--amber-11)' },
  security: { bg: 'var(--red-3)', color: 'var(--red-11)' },
  'test-gap': { bg: 'var(--yellow-3)', color: 'var(--yellow-11)' },
  'api-contract': { bg: 'var(--violet-3)', color: 'var(--violet-11)' },
  'error-handling': { bg: 'var(--orange-3)', color: 'var(--orange-11)' },
};

function CategoryBadge({ category }: { category: ConcernCategory }) {
  const label = CATEGORY_LABELS[category] ?? category;
  const style = CATEGORY_STYLES[category] ?? { bg: 'var(--gray-3)', color: 'var(--fg-2)' };
  return (
    <span
      className="inline-flex flex-shrink-0 items-center rounded-full px-[7px] py-[2px] text-[10.5px] font-bold uppercase tracking-[0.06em]"
      style={{ background: style.bg, color: style.color }}
    >
      {label}
    </span>
  );
}

function dismissedKey(prNumber: number | undefined): string | null {
  if (prNumber == null) return null;
  return `diffdad.concernsDismissed.${prNumber}`;
}

function loadDismissed(prNumber: number | undefined): Set<string> {
  const key = dismissedKey(prNumber);
  if (!key) return new Set();
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return new Set(arr.filter((x): x is string => typeof x === 'string'));
    }
  } catch {}
  return new Set();
}

function saveDismissed(prNumber: number | undefined, set: Set<string>) {
  const key = dismissedKey(prNumber);
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify([...set]));
  } catch {}
}

function concernKey(c: Concern): string {
  return `${c.file}:${c.line}:${c.question.slice(0, 80)}`;
}

function findHunkForConcern(files: DiffFile[], file: string, line: number) {
  const norm = normalizePath(file);
  const diffFile = files.find((f) => normalizePath(f.file) === norm);
  if (!diffFile) return null;
  for (let i = 0; i < diffFile.hunks.length; i++) {
    const h = diffFile.hunks[i]!;
    const start = h.newStart;
    const end = start + Math.max(h.newCount - 1, 0);
    if (line >= start && line <= end) {
      const lineIdx = h.lines.findIndex((l) => l.lineNumber.new === line);
      return { file: diffFile.file, hunkIndex: i, lineIdx: lineIdx >= 0 ? lineIdx : 0 };
    }
  }
  return null;
}

function ConcernRow({ concern, onDismiss }: { concern: Concern; onDismiss: () => void }) {
  const files = useReviewStore((s) => s.files);
  const addDraft = useReviewStore((s) => s.addDraft);
  const drafts = useReviewStore((s) => s.drafts);
  const setOpenLine = useReviewStore((s) => s.setOpenLine);
  const { postComment } = useComments();

  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(`${concern.question}`);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);
  const [drafted, setDrafted] = useState(false);

  const hunkRef = useMemo(
    () => findHunkForConcern(files, concern.file, concern.line),
    [files, concern.file, concern.line],
  );

  const draftKey = `${concern.file}:${concern.line}`;
  const hasDraftForLine = useMemo(
    () => drafts.some((d) => d.path === concern.file && d.line === concern.line),
    [drafts, concern.file, concern.line],
  );

  function jumpToLine() {
    if (!hunkRef) return;
    const lineKey = `${hunkRef.file}:${hunkRef.hunkIndex}:${hunkRef.lineIdx}`;
    setOpenLine(lineKey);
    // Defer scrolling so the thread mounts before we measure.
    requestAnimationFrame(() => {
      const lineEl = document.querySelector(`[data-line-key="${CSS.escape(lineKey)}"]`);
      if (lineEl) lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  async function handlePost() {
    if (submitting) return;
    const trimmed = body.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setError(null);
    try {
      await postComment(trimmed, { path: concern.file, line: concern.line, side: 'RIGHT' });
      setPosted(true);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post');
    } finally {
      setSubmitting(false);
    }
  }

  function handleAddToReview() {
    const trimmed = body.trim();
    if (!trimmed) return;
    addDraft({
      id: `draft-concern-${draftKey}-${Date.now()}`,
      body: trimmed,
      path: concern.file,
      line: concern.line,
      side: 'RIGHT',
    });
    setDrafted(true);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void handlePost();
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <li
      className="flex flex-col gap-1.5 rounded-[8px] px-3.5 py-3"
      style={{ background: 'var(--bg-panel)', boxShadow: 'inset 0 0 0 1px var(--gray-a5)' }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <CategoryBadge category={concern.category} />
        <button
          type="button"
          onClick={jumpToLine}
          disabled={!hunkRef}
          className="font-mono text-[11.5px] text-[var(--fg-3)] transition-colors enabled:hover:text-[var(--brand)] disabled:cursor-default"
          title={hunkRef ? 'Jump to line' : 'Line not found in diff'}
        >
          {concern.file}:{concern.line}
        </button>
        <span className="ml-auto inline-flex items-center gap-1">
          {(posted || drafted) && (
            <span
              className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[10.5px] font-medium"
              style={{ background: 'var(--green-3)', color: 'var(--green-11)' }}
            >
              <IconCheck className="h-[10px] w-[10px]" />
              {posted ? 'Posted' : 'Added to review'}
            </span>
          )}
          {!posted && hasDraftForLine && !drafted && (
            <span
              className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[10.5px] font-medium"
              style={{ background: 'var(--gray-3)', color: 'var(--fg-2)' }}
            >
              draft on this line
            </span>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[11px] font-medium hover:bg-[var(--gray-a3)]"
            style={open ? { background: 'var(--gray-a3)', color: 'var(--fg-1)' } : { color: 'var(--fg-3)' }}
          >
            <IconChat className="h-[10px] w-[10px]" />
            {open ? 'Cancel' : 'Comment'}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            title="Dismiss this concern"
            aria-label="Dismiss"
            className="inline-flex items-center justify-center rounded-[4px] p-1 text-[var(--fg-3)] hover:bg-[var(--gray-a3)] hover:text-[var(--fg-1)]"
          >
            <IconX className="h-[11px] w-[11px]" />
          </button>
        </span>
      </div>
      <div className="text-[14px] font-medium leading-[20px] text-[var(--fg-1)]">{concern.question}</div>
      {concern.why ? <div className="text-[12.5px] leading-[18px] text-[var(--fg-3)]">{concern.why}</div> : null}
      {open && (
        <div className="mt-2 rounded-md border border-[var(--border)] bg-[var(--bg-panel)] p-2">
          <textarea
            autoFocus
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Write a comment..."
            className="block w-full resize-y rounded-md border border-[var(--border)] bg-transparent px-3 py-2 text-sm text-[var(--fg-1)] outline-none focus:border-[var(--brand)]"
            rows={3}
          />
          {error && <div className="mt-1 text-sm text-red-600 dark:text-red-400">{error}</div>}
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11px] text-[var(--fg-3)]">
              Will post inline at{' '}
              <span className="font-mono">
                {concern.file}:{concern.line}
              </span>
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={!body.trim()}
                onClick={handleAddToReview}
                className="rounded-md border border-[var(--border-strong)] bg-[var(--bg-panel)] px-3 py-1 text-sm font-medium text-[var(--fg-1)] shadow-sm hover:bg-[var(--bg-subtle)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add to review
              </button>
              <button
                type="button"
                disabled={!body.trim() || submitting}
                onClick={() => void handlePost()}
                className="rounded-md bg-[var(--brand)] px-3 py-1 text-sm font-semibold text-white shadow-sm hover:bg-[var(--brand-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? 'Posting...' : 'Post comment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

export function ConcernsList() {
  const narrative = useReviewStore((s) => s.narrative);
  const prNumber = useReviewStore((s) => s.pr?.number);
  const concerns = narrative?.concerns ?? [];

  const [dismissed, setDismissed] = useState<Set<string>>(() => loadDismissed(prNumber));
  const [showDismissed, setShowDismissed] = useState(false);

  useEffect(() => {
    setDismissed(loadDismissed(prNumber));
  }, [prNumber]);

  function dismiss(c: Concern) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(concernKey(c));
      saveDismissed(prNumber, next);
      return next;
    });
  }

  function undismissAll() {
    setDismissed(() => {
      const next = new Set<string>();
      saveDismissed(prNumber, next);
      return next;
    });
  }

  if (concerns.length === 0) return null;

  const visible = concerns.filter((c) => !dismissed.has(concernKey(c)));
  const dismissedCount = concerns.length - visible.length;
  const renderList = showDismissed ? concerns : visible;

  return (
    <section className="mb-[28px]">
      <div className="mb-[14px] flex items-start gap-2.5">
        <div
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[7px]"
          style={{ background: 'var(--amber-3)', color: 'var(--amber-11)' }}
        >
          <IconChat className="h-[12px] w-[12px]" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-[18px] font-bold leading-6 tracking-[-0.01em] text-[var(--fg-1)]">Things to check</h2>
          <p className="mt-[2px] text-[12.5px] text-[var(--fg-3)]">
            {visible.length} {visible.length === 1 ? 'question' : 'questions'} a careful reviewer would ask
            {dismissedCount > 0 && (
              <>
                {' · '}
                <button
                  type="button"
                  onClick={() => setShowDismissed((v) => !v)}
                  className="underline-offset-2 hover:text-[var(--fg-1)] hover:underline"
                >
                  {showDismissed ? 'Hide' : 'Show'} {dismissedCount} dismissed
                </button>
                {showDismissed && (
                  <>
                    {' · '}
                    <button
                      type="button"
                      onClick={undismissAll}
                      className="underline-offset-2 hover:text-[var(--fg-1)] hover:underline"
                    >
                      Restore all
                    </button>
                  </>
                )}
              </>
            )}
          </p>
        </div>
      </div>
      <ul className="ml-[34px] list-none space-y-2 p-0">
        {renderList.map((concern) => {
          const key = concernKey(concern);
          const isDismissed = dismissed.has(key);
          return (
            <div key={key} className="transition-opacity" style={{ opacity: isDismissed ? 0.45 : 1 }}>
              <ConcernRow concern={concern} onDismiss={() => dismiss(concern)} />
            </div>
          );
        })}
      </ul>
    </section>
  );
}
