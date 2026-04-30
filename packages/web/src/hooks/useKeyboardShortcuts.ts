import { useEffect } from "react";
import { useReviewStore } from "../state/review-store";

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

function getActiveIndex(activeChapterId: string | null): number {
  if (!activeChapterId) return 0;
  const m = /^ch-(\d+)$/.exec(activeChapterId);
  return m ? Number(m[1]) : 0;
}

function scrollToChapter(id: string) {
  const el = document.querySelector(`[data-chid="${id}"]`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function useKeyboardShortcuts() {
  const narrative = useReviewStore((s) => s.narrative);
  const files = useReviewStore((s) => s.files);
  const activeChapterId = useReviewStore((s) => s.activeChapterId);
  const setActiveChapter = useReviewStore((s) => s.setActiveChapter);
  const toggleReviewed = useReviewStore((s) => s.toggleReviewed);
  const setOpenLine = useReviewStore((s) => s.setOpenLine);
  const shortcutsHelpOpen = useReviewStore((s) => s.shortcutsHelpOpen);
  const setShortcutsHelpOpen = useReviewStore((s) => s.setShortcutsHelpOpen);
  const openLine = useReviewStore((s) => s.openLine);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const key = e.key;

      if (key === "Escape") {
        if (shortcutsHelpOpen) {
          e.preventDefault();
          setShortcutsHelpOpen(false);
          return;
        }
        if (openLine) {
          e.preventDefault();
          setOpenLine(null);
          return;
        }
        return;
      }

      if (key === "?") {
        e.preventDefault();
        setShortcutsHelpOpen(!shortcutsHelpOpen);
        return;
      }

      if (!narrative) return;
      const total = narrative.chapters.length;
      if (total === 0) return;

      const idx = getActiveIndex(activeChapterId);

      if (key === "j") {
        e.preventDefault();
        const next = Math.min(total - 1, idx + 1);
        const id = `ch-${next}`;
        setActiveChapter(id);
        scrollToChapter(id);
        return;
      }

      if (key === "k") {
        e.preventDefault();
        const prev = Math.max(0, idx - 1);
        const id = `ch-${prev}`;
        setActiveChapter(id);
        scrollToChapter(id);
        return;
      }

      if (key === "r") {
        e.preventDefault();
        toggleReviewed(idx);
        return;
      }

      if (key === "c") {
        e.preventDefault();
        const chapter = narrative.chapters[idx];
        if (!chapter) return;
        const firstDiff = chapter.sections.find((s) => s.type === "diff");
        if (!firstDiff || firstDiff.type !== "diff") return;

        // Look up the hunk by both file and hunkIndex — hunkIndex is per-file,
        // not a flat index across all files.
        const diffFile = files.find((f) => f.file === firstDiff.file);
        if (!diffFile) return;
        const hunk = diffFile.hunks[firstDiff.hunkIndex];
        if (!hunk) return;

        const lineIdx = hunk.lines.findIndex((l) => l.type !== "remove");
        const targetIdx = lineIdx >= 0 ? lineIdx : 0;
        const lineKey = `${diffFile.file}:${firstDiff.hunkIndex}:${targetIdx}`;
        setOpenLine(lineKey);
        return;
      }
    }

    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [
    narrative,
    files,
    activeChapterId,
    setActiveChapter,
    toggleReviewed,
    setOpenLine,
    shortcutsHelpOpen,
    setShortcutsHelpOpen,
    openLine,
  ]);
}
