import { useMemo } from 'react';
import { useReviewStore } from '../state/review-store';
import { buildWalkthrough } from '../lib/walkthrough';
import { SEVERITY } from '../lib/severity';

/**
 * The walkthrough's beat rail (evolves ChapterTOC). Reads the derived walkthrough model:
 * lists beats, tracks the active one (reusing the `activeChapterId` + `[data-chid]` contract),
 * carries a per-beat risk flag (⚠) or reviewed check (✓), and a header "N to resolve" count
 * that reflects which resolve items the reviewer has already cleared.
 */
export function BeatRail() {
  const narrative = useReviewStore((s) => s.narrative);
  const files = useReviewStore((s) => s.files);
  const resolved = useReviewStore((s) => s.resolved);
  const activeChapterId = useReviewStore((s) => s.activeChapterId);
  const chapterStates = useReviewStore((s) => s.chapterStates);
  const setActiveChapter = useReviewStore((s) => s.setActiveChapter);
  const setRailCollapsed = useReviewStore((s) => s.setRailCollapsed);

  const walkthrough = useMemo(() => (narrative ? buildWalkthrough(narrative, files) : null), [narrative, files]);

  const toResolve = useMemo(() => {
    if (!walkthrough) return 0;
    let n = 0;
    for (const beat of walkthrough.beats) {
      for (const item of beat.resolve) if (!resolved[item.id]) n++;
    }
    return n;
  }, [walkthrough, resolved]);

  if (!walkthrough) return null;
  const beats = walkthrough.beats;

  function jump(id: string) {
    setActiveChapter(id);
    const el = document.querySelector(`[data-chid="${id}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <aside className="sticky top-[160px] self-start text-[13px] text-[var(--fg-2)]">
      <div className="flex items-center justify-between gap-2 px-2.5 pb-[3px]">
        <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--fg-3)]">Walkthrough</span>
        <button
          type="button"
          onClick={() => setRailCollapsed(true)}
          title="Collapse walkthrough"
          aria-label="Collapse walkthrough"
          className="-mr-1 flex h-6 w-6 items-center justify-center rounded-md text-[13px] leading-none text-[var(--fg-3)] transition-colors hover:bg-[var(--gray-a3)] hover:text-[var(--fg-1)]"
        >
          «
        </button>
      </div>
      <div className="px-2.5 pb-2 text-[11.5px] text-[var(--fg-3)]">
        {beats.length} {beats.length === 1 ? 'beat' : 'beats'}
        {toResolve > 0 && (
          <>
            {' · '}
            <span className="font-semibold" style={{ color: 'var(--amber-11)' }}>
              {toResolve} to resolve
            </span>
          </>
        )}
      </div>
      <ul className="m-0 list-none p-0">
        {beats.map((beat) => {
          const id = beat.id;
          const reviewed = chapterStates[id] === 'reviewed';
          const active = activeChapterId === id;
          const flag = beat.risk !== 'none' ? SEVERITY[beat.risk] : null;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => jump(id)}
                className="flex w-full cursor-pointer items-center gap-2.5 py-[8px] pl-2 pr-2.5 text-left transition-colors"
                style={{
                  borderLeft: `2px solid ${active ? 'var(--purple-9)' : 'transparent'}`,
                  background: active ? 'var(--purple-a3)' : undefined,
                  color: active ? 'var(--purple-11)' : undefined,
                  opacity: active ? 1 : 0.7,
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = 'var(--gray-a3)';
                    e.currentTarget.style.opacity = '1';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    e.currentTarget.style.background = '';
                    e.currentTarget.style.opacity = '0.7';
                  }
                }}
              >
                <span className="font-mono text-[11px] text-[var(--fg-3)]">
                  {beat.chapterIndex >= 0 ? beat.chapterIndex + 1 : '·'}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-[16px]">{beat.title}</span>
                {reviewed ? (
                  <span aria-label="reviewed" style={{ color: 'var(--green-11)' }}>
                    ✓
                  </span>
                ) : flag ? (
                  <span
                    aria-label={`${flag.label} — needs a look`}
                    title={`${flag.label}`}
                    style={{ color: flag.color }}
                  >
                    ⚠
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
