import { useMemo } from "react";
import { useReviewStore } from "../state/review-store";
import type { Chapter as ChapterType, DiffFile, DiffHunk } from "../state/types";
import { Hunk } from "./Hunk";
import { NarrationBlock } from "./NarrationBlock";

type Props = {
  index: number;
  chapter: ChapterType;
};

const RISK_STYLES: Record<ChapterType["risk"], string> = {
  low: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  medium:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  high: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

type FlatHunk = { hunk: DiffHunk; file: string; isNewFile: boolean };

function flattenFiles(files: DiffFile[]): FlatHunk[] {
  return files.flatMap((f) =>
    f.hunks.map((h) => ({
      hunk: h,
      file: f.file,
      isNewFile: f.isNewFile,
    })),
  );
}

export function Chapter({ index, chapter }: Props) {
  const files = useReviewStore((s) => s.files);
  const chapterStates = useReviewStore((s) => s.chapterStates);
  const toggleReviewed = useReviewStore((s) => s.toggleReviewed);
  const id = `ch-${index}`;
  const reviewed = chapterStates[id] === "reviewed";

  const flatHunks = useMemo(() => flattenFiles(files), [files]);

  return (
    <section
      data-chid={id}
      className={`mb-4 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900 ${reviewed ? "opacity-85" : ""}`}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-gray-900 font-mono text-[12px] font-bold text-white dark:bg-gray-200 dark:text-gray-900">
          {index + 1}
        </div>
        <h2 className="text-lg font-bold tracking-[-0.01em] text-gray-900 dark:text-gray-50">
          {chapter.title}
        </h2>
        <span
          className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wider ${RISK_STYLES[chapter.risk]}`}
        >
          {chapter.risk}
        </span>
        <button
          type="button"
          onClick={() => toggleReviewed(index)}
          className={
            reviewed
              ? "ml-auto rounded-md bg-green-100 px-3 py-1 text-[12px] font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300"
              : "ml-auto rounded-md border border-gray-200 px-3 py-1 text-[12px] font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800"
          }
        >
          {reviewed ? "✓ Reviewed" : "Mark reviewed"}
        </button>
      </div>

      <div className="mt-4 space-y-4">
        {chapter.sections.map((section, i) => {
          if (section.type === "narrative") {
            return <NarrationBlock key={i} content={section.content} />;
          }
          const flat = flatHunks[section.hunkIndex];
          if (!flat) return null;
          return (
            <Hunk
              key={i}
              file={flat.file}
              hunk={flat.hunk}
              isNewFile={flat.isNewFile}
              hunkIndex={section.hunkIndex}
            />
          );
        })}
      </div>
    </section>
  );
}
