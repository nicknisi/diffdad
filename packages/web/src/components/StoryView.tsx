import { useReviewStore } from "../state/review-store";
import { Chapter } from "./Chapter";
import { ChapterTOC } from "./ChapterTOC";
import { SuggestedStart } from "./SuggestedStart";

export function StoryView() {
  const narrative = useReviewStore((s) => s.narrative);
  if (!narrative) return null;

  return (
    <div className="mx-auto grid max-w-[1280px] grid-cols-[280px_1fr] gap-6 px-8 py-6">
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
