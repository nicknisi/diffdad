import { useScrollTracker } from "../hooks/useScrollTracker";
import { useReviewStore } from "../state/review-store";
import { Chapter } from "./Chapter";
import { ChapterTOC } from "./ChapterTOC";
import { SuggestedStart } from "./SuggestedStart";

export function StoryView() {
  useScrollTracker();
  const narrative = useReviewStore((s) => s.narrative);
  const layoutMode = useReviewStore((s) => s.layoutMode);
  const displayDensity = useReviewStore((s) => s.displayDensity);
  if (!narrative) return null;

  const compact = displayDensity === "compact";
  const padY = compact ? "py-4" : "pt-[18px] pb-20";

  if (layoutMode === "linear") {
    return (
      <div className={`mx-auto max-w-[880px] px-6 ${padY}`}>
        <main>
          <SuggestedStart />
          {narrative.chapters.map((ch, idx) => (
            <Chapter key={`ch-${idx}`} index={idx} chapter={ch} />
          ))}
        </main>
      </div>
    );
  }

  return (
    <div
      className={`mx-auto grid max-w-[1100px] grid-cols-[220px_minmax(0,1fr)] gap-7 px-6 ${padY}`}
    >
      <ChapterTOC />
      <main className="min-w-0">
        <SuggestedStart />
        {narrative.chapters.map((ch, idx) => (
          <Chapter key={`ch-${idx}`} index={idx} chapter={ch} />
        ))}
      </main>
    </div>
  );
}
