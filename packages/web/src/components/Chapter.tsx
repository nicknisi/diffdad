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

const RISK_STYLES: Record<ChapterType["risk"], React.CSSProperties> = {
  low: { background: "var(--gray-3)", color: "var(--fg-2)" },
  medium: { background: "var(--yellow-3)", color: "var(--yellow-11)" },
  high: { background: "var(--red-3)", color: "var(--red-11)" },
};

const RISK_LABELS: Record<ChapterType["risk"], string> = {
  low: "low risk",
  medium: "medium risk",
  high: "high risk",
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
      className="inline-flex items-center rounded-full px-[7px] py-[2px] text-[10.5px] font-bold uppercase tracking-[0.06em]"
      style={RISK_STYLES[chapter.risk]}
    >
      {RISK_LABELS[chapter.risk]}
    </span>
  );

  const reviewedButton = (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggleReviewed(index);
      }}
      className="ml-auto inline-flex flex-shrink-0 cursor-pointer items-center gap-1.5 rounded-[5px] px-2 py-1 text-[12px] font-medium"
      style={
        reviewed
          ? {
              background: "var(--green-3)",
              color: "var(--green-11)",
              boxShadow: "inset 0 0 0 1px var(--green-a3)",
            }
          : {
              color: "var(--fg-2)",
              boxShadow: "inset 0 0 0 1px var(--gray-a5)",
            }
      }
    >
      {reviewed ? (
        <>
          <IconCheck className="h-[11px] w-[11px]" />
          Reviewed
        </>
      ) : (
        "Mark reviewed"
      )}
    </button>
  );

  const body = (
    <div className={compact ? "space-y-3" : "space-y-4"}>
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
            className="ml-[34px] mb-[14px] overflow-hidden rounded-[8px]"
            style={{
              boxShadow: "inset 0 0 0 1px var(--gray-a5)",
              borderLeft: "2px solid var(--purple-9)",
              background:
                "linear-gradient(180deg, var(--purple-2), transparent)",
            }}
          >
            <div
              className="px-4 pt-3.5 pb-3"
              style={{ borderBottom: "1px dashed var(--gray-a5)" }}
            >
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-[3px] text-[11px] font-medium tracking-[0.02em]"
                style={{
                  background: "var(--purple-3)",
                  color: "var(--purple-11)",
                  boxShadow: "inset 0 0 0 1px var(--purple-a5)",
                }}
              >
                <span aria-hidden>↻</span>
                Showing again from {ownerLabel}
              </span>
              {entry.framing ? (
                <div
                  className="mt-2 text-[14px] leading-[22px]"
                  style={{ color: "var(--fg-2)", maxWidth: "70ch" }}
                >
                  <NarrationBlock content={entry.framing} />
                </div>
              ) : null}
            </div>
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

  const badgeStyle: React.CSSProperties = reviewed
    ? { background: "var(--green-9)", color: "#fff" }
    : { background: "var(--gray-12)", color: "#fff" };

  // OUTLINE STRUCTURE
  if (storyStructure === "outline") {
    return (
      <section
        data-chid={id}
        className={compact ? "mb-[18px]" : "mb-[28px]"}
      >
        <button
          type="button"
          onClick={() => setOutlineOpen((v) => !v)}
          aria-expanded={outlineOpen}
          className="flex w-full cursor-pointer items-start gap-2.5 rounded-lg p-2 text-left hover:bg-[var(--gray-2)]"
        >
          <span
            className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center text-[var(--fg-3)] transition-transform ${
              outlineOpen ? "rotate-90" : ""
            }`}
          >
            <IconChevron className="h-3.5 w-3.5" />
          </span>
          <div
            className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[7px] font-mono text-[12px] font-bold"
            style={badgeStyle}
          >
            {index + 1}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="m-0 flex flex-wrap items-center gap-2 text-[18px] font-bold leading-6 tracking-[-0.01em] text-[var(--fg-1)]">
              <span>{chapter.title}</span>
              {riskPill}
            </h2>
            <span className="mt-[2px] block text-[12px] text-[var(--fg-3)]">
              {hunkCount} {hunkCount === 1 ? "hunk" : "hunks"} · {commentCount}{" "}
              {commentCount === 1 ? "comment" : "comments"}
            </span>
          </div>
        </button>
        {outlineOpen && <div className="mt-[14px]">{body}</div>}
      </section>
    );
  }

  // LINEAR STRUCTURE
  if (storyStructure === "linear") {
    return (
      <section data-chid={id} className={compact ? "mb-[18px]" : "mb-[32px]"}>
        <div className="mb-[16px] mt-[32px] grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <span className="h-px" style={{ background: "var(--gray-a4)" }} />
          <h2 className="m-0 inline-flex items-center gap-[10px] whitespace-nowrap text-[17px] font-semibold tracking-[-0.005em] text-[var(--fg-1)]">
            <span
              className="rounded-full px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--fg-3)]"
              style={{ background: "var(--gray-3)" }}
            >
              Ch {index + 1}
            </span>
            {chapter.title}
            <span
              className="font-mono text-[10.5px] uppercase tracking-[0.05em]"
              style={{
                color:
                  chapter.risk === "high"
                    ? "var(--red-11)"
                    : chapter.risk === "medium"
                      ? "var(--amber-11)"
                      : "var(--green-11)",
              }}
            >
              {chapter.risk}
            </span>
          </h2>
          <span className="h-px" style={{ background: "var(--gray-a4)" }} />
        </div>
        {body}
      </section>
    );
  }

  // CHAPTERS (default) — no card chrome, just spacing.
  return (
    <section
      data-chid={id}
      className={compact ? "mb-[18px]" : "mb-[28px]"}
    >
      <div className="mb-[14px] flex items-start gap-2.5">
        <div
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[7px] font-mono text-[12px] font-bold"
          style={badgeStyle}
        >
          {index + 1}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 flex flex-wrap items-center gap-2 text-[18px] font-bold leading-6 tracking-[-0.01em] text-[var(--fg-1)]">
            <span>{chapter.title}</span>
            {riskPill}
          </h2>
        </div>
        {reviewedButton}
      </div>
      {body}
    </section>
  );
}
