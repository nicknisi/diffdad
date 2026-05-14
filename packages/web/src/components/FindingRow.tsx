import { useMemo, useState, type KeyboardEvent } from 'react';
import { useComments } from '../hooks/useComments';
import { normalizePath } from '../lib/paths';
import type { Finding } from '../lib/findings';
import { useReviewStore } from '../state/review-store';
import type { Callout, ConcernCategory, DiffFile } from '../state/types';
import type { ConcernStatus } from '../state/types';
import { DeltaBadge } from './DeltaBadge';
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

const LEVEL_STYLES: Record<Callout['level'], { bg: string; color: string; label: string }> = {
  nit: { bg: 'var(--gray-3)', color: 'var(--fg-2)', label: 'Nit' },
  concern: { bg: 'var(--yellow-3)', color: 'var(--yellow-11)', label: 'Concern' },
  warning: { bg: 'var(--red-3)', color: 'var(--red-11)', label: 'Warning' },
};

export { CATEGORY_LABELS, CATEGORY_STYLES, LEVEL_STYLES };

function findHunkForLine(files: DiffFile[], file: string, line: number) {
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

type Props = {
  finding: Finding;
  onDismiss: () => void;
  dimmed?: boolean;
  deltaStatus?: ConcernStatus;
};

export function FindingRow({ finding, onDismiss, dimmed, deltaStatus }: Props) {
  const files = useReviewStore((s) => s.files);
  const addDraft = useReviewStore((s) => s.addDraft);
  const drafts = useReviewStore((s) => s.drafts);
  const setOpenLine = useReviewStore((s) => s.setOpenLine);
  const toggleRiskLevel = useReviewStore((s) => s.toggleRiskLevel);
  const selectedRiskLevels = useReviewStore((s) => s.selectedRiskLevels);
  const { postComment } = useComments();

  const [open, setOpen] = useState(false);
  const defaultBody =
    finding.kind === 'concern' ? finding.concern.question : finding.callout.message;
  const [body, setBody] = useState(defaultBody);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);
  const [drafted, setDrafted] = useState(false);

  const hunkRef = useMemo(
    () => findHunkForLine(files, finding.file, finding.line),
    [files, finding.file, finding.line],
  );

  const hasDraftForLine = useMemo(
    () => drafts.some((d) => d.path === finding.file && d.line === finding.line),
    [drafts, finding.file, finding.line],
  );

  function jumpToLine() {
    if (!hunkRef) return;
    if (
      finding.chapterIndex !== undefined &&
      finding.kind === 'callout'
    ) {
      const narrative = useReviewStore.getState().narrative;
      if (narrative) {
        const chapter = narrative.chapters[finding.chapterIndex];
        if (chapter && !selectedRiskLevels.has(chapter.risk)) {
          toggleRiskLevel(chapter.risk);
        }
      }
    }
    const lineKey = `${hunkRef.file}:${hunkRef.hunkIndex}:${hunkRef.lineIdx}`;
    setOpenLine(lineKey);
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
      await postComment(trimmed, { path: finding.file, line: finding.line, side: 'RIGHT' });
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
      id: `draft-finding-${finding.file}:${finding.line}-${Date.now()}`,
      body: trimmed,
      path: finding.file,
      line: finding.line,
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

  const badge =
    finding.kind === 'concern' ? (
      <span
        className="inline-flex flex-shrink-0 items-center rounded-full px-[7px] py-[2px] text-[10.5px] font-bold uppercase tracking-[0.06em]"
        style={{
          background: (CATEGORY_STYLES[finding.concern.category] ?? { bg: 'var(--gray-3)' }).bg,
          color: (CATEGORY_STYLES[finding.concern.category] ?? { color: 'var(--fg-2)' }).color,
        }}
      >
        {CATEGORY_LABELS[finding.concern.category] ?? finding.concern.category}
      </span>
    ) : (
      <span
        className="inline-flex flex-shrink-0 items-center rounded-full px-[7px] py-[2px] text-[10.5px] font-bold uppercase tracking-[0.06em]"
        style={{
          background: (LEVEL_STYLES[finding.callout.level] ?? { bg: 'var(--gray-3)' }).bg,
          color: (LEVEL_STYLES[finding.callout.level] ?? { color: 'var(--fg-2)' }).color,
        }}
      >
        {(LEVEL_STYLES[finding.callout.level] ?? { label: finding.callout.level }).label}
      </span>
    );

  const text = finding.kind === 'concern' ? finding.concern.question : finding.callout.message;
  const why = finding.kind === 'concern' ? finding.concern.why : undefined;

  return (
    <li
      className="flex flex-col gap-1.5 rounded-[8px] px-3.5 py-3 transition-opacity"
      style={{
        background: 'var(--bg-panel)',
        boxShadow: 'inset 0 0 0 1px var(--gray-a5)',
        opacity: dimmed ? 0.45 : deltaStatus === 'fixed' ? 0.45 : 1,
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        {badge}
        <DeltaBadge status={deltaStatus} />
        <button
          type="button"
          onClick={jumpToLine}
          disabled={!hunkRef}
          className="font-mono text-[11.5px] text-[var(--fg-3)] transition-colors enabled:hover:text-[var(--brand)] disabled:cursor-default"
          title={hunkRef ? 'Jump to line' : 'Line not found in diff'}
        >
          {finding.file}:{finding.line}
        </button>
        {finding.chapterIndex !== undefined && (
          <span className="text-[10.5px] text-[var(--fg-3)]">Ch {finding.chapterIndex + 1}</span>
        )}
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
            title="Dismiss"
            aria-label="Dismiss"
            className="inline-flex items-center justify-center rounded-[4px] p-1 text-[var(--fg-3)] hover:bg-[var(--gray-a3)] hover:text-[var(--fg-1)]"
          >
            <IconX className="h-[11px] w-[11px]" />
          </button>
        </span>
      </div>
      <div
        className="text-[14px] font-medium leading-[20px] text-[var(--fg-1)]"
        style={deltaStatus === 'fixed' ? { textDecoration: 'line-through' } : undefined}
      >
        {text}
      </div>
      {why ? <div className="text-[12.5px] leading-[18px] text-[var(--fg-3)]">{why}</div> : null}
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
                {finding.file}:{finding.line}
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
