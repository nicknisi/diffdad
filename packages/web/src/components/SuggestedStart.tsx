import { useReviewStore } from '../state/review-store';
import { IconSpark } from './Icons';

export function SuggestedStart() {
  const narrative = useReviewStore((s) => s.narrative);
  const setActiveChapter = useReviewStore((s) => s.setActiveChapter);

  if (!narrative?.suggestedStart) return null;

  const { chapter, reason } = narrative.suggestedStart;
  const target = narrative.chapters[chapter - 1];
  if (!target) return null;

  function scrollToChapter(idx: number) {
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
      <div className="flex-1 text-[13.5px] leading-[19px]" style={{ color: 'var(--purple-12)' }}>
        <b className="font-bold">Suggested place to start:</b> Chapter {chapter} —{' '}
        <span className="font-serif italic">{target.title}</span>. {reason}
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => scrollToChapter(chapter - 1)}
            className="inline-flex h-6 cursor-pointer items-center rounded-[5px] px-2 text-[11.5px] font-bold transition-colors"
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
            Jump to chapter {chapter}
          </button>
          <button
            type="button"
            onClick={() => scrollToChapter(0)}
            className="inline-flex h-6 cursor-pointer items-center rounded-[5px] px-2 text-[11.5px] font-bold transition-colors"
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
            Start from chapter 1
          </button>
        </div>
      </div>
    </div>
  );
}
