import type { Chapter } from '../state/types';

/**
 * A single row of the chapter table of contents. `chapter` rows carry a 1-based `number`; the
 * `discussion` row is unnumbered because it is not part of the narrated sequence.
 */
export interface TocEntry {
  id: string;
  kind: 'chapter' | 'discussion';
  number: number | null;
  title: string;
  reviewed: boolean;
  hunkCount: number;
  commentCount: number;
  risk: string | null;
}

/**
 * The TOC's data, derived once from the raw narrative rather than the DOM: chapters number from 1 in
 * source order, and the discussion row only appears when there is discussion to link to. Kept pure so
 * the numbering and the active-row lookup can be tested without a renderer.
 */
export function buildTocEntries(params: {
  chapters: Pick<Chapter, 'title' | 'risk' | 'sections'>[];
  chapterStates: Record<string, string>;
  commentCounts: Record<string, number>;
  discussionCount: number;
}): TocEntry[] {
  const { chapters, chapterStates, commentCounts, discussionCount } = params;
  const entries: TocEntry[] = chapters.map((ch, idx) => {
    const id = `ch-${idx}`;
    return {
      id,
      kind: 'chapter',
      number: idx + 1,
      title: ch.title,
      reviewed: chapterStates[id] === 'reviewed',
      hunkCount: ch.sections.filter((s) => s.type === 'diff').length,
      commentCount: commentCounts[id] ?? 0,
      risk: ch.risk ?? null,
    };
  });
  if (discussionCount > 0) {
    entries.push({
      id: 'discussion',
      kind: 'discussion',
      number: null,
      title: 'PR Discussion',
      reviewed: false,
      hunkCount: 0,
      commentCount: discussionCount,
      risk: null,
    });
  }
  return entries;
}

/**
 * The row the scroll-spy is pointing at, i.e. what the narrow-viewport pill names. Falls back to the
 * first entry so the pill always has a section to show once there is any content, even before the first
 * scroll event fires.
 */
export function activeTocEntry(entries: TocEntry[], activeChapterId: string | null): TocEntry | null {
  return entries.find((e) => e.id === activeChapterId) ?? entries[0] ?? null;
}

/** Reviewed / total across chapter rows only (the discussion row is never "reviewed"). */
export function reviewedProgress(entries: TocEntry[]): { reviewed: number; total: number } {
  const chapters = entries.filter((e) => e.kind === 'chapter');
  return { reviewed: chapters.filter((e) => e.reviewed).length, total: chapters.length };
}
