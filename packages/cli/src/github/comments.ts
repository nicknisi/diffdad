import type { NarrativeResponse } from "../narrative/types";
import type { PRComment } from "./types";

function normalizePath(p: string | undefined | null): string {
  if (!p) return "";
  return p.trim().replace(/^[ab]\//, "").replace(/^\/+/, "");
}

export type MappedComment = PRComment & {
  chapterIndices: number[];
  isNarrativeComment: boolean;
  narrativeChapter?: number;
};

const NARRATIVE_TAG_RE = /\[diff\.dad:\s*Chapter\s+(\d+)\]/i;

/**
 * Map each PR comment to the chapter(s) it belongs to.
 *
 * Rules:
 * - If the comment has no `path`/`line`, it's a top-level (issue) comment.
 *   We check the body for a `[diff.dad: Chapter N]` marker — if present,
 *   the comment is treated as a narrative comment for chapter N (1-based).
 * - If the comment has a `path`, it's an inline review comment. It is
 *   mapped to every chapter whose sections reference that file via a
 *   `diff` section.
 */
export function mapCommentsToChapters(
  comments: PRComment[],
  narrative: NarrativeResponse,
): MappedComment[] {
  // Build normalized path -> chapterIndices index from narrative diff sections.
  const pathToChapters = new Map<string, Set<number>>();
  narrative.chapters.forEach((chapter, idx) => {
    for (const section of chapter.sections) {
      if (section.type === "diff") {
        const norm = normalizePath(section.file);
        const set = pathToChapters.get(norm) ?? new Set<number>();
        set.add(idx);
        pathToChapters.set(norm, set);
      }
    }
  });

  return comments.map((c) => {
    if (!c.path) {
      const match = c.body.match(NARRATIVE_TAG_RE);
      if (match && match[1]) {
        const chapterNum = Number(match[1]);
        const idx = chapterNum - 1;
        const isValid = idx >= 0 && idx < narrative.chapters.length;
        return {
          ...c,
          chapterIndices: isValid ? [idx] : [],
          isNarrativeComment: true,
          narrativeChapter: chapterNum,
        };
      }
      return {
        ...c,
        chapterIndices: [],
        isNarrativeComment: false,
      };
    }

    const chapters = pathToChapters.get(normalizePath(c.path));
    return {
      ...c,
      chapterIndices: chapters ? [...chapters].sort((a, b) => a - b) : [],
      isNarrativeComment: false,
    };
  });
}
