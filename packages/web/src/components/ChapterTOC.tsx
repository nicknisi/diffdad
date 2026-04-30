import { useReviewStore } from "../state/review-store";

export function ChapterTOC() {
  const narrative = useReviewStore((s) => s.narrative);
  const activeChapterId = useReviewStore((s) => s.activeChapterId);
  const chapterStates = useReviewStore((s) => s.chapterStates);
  const setActiveChapter = useReviewStore((s) => s.setActiveChapter);

  if (!narrative) return null;

  function jump(id: string) {
    setActiveChapter(id);
    const el = document.querySelector(`[data-chid="${id}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <aside className="sticky top-16 self-start">
      <div className="px-2.5 pb-2 text-[11px] font-bold uppercase tracking-[0.06em] text-gray-400 dark:text-gray-500">
        Story
      </div>
      <ul className="space-y-1">
        {narrative.chapters.map((ch, idx) => {
          const id = `ch-${idx}`;
          const reviewed = chapterStates[id] === "reviewed";
          const active = activeChapterId === id;
          const hunkCount = ch.sections.filter((s) => s.type === "diff").length;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => jump(id)}
                className={`flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left ${
                  active
                    ? "bg-brand/10 text-brand"
                    : "text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                }`}
              >
                <div
                  className={`mt-0.5 flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full font-mono text-[10.5px] font-bold ${
                    reviewed
                      ? "bg-green-600 text-white"
                      : "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-200"
                  }`}
                >
                  {reviewed ? "✓" : idx + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium leading-[17px]">
                    {ch.title}
                  </div>
                  <div className="text-[11.5px] leading-[14px] text-gray-400 dark:text-gray-500">
                    {hunkCount} {hunkCount === 1 ? "hunk" : "hunks"} · risk{" "}
                    {ch.risk}
                  </div>
                </div>
                {active && (
                  <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-brand" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
