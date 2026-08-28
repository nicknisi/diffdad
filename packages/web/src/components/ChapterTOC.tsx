import { useMemo, useState } from 'react';
import { normalizePath } from '../lib/paths';
import { activeTocEntry, buildTocEntries, reviewedProgress, type TocEntry } from '../lib/toc';
import { useReviewStore } from '../state/review-store';
import { useInlineComments } from '../hooks/useInlineComments';
import { IconChat } from './Icons';

const CheckIcon = () => (
  <svg
    viewBox="0 0 12 12"
    className="h-3 w-3"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2.5 6.5l2 2 4.5-5" />
  </svg>
);

function Badge({ entry }: { entry: TocEntry }) {
  const active = useReviewStore((s) => s.activeChapterId) === entry.id;
  const style = entry.reviewed
    ? { background: 'var(--green-9)', color: '#fff' }
    : active
      ? { background: 'var(--purple-9)', color: '#fff' }
      : { background: 'var(--gray-3)', color: 'var(--fg-2)' };
  return (
    <span
      className="mt-[1px] inline-flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full font-mono text-[10.5px] font-bold"
      style={style}
    >
      {entry.reviewed ? (
        <CheckIcon />
      ) : entry.kind === 'discussion' ? (
        <IconChat className="h-[10px] w-[10px]" />
      ) : (
        entry.number
      )}
    </span>
  );
}

function subtitle(entry: TocEntry): string {
  if (entry.kind === 'discussion') {
    return `${entry.commentCount} ${entry.commentCount === 1 ? 'comment' : 'comments'}`;
  }
  let s = `${entry.hunkCount} ${entry.hunkCount === 1 ? 'hunk' : 'hunks'}`;
  if (entry.risk) s += ` · risk ${entry.risk}`;
  if (entry.commentCount > 0) s += ` · ${entry.commentCount} ${entry.commentCount === 1 ? 'comment' : 'comments'}`;
  return s;
}

export function ChapterTOC() {
  const narrative = useReviewStore((s) => s.narrative);
  const comments = useInlineComments();
  const files = useReviewStore((s) => s.files);
  const activeChapterId = useReviewStore((s) => s.activeChapterId);
  const chapterStates = useReviewStore((s) => s.chapterStates);
  const railCollapsed = useReviewStore((s) => s.railCollapsed);
  const setRailCollapsed = useReviewStore((s) => s.setRailCollapsed);
  const setActiveChapter = useReviewStore((s) => s.setActiveChapter);
  const revealChapter = useReviewStore((s) => s.revealChapter);

  const [pillOpen, setPillOpen] = useState(false);

  const chapterCommentCounts = useMemo(() => {
    if (!narrative) return {};
    const counts: Record<string, number> = {};
    narrative.chapters.forEach((ch, idx) => {
      let count = 0;
      for (const section of ch.sections) {
        if (section.type !== 'diff') continue;
        const normFile = normalizePath(section.file);
        const diffFile = files.find((f) => normalizePath(f.file) === normFile);
        if (!diffFile) continue;
        const hunk = diffFile.hunks[section.hunkIndex];
        if (!hunk) continue;
        const start = hunk.newStart;
        const end = start + Math.max(hunk.newCount - 1, 0);
        for (const c of comments) {
          if (!c.path || c.line === undefined) continue;
          if (normalizePath(c.path) !== normFile) continue;
          if (c.line >= start && c.line <= end) count++;
        }
      }
      counts[`ch-${idx}`] = count;
    });
    return counts;
  }, [narrative, comments, files]);

  const discussionCount = useMemo(() => comments.filter((c) => !c.path).length, [comments]);

  const entries = useMemo(
    () =>
      buildTocEntries({
        chapters: narrative?.chapters ?? [],
        chapterStates,
        commentCounts: chapterCommentCounts,
        discussionCount,
      }),
    [narrative, chapterStates, chapterCommentCounts, discussionCount],
  );

  const { reviewed: reviewedCount, total: totalCount } = reviewedProgress(entries);
  const current = activeTocEntry(entries, activeChapterId);

  if (!narrative) return null;

  // Open the chapter first (it may be collapsed), then scroll on the next frame so the target is laid
  // out before the browser measures it.
  function jump(id: string) {
    revealChapter(id);
    setActiveChapter(id);
    setPillOpen(false);
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-chid="${id}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function Row({ entry }: { entry: TocEntry }) {
    const active = activeChapterId === entry.id;
    return (
      <button
        type="button"
        onClick={() => jump(entry.id)}
        className={`relative flex w-full cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-[9px] text-left transition-colors ${
          active ? 'text-[var(--purple-11)]' : 'text-[var(--fg-2)]'
        }`}
        style={active ? { background: 'var(--purple-a3)' } : undefined}
        onMouseEnter={(e) => {
          if (!active) {
            e.currentTarget.style.background = 'var(--gray-a3)';
            e.currentTarget.style.color = 'var(--fg-1)';
          }
        }}
        onMouseLeave={(e) => {
          if (!active) {
            e.currentTarget.style.background = '';
            e.currentTarget.style.color = '';
          }
        }}
      >
        <Badge entry={entry} />
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium leading-[17px]">{entry.title}</div>
          <div className="mt-[2px] text-[11.5px] font-normal leading-[14px] text-[var(--fg-3)]">{subtitle(entry)}</div>
        </div>
        {active && (
          <span
            aria-hidden
            className="absolute right-2.5 top-[14px] h-1.5 w-1.5 flex-shrink-0 rounded-full"
            style={{ background: 'var(--purple-9)' }}
          />
        )}
      </button>
    );
  }

  return (
    <>
      {/* Wide viewport: the left rail. Hidden below `lg`, where the pill takes over. */}
      <aside className="hidden self-start text-[13px] text-[var(--fg-2)] lg:sticky lg:top-[160px] lg:block">
        {railCollapsed ? (
          <button
            type="button"
            onClick={() => setRailCollapsed(false)}
            title="Show story"
            aria-label="Show story"
            className="flex h-7 w-7 items-center justify-center rounded-md text-[14px] leading-none text-[var(--fg-3)] transition-colors hover:bg-[var(--gray-a3)] hover:text-[var(--fg-1)]"
            style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a4)' }}
          >
            »
          </button>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 px-2.5 pb-2">
              <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--fg-3)]">Story</span>
              <button
                type="button"
                onClick={() => setRailCollapsed(true)}
                title="Collapse story"
                aria-label="Collapse story"
                className="-mr-1 flex h-6 w-6 items-center justify-center rounded-md text-[13px] leading-none text-[var(--fg-3)] transition-colors hover:bg-[var(--gray-a3)] hover:text-[var(--fg-1)]"
              >
                «
              </button>
            </div>
            <ul className="m-0 list-none p-0">
              {entries.map((entry) => (
                <li key={entry.id}>
                  <Row entry={entry} />
                </li>
              ))}
            </ul>
            {reviewedCount > 0 && reviewedCount < totalCount && (
              <div className="mt-3 border-t px-2.5 pt-3" style={{ borderColor: 'var(--gray-a4)' }}>
                <div className="text-[11px] text-[var(--fg-3)]">
                  {reviewedCount}/{totalCount} chapters reviewed
                </div>
              </div>
            )}
          </>
        )}
      </aside>

      {/* Narrow viewport: a fixed breadcrumb pill naming the current section; tap to jump. */}
      {current && (
        <div className="lg:hidden">
          {pillOpen && (
            <button
              type="button"
              aria-label="Close story navigation"
              onClick={() => setPillOpen(false)}
              className="fixed inset-0 z-40 cursor-default"
              style={{ background: 'var(--gray-a8)' }}
            />
          )}
          <button
            type="button"
            onClick={() => setPillOpen((v) => !v)}
            aria-expanded={pillOpen}
            className="fixed bottom-4 left-4 z-50 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full px-3.5 py-2 text-left text-[13px] shadow-lg"
            style={{
              background: 'var(--bg-panel)',
              color: 'var(--fg-1)',
              boxShadow: '0 6px 20px var(--gray-a7), inset 0 0 0 1px var(--gray-a5)',
            }}
          >
            <Badge entry={current} />
            <span className="min-w-0 flex-1 truncate font-medium">{current.title}</span>
            <span
              aria-hidden
              className="text-[var(--fg-3)]"
              style={{ transform: pillOpen ? 'rotate(180deg)' : undefined }}
            >
              ▾
            </span>
          </button>
          {pillOpen && (
            <div
              className="fixed bottom-16 left-4 z-50 max-h-[60vh] w-[calc(100vw-2rem)] max-w-[320px] overflow-auto rounded-xl p-1.5"
              style={{
                background: 'var(--bg-panel)',
                boxShadow: '0 10px 30px var(--gray-a8), inset 0 0 0 1px var(--gray-a5)',
              }}
            >
              <ul className="m-0 list-none p-0">
                {entries.map((entry) => (
                  <li key={entry.id}>
                    <Row entry={entry} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );
}
