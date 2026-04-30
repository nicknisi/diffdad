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
    <div className="mb-4 flex gap-3 rounded-xl border border-brand/30 bg-brand/5 p-4 dark:bg-brand/10">
      <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-brand text-white">
        <IconSpark className="h-4 w-4" />
      </div>
      <div className="flex-1">
        <p className="text-base leading-relaxed text-gray-800 dark:text-gray-200">
          <span className="font-semibold">Suggested place to start:</span>{" "}
          Chapter {chapter} —{" "}
          <span className="font-serif italic">{target.title}</span>. {reason}
        </p>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => scrollToChapter(chapter - 1)}
            className="rounded-md border border-brand/40 bg-white/60 px-3 py-1 text-sm font-medium text-brand hover:bg-white dark:bg-gray-900/60 dark:hover:bg-gray-900"
          >
            Jump to chapter {chapter}
          </button>
          <button
            type="button"
            onClick={() => scrollToChapter(0)}
            className="rounded-md border border-brand/40 bg-white/60 px-3 py-1 text-sm font-medium text-brand hover:bg-white dark:bg-gray-900/60 dark:hover:bg-gray-900"
          >
            Start from chapter 1
          </button>
        </div>
      </div>
    </div>
  );
}
