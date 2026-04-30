import { useMemo } from 'react';
import { normalizePath } from '../lib/paths';
import { useReviewStore } from '../state/review-store';

export function ChapterTOC() {
  const narrative = useReviewStore((s) => s.narrative);
  const comments = useReviewStore((s) => s.comments);
  const files = useReviewStore((s) => s.files);
  const activeChapterId = useReviewStore((s) => s.activeChapterId);
  const chapterStates = useReviewStore((s) => s.chapterStates);
  const setActiveChapter = useReviewStore((s) => s.setActiveChapter);

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

  const discussionCount = useMemo(() => {
    return comments.filter((c) => !c.path).length;
  }, [comments]);

  if (!narrative) return null;

  function jump(id: string) {
    setActiveChapter(id);
    const el = document.querySelector(`[data-chid="${id}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <aside className="sticky top-[160px] self-start text-[13px] text-[var(--fg-2)]">
      <div className="px-2.5 pb-2 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--fg-3)]">Story</div>
      <ul className="m-0 list-none p-0">
        {narrative.chapters.map((ch, idx) => {
          const id = `ch-${idx}`;
          const reviewed = chapterStates[id] === 'reviewed';
          const active = activeChapterId === id;
          const hunkCount = ch.sections.filter((s) => s.type === 'diff').length;
          const commentCount = chapterCommentCounts[id] ?? 0;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => jump(id)}
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
                <span
                  className="mt-[1px] inline-flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full font-mono text-[10.5px] font-bold"
                  style={
                    reviewed
                      ? { background: 'var(--green-9)', color: '#fff' }
                      : active
                        ? { background: 'var(--purple-9)', color: '#fff' }
                        : { background: 'var(--gray-3)', color: 'var(--fg-2)' }
                  }
                >
                  {reviewed ? (
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
                  ) : (
                    idx + 1
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium leading-[17px]">{ch.title}</div>
                  <div className="mt-[2px] text-[11.5px] leading-[14px] text-[var(--fg-3)]" style={{ fontWeight: 400 }}>
                    {hunkCount} {hunkCount === 1 ? 'hunk' : 'hunks'} · risk {ch.risk}
                    {commentCount > 0 && (
                      <>
                        {' '}
                        · {commentCount} {commentCount === 1 ? 'comment' : 'comments'}
                      </>
                    )}
                  </div>
                </div>
                {active && (
                  <span
                    aria-hidden
                    className="absolute right-2.5 top-[14px] h-1.5 w-1.5 flex-shrink-0 rounded-full"
                    style={{ background: 'var(--purple-9)' }}
                  />
                )}
              </button>
            </li>
          );
        })}
        {discussionCount > 0 && (
          <li>
            <button
              type="button"
              onClick={() => jump('discussion')}
              className={`relative flex w-full cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-[9px] text-left transition-colors ${
                activeChapterId === 'discussion' ? 'text-[var(--purple-11)]' : 'text-[var(--fg-2)]'
              }`}
              style={activeChapterId === 'discussion' ? { background: 'var(--purple-a3)' } : undefined}
              onMouseEnter={(e) => {
                if (activeChapterId !== 'discussion') {
                  e.currentTarget.style.background = 'var(--gray-a3)';
                  e.currentTarget.style.color = 'var(--fg-1)';
                }
              }}
              onMouseLeave={(e) => {
                if (activeChapterId !== 'discussion') {
                  e.currentTarget.style.background = '';
                  e.currentTarget.style.color = '';
                }
              }}
            >
              <span
                className="mt-[1px] inline-flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full font-mono text-[10.5px] font-bold"
                style={{ background: 'var(--gray-3)', color: 'var(--fg-2)' }}
              >
                <svg
                  viewBox="0 0 15 15"
                  className="h-[10px] w-[10px]"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M2 2h11v8H5l-3 3V2z" />
                </svg>
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium leading-[17px]">PR Discussion</div>
                <div className="mt-[2px] text-[11.5px] leading-[14px] text-[var(--fg-3)]" style={{ fontWeight: 400 }}>
                  {discussionCount} {discussionCount === 1 ? 'comment' : 'comments'}
                </div>
              </div>
            </button>
          </li>
        )}
      </ul>
    </aside>
  );
}
