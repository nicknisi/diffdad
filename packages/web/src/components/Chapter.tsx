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
  low: "bg-[var(--bg-subtle)] text-[var(--fg-2)]",
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
          : "ml-auto rounded-md border border-[var(--border-strong)] bg-[var(--bg-panel)] px-3 py-1 text-sm font-medium text-[var(--fg-1)] shadow-sm hover:bg-[var(--bg-subtle)]"
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
      {chapter.reshow?.map((entry, i) => {
        const flat = flatHunks[entry.ref];
        if (!flat) return null;
        const ownerIdx = hunkOwners.get(entry.ref);
        const ownerLabel =
          ownerIdx !== undefined && ownerIdx !== index
            ? `Chapter ${ownerIdx + 1}`
            : "earlier";
        return (
          <div
            key={`reshow-${i}`}
            className="rounded-lg border border-dashed border-amber-300 bg-amber-50/40 p-3 dark:border-amber-700/60 dark:bg-amber-950/20"
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                <span aria-hidden>↻</span>
                Showing again from {ownerLabel}
              </span>
            </div>
            {entry.framing ? (
              <div className="mb-2">
                <NarrationBlock content={entry.framing} />
              </div>
            ) : null}
            <Hunk
              file={flat.file}
              hunk={flat.hunk}
              isNewFile={flat.isNewFile}
              hunkIndex={entry.ref}
              highlight={entry.highlight}
            />
          </div>
        );
      })}
    </div>
  );

  // OUTLINE STRUCTURE
  if (storyStructure === "outline") {
    const padding = compact ? "p-3" : "p-4";
    const margin = compact ? "mb-3" : "mb-4";
    return (
      <section
        data-chid={id}
        className={`${margin} rounded-2xl border border-[var(--border)] bg-[var(--bg-panel)] shadow-[var(--shadow-card)] ${reviewed ? "opacity-85" : ""}`}
      >
        <button
          type="button"
          onClick={() => setOutlineOpen((v) => !v)}
          aria-expanded={outlineOpen}
          className={`flex w-full items-center gap-3 ${padding} text-left`}
        >
          <span
            className={`flex h-5 w-5 flex-shrink-0 items-center justify-center text-[var(--fg-3)] transition-transform ${
              outlineOpen ? "rotate-90" : ""
            }`}
          >
            <IconChevron className="h-3.5 w-3.5" />
          </span>
          <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-[var(--fg-1)] font-mono text-[12px] font-bold text-[var(--bg-panel)]">
            {index + 1}
          </div>
          <h2 className="text-[18px] font-bold leading-6 tracking-[-0.01em] text-[var(--fg-1)]">
            {chapter.title}
          </h2>
          {riskPill}
          <span className="text-xs text-[var(--fg-3)]">
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
    const margin = compact ? "mb-5" : "mb-7";
    return (
      <section data-chid={id} className={margin}>
        <div className="mb-3 flex items-center gap-3">
          <hr className="w-8 flex-shrink-0 border-[var(--border-strong)]" />
          <div className="flex h-5 flex-shrink-0 items-center justify-center rounded-md bg-[var(--fg-1)] px-1.5 font-mono text-xs font-bold text-[var(--bg-panel)]">
            Ch {index + 1}
          </div>
          <h2 className="text-[18px] font-bold leading-6 tracking-[-0.01em] text-[var(--fg-1)]">
            {chapter.title}
          </h2>
          {riskPill}
          {reviewedButton}
        </div>
        <div className="border-t border-[var(--border)] pt-4">
          {body}
        </div>
      </section>
    );
  }

  // CHAPTERS (default)
  const padding = compact ? "p-5" : "p-7";
  const margin = compact ? "mb-4" : "mb-7";
  return (
    <section
      data-chid={id}
      className={`${margin} rounded-2xl border border-[var(--border)] bg-[var(--bg-panel)] ${padding} shadow-[var(--shadow-card)] ${reviewed ? "opacity-85" : ""}`}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[7px] bg-[var(--fg-1)] font-mono text-[12px] font-bold text-[var(--bg-panel)]">
          {index + 1}
        </div>
        <h2 className="text-[18px] font-bold leading-6 tracking-[-0.01em] text-[var(--fg-1)]">
          {chapter.title}
        </h2>
        {riskPill}
        {reviewedButton}
      </div>
      {body}
    </section>
  );
}
