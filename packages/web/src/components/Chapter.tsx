import { useMemo, useState } from "react";
import { useReviewStore } from "../state/review-store";
import type { Chapter as ChapterType, DiffFile, DiffHunk } from "../state/types";
import { Hunk } from "./Hunk";
import { IconCheck, IconChevron } from "./Icons";
import { NarrationAnchor } from "./NarrationAnchor";
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
  const comments = useReviewStore((s) => s.comments);
  const chapterStates = useReviewStore((s) => s.chapterStates);
  const toggleReviewed = useReviewStore((s) => s.toggleReviewed);
  const storyStructure = useReviewStore((s) => s.storyStructure);
  const displayDensity = useReviewStore((s) => s.displayDensity);
  const narrative = useReviewStore((s) => s.narrative);
  const id = `ch-${index}`;
  const reviewed = chapterStates[id] === "reviewed";

  const flatHunks = useMemo(() => flattenFiles(files), [files]);

  // Map of hunkIndex -> first chapter index that uses that hunk via a diff section
  const hunkOwners = useMemo(() => {
    const owners = new Map<number, number>();
    if (!narrative) return owners;
    narrative.chapters.forEach((ch, ci) => {
      ch.sections.forEach((s) => {
        if (s.type === "diff" && !owners.has(s.hunkIndex)) {
          owners.set(s.hunkIndex, ci);
        }
      });
    });
    return owners;
  }, [narrative]);

  // Outline: collapsed by default, except chapter 0
  const [outlineOpen, setOutlineOpen] = useState(index === 0);

  const compact = displayDensity === "compact";

  const hunkSections = useMemo(
    () => chapter.sections.filter((s) => s.type === "diff"),
    [chapter.sections],
  );
  const hunkCount = hunkSections.length;

  // Count comments belonging to this chapter's hunks (file + line range)
  const commentCount = useMemo(() => {
    let count = 0;
    for (const section of hunkSections) {
      if (section.type !== "diff") continue;
      const flat = flatHunks[section.hunkIndex];
      if (!flat) continue;
      const start = flat.hunk.newStart;
      const end = start + Math.max(flat.hunk.newCount - 1, 0);
      for (const c of comments) {
        if (c.path !== flat.file) continue;
        if (c.line === undefined) continue;
        if (c.line >= start && c.line <= end) count++;
      }
    }
    return count;
  }, [hunkSections, flatHunks, comments]);

  const riskPill = (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${RISK_STYLES[chapter.risk]}`}
    >
      {chapter.risk}
    </span>
  );

  const reviewedButton = (
    <button
      type="button"
      onClick={() => toggleReviewed(index)}
      className={
        reviewed
          ? "ml-auto inline-flex items-center gap-1 rounded-md bg-green-100 px-3 py-1 text-sm font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300"
          : "ml-auto rounded-md border border-gray-200 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-800 dark:text-gray-300 dark:hover:bg-gray-800"
      }
    >
      {reviewed ? (
        <>
          <IconCheck className="h-3.5 w-3.5" />
          Reviewed
        </>
      ) : (
        "Mark reviewed"
      )}
    </button>
  );

  const body = (
    <div className={compact ? "mt-3 space-y-3" : "mt-4 space-y-4"}>
      {chapter.sections.map((section, i) => {
        if (section.type === "narrative") {
          return (
            <div key={i}>
              <NarrationBlock content={section.content} />
              <NarrationAnchor chapterIndex={index} />
            </div>
          );
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
  );

  // OUTLINE STRUCTURE
  if (storyStructure === "outline") {
    const padding = compact ? "p-3" : "p-4";
    const margin = compact ? "mb-2" : "mb-3";
    return (
      <section
        data-chid={id}
        className={`${margin} rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900 ${reviewed ? "opacity-85" : ""}`}
      >
        <button
          type="button"
          onClick={() => setOutlineOpen((v) => !v)}
          aria-expanded={outlineOpen}
          className={`flex w-full items-center gap-3 ${padding} text-left`}
        >
          <span
            className={`flex h-5 w-5 flex-shrink-0 items-center justify-center text-gray-500 transition-transform dark:text-gray-400 ${
              outlineOpen ? "rotate-90" : ""
            }`}
          >
            <IconChevron className="h-3.5 w-3.5" />
          </span>
          <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-gray-900 font-mono text-sm font-bold text-white dark:bg-gray-200 dark:text-gray-900">
            {index + 1}
          </div>
          <h2 className="text-base font-bold tracking-[-0.01em] text-gray-900 dark:text-gray-50">
            {chapter.title}
          </h2>
          {riskPill}
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {hunkCount} {hunkCount === 1 ? "hunk" : "hunks"} · {commentCount}{" "}
            {commentCount === 1 ? "comment" : "comments"}
          </span>
        </button>
        {outlineOpen && <div className={`${padding} pt-0`}>{body}</div>}
      </section>
    );
  }

  // LINEAR STRUCTURE
  if (storyStructure === "linear") {
    const margin = compact ? "mb-4" : "mb-6";
    return (
      <section data-chid={id} className={margin}>
        <div className="mb-3 flex items-center gap-3">
          <hr className="w-8 flex-shrink-0 border-gray-300 dark:border-gray-700" />
          <div className="flex h-5 flex-shrink-0 items-center justify-center rounded-md bg-gray-900 px-1.5 font-mono text-xs font-bold text-white dark:bg-gray-200 dark:text-gray-900">
            Ch {index + 1}
          </div>
          <h2 className="text-lg font-bold tracking-[-0.01em] text-gray-900 dark:text-gray-50">
            {chapter.title}
          </h2>
          {riskPill}
          {reviewedButton}
        </div>
        <div className="border-t border-gray-200 pt-3 dark:border-gray-800">
          {body}
        </div>
      </section>
    );
  }

  // CHAPTERS (default)
  const padding = compact ? "p-4" : "p-6";
  const margin = compact ? "mb-2" : "mb-4";
  return (
    <section
      data-chid={id}
      className={`${margin} rounded-2xl border border-gray-200 bg-white ${padding} shadow-sm dark:border-gray-800 dark:bg-gray-900 ${reviewed ? "opacity-85" : ""}`}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-gray-900 font-mono text-sm font-bold text-white dark:bg-gray-200 dark:text-gray-900">
          {index + 1}
        </div>
        <h2 className="text-lg font-bold tracking-[-0.01em] text-gray-900 dark:text-gray-50">
          {chapter.title}
        </h2>
        {riskPill}
        {reviewedButton}
      </div>
      {body}
    </section>
  );
}
