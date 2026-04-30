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
      <div className="px-2.5 pb-2 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--fg-3)]">
        Story
      </div>
      <ul className="space-y-0.5">
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
                className={`relative flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors ${
                  active
                    ? "bg-[var(--brand-soft)] text-[var(--brand)]"
                    : "text-[var(--fg-2)] hover:bg-[var(--bg-subtle)] hover:text-[var(--fg-1)]"
                }`}
              >
                <div
                  className={`mt-px flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full font-mono text-[10.5px] font-bold ${
                    reviewed
                      ? "bg-green-600 text-white"
                      : active
                        ? "bg-[var(--brand)] text-white"
                        : "bg-[var(--bg-subtle)] text-[var(--fg-2)]"
                  }`}
                >
                  {reviewed ? (
                    <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2.5 6.5l2.5 2.5 4.5-5" />
                    </svg>
                  ) : (
                    idx + 1
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium leading-[17px]">
                    {ch.title}
                  </div>
                  <div className="text-[11.5px] leading-[14px] text-[var(--fg-3)] mt-0.5">
                    {hunkCount} {hunkCount === 1 ? "hunk" : "hunks"} · risk{" "}
                    {ch.risk}
                  </div>
                </div>
                {active && (
                  <span className="absolute right-2.5 top-3.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--brand)]" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
