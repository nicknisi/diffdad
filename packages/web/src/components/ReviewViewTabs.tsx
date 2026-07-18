import { useReviewStore } from '../state/review-store';

type Props = {
  showRecap?: boolean;
};

const baseBtn =
  'h-[26px] inline-flex items-center gap-1 px-2.5 text-[12.5px] font-medium rounded-[5px] transition-colors';
const activeBtn = 'bg-[var(--bg-panel)] text-[var(--fg-1)]';
const inactiveBtn = 'bg-transparent text-[var(--fg-2)] hover:text-[var(--fg-1)]';
const activeBtnStyle: React.CSSProperties = {
  boxShadow: '0 1px 2px rgba(3,2,13,0.06), inset 0 0 0 1px var(--gray-a5)',
};

export function ReviewViewTabs({ showRecap = true }: Props) {
  const view = useReviewStore((s) => s.view);
  const setView = useReviewStore((s) => s.setView);

  return (
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
      {showRecap && (
        <button
          type="button"
          role="tab"
          aria-selected={view === 'recap'}
          onClick={() => setView('recap')}
          className={`${baseBtn} ${view === 'recap' ? activeBtn : inactiveBtn}`}
          style={view === 'recap' ? activeBtnStyle : undefined}
          title="Goal, decisions, blockers — for landing on someone else's WIP"
        >
          Recap
        </button>
      )}
    </div>
  );
}
