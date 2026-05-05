import { useReviewStore } from '../state/review-store';

function timeAgo(iso: string | undefined | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, Date.now() - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  return `${mo}mo ago`;
}

export function WatchHeader() {
  const watch = useReviewStore((s) => s.watch);
  const pr = useReviewStore((s) => s.pr);
  const view = useReviewStore((s) => s.view);
  const setView = useReviewStore((s) => s.setView);

  if (!watch || !pr) return null;

  const baseBtn =
    'h-[26px] inline-flex items-center gap-1 px-2.5 text-[12.5px] font-medium rounded-[5px] transition-colors';
  const activeBtn = 'bg-[var(--bg-panel)] text-[var(--fg-1)]';
  const activeBtnStyle: React.CSSProperties = {
    boxShadow: '0 1px 2px rgba(3,2,13,0.06), inset 0 0 0 1px var(--gray-a5)',
  };
  const inactiveBtn = 'bg-transparent text-[var(--fg-2)] hover:text-[var(--fg-1)]';

  const isUnified = watch.selection.kind === 'unified';
  const isPending = watch.selection.kind === 'pending';
  const headTitle = isUnified
    ? `${watch.branch} → ${watch.base}`
    : isPending
      ? watch.branch
      : pr.title;

  return (
    <section
      className="sticky top-[52px] z-20 bg-[var(--bg-panel)] px-6 pt-[18px] pb-3.5"
      style={{ boxShadow: 'inset 0 -1px 0 var(--gray-a4)' }}
    >
      <div className="flex items-start gap-3">
        <h1 className="m-0 flex-1 text-[22px] font-bold leading-[27px] tracking-[-0.0125em] text-[var(--fg-1)]">
          <span className="mr-2 font-normal text-[var(--fg-3)]">watch</span>
          {headTitle}
        </h1>
        <div className="flex shrink-0 items-center gap-2">
          <div
            role="tablist"
            aria-label="View mode"
            className="inline-flex items-center rounded-[7px] bg-[var(--gray-2)] p-[2px]"
            style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a4)' }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={view === 'story'}
              onClick={() => setView('story')}
              className={`${baseBtn} ${view === 'story' ? activeBtn : inactiveBtn}`}
              style={view === 'story' ? activeBtnStyle : undefined}
            >
              Story
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'files'}
              onClick={() => setView('files')}
              className={`${baseBtn} ${view === 'files' ? activeBtn : inactiveBtn}`}
              style={view === 'files' ? activeBtnStyle : undefined}
            >
              Files
            </button>
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-[var(--fg-2)]">
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[11.5px] font-bold uppercase tracking-[0.04em]"
          style={{ background: 'var(--purple-3)', color: 'var(--purple-11)' }}
        >
          Watching
        </span>
        <span className="rounded-[4px] bg-[var(--gray-3)] px-[7px] py-[2px] font-mono text-[12.5px] text-[var(--fg-2)]">
          <b className="font-medium text-[var(--fg-1)]">{watch.branch}</b>{' '}
          <span className="text-[var(--fg-3)]">→</span>{' '}
          <b className="font-medium text-[var(--fg-1)]">{watch.base}</b>
        </span>
        <span className="text-[var(--fg-2)]">
          {watch.commits.length} {watch.commits.length === 1 ? 'commit' : 'commits'} ahead
        </span>
        {!isUnified && pr.headSha ? (
          <>
            <span className="text-[var(--fg-3)]">·</span>
            <span className="font-mono text-[12.5px] text-[var(--fg-2)]">{pr.headSha.slice(0, 7)}</span>
            <span className="text-[var(--fg-2)]">{timeAgo(pr.createdAt)}</span>
          </>
        ) : null}
        <span className="text-[var(--fg-3)]">·</span>
        <span>
          <span className="font-medium" style={{ color: 'var(--green-11)' }}>
            +{pr.additions}
          </span>{' '}
          <span className="font-medium" style={{ color: 'var(--red-11)' }}>
            −{pr.deletions}
          </span>{' '}
          <span className="text-[var(--fg-2)]">
            across {pr.changedFiles} {pr.changedFiles === 1 ? 'file' : 'files'}
          </span>
        </span>
      </div>
    </section>
  );
}
