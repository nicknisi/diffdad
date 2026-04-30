import { useReviewStore } from "../state/review-store";
import { IconSpark } from "./Icons";

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
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="mb-6 flex items-start gap-2.5 rounded-[10px] border border-brand/30 bg-brand/5 p-4 dark:bg-brand/10">
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[7px] bg-brand text-white shadow-sm">
        <IconSpark className="h-3.5 w-3.5" />
      </div>
      <div className="flex-1 text-[13.5px] leading-[19px] text-[var(--fg-1)]">
        <span className="font-bold">Suggested place to start:</span> Chapter{" "}
        {chapter} —{" "}
        <span className="font-serif italic">{target.title}</span>. {reason}
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => scrollToChapter(chapter - 1)}
            className="inline-flex h-6 items-center rounded-[5px] border border-brand/30 bg-white/70 px-2 text-[11.5px] font-bold text-brand hover:bg-white dark:bg-[var(--bg-panel)]/70 dark:hover:bg-[var(--bg-panel)]"
          >
            Jump to chapter {chapter}
          </button>
          <button
            type="button"
            onClick={() => scrollToChapter(0)}
            className="inline-flex h-6 items-center rounded-[5px] border border-brand/30 bg-white/70 px-2 text-[11.5px] font-bold text-brand hover:bg-white dark:bg-[var(--bg-panel)]/70 dark:hover:bg-[var(--bg-panel)]"
          >
            Start from chapter 1
          </button>
        </div>
      </div>
    </div>
  );
}
