import { useReviewStore } from '../state/review-store';
import { IconSpark } from './Icons';

export function ReadingPlan() {
  const narrative = useReviewStore((s) => s.narrative);
  const setActiveChapter = useReviewStore((s) => s.setActiveChapter);

  const plan = narrative?.readingPlan ?? [];
  if (plan.length === 0) return null;

  function jumpTo(idx: number) {
    const id = `ch-${idx}`;
    setActiveChapter(id);
    const el = document.querySelector(`[data-chid="${id}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div
      className="mb-6 flex items-start gap-2.5 rounded-[10px] px-4 py-3.5"
      style={{
        background: 'linear-gradient(180deg, var(--purple-2), var(--purple-3))',
        boxShadow: 'inset 0 0 0 1px var(--purple-a5)',
      }}
    >
      <div
        className="flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-[7px] text-white"
        style={{
          background: 'var(--purple-9)',
          boxShadow: '0 1px 2px rgba(3,2,13,0.10)',
        }}
      >
        <IconSpark className="h-[14px] w-[14px]" />
      </div>
      <div className="min-w-0 flex-1 text-[13.5px] leading-[19px]" style={{ color: 'var(--purple-12)' }}>
        <b className="font-bold">Reading plan</b>
        <ol className="mt-1.5 list-none space-y-1.5 p-0">
          {plan.map((step, i) => {
            const idx = step.chapterIndex;
            const canJump = typeof idx === 'number' && narrative?.chapters[idx];
            return (
              <li key={i} className="flex flex-wrap items-baseline gap-2">
                <span
                  className="inline-flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold"
                  style={{ background: 'var(--purple-a4)', color: 'var(--purple-12)' }}
                >
                  {i + 1}
                </span>
                <span className="flex-1 min-w-0">
                  <span>{step.step}</span>
                  {step.why ? (
                    <span className="ml-1 text-[12.5px]" style={{ color: 'var(--purple-11)' }}>
                      — {step.why}
                    </span>
                  ) : null}
                </span>
                {canJump ? (
                  <button
                    type="button"
                    onClick={() => jumpTo(idx!)}
                    className="inline-flex h-6 cursor-pointer items-center rounded-[5px] px-2 text-[11px] font-bold transition-colors"
                    style={{
                      background: 'var(--purple-a4)',
                      color: 'var(--purple-12)',
                      boxShadow: 'inset 0 0 0 1px var(--purple-a5)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = 'var(--purple-a5)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'var(--purple-a4)';
                    }}
                  >
                    Ch {idx! + 1}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
