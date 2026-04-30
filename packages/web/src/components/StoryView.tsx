import { useReviewStore } from "../state/review-store";
import { Chapter } from "./Chapter";
import { ChapterTOC } from "./ChapterTOC";
import { SuggestedStart } from "./SuggestedStart";

export function StoryView() {
  const narrative = useReviewStore((s) => s.narrative);
  const layoutMode = useReviewStore((s) => s.layoutMode);
  const displayDensity = useReviewStore((s) => s.displayDensity);
  if (!narrative) return null;

  const compact = displayDensity === "compact";
  const padY = compact ? "py-4" : "py-6";

  if (layoutMode === "linear") {
    return (
      <div className={`mx-auto max-w-[1100px] px-5 ${padY}`}>
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
      className={`mx-auto grid max-w-[1600px] grid-cols-[280px_1fr] gap-5 px-5 ${padY}`}
    >
      <ChapterTOC />
      <main>
        <SuggestedStart />
        {narrative.chapters.map((ch, idx) => (
          <Chapter key={`ch-${idx}`} index={idx} chapter={ch} />
        ))}
      </main>
    </div>
  );
}
