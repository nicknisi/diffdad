import { describe, expect, it } from 'vitest';
import type { Chapter } from '../../state/types';
import { activeTocEntry, buildTocEntries, reviewedProgress } from '../../lib/toc';

function chapter(title: string, hunks: number, risk: Chapter['risk'] = 'low'): Pick<Chapter, 'title' | 'risk' | 'sections'> {
  return {
    title,
    risk,
    sections: Array.from({ length: hunks }, (_, i) => ({
      type: 'diff' as const,
      file: `src/${title}.ts`,
      startLine: 1,
      endLine: 10,
      hunkIndex: i,
    })),
  };
}

const chapters = [chapter('alpha', 2), chapter('beta', 0, 'high'), chapter('gamma', 1)];

describe('buildTocEntries', () => {
  it('numbers chapters from 1 in source order', () => {
    const entries = buildTocEntries({ chapters, chapterStates: {}, commentCounts: {}, discussionCount: 0 });
    expect(entries.map((e) => [e.id, e.number, e.title])).toEqual([
      ['ch-0', 1, 'alpha'],
      ['ch-1', 2, 'beta'],
      ['ch-2', 3, 'gamma'],
    ]);
  });

  it('counts diff hunks and carries reviewed state and risk', () => {
    const entries = buildTocEntries({
      chapters,
      chapterStates: { 'ch-0': 'reviewed', 'ch-1': 'reading' },
      commentCounts: { 'ch-2': 4 },
      discussionCount: 0,
    });
    expect(entries[0]).toMatchObject({ hunkCount: 2, reviewed: true, commentCount: 0 });
    expect(entries[1]).toMatchObject({ hunkCount: 0, reviewed: false, risk: 'high' });
    expect(entries[2]).toMatchObject({ hunkCount: 1, commentCount: 4 });
  });

  it('appends a discussion row only when there is discussion', () => {
    const none = buildTocEntries({ chapters, chapterStates: {}, commentCounts: {}, discussionCount: 0 });
    expect(none.some((e) => e.kind === 'discussion')).toBe(false);

    const some = buildTocEntries({ chapters, chapterStates: {}, commentCounts: {}, discussionCount: 3 });
    const disc = some.at(-1)!;
    expect(disc).toMatchObject({ id: 'discussion', kind: 'discussion', number: null, commentCount: 3 });
  });
});

describe('activeTocEntry', () => {
  const entries = buildTocEntries({ chapters, chapterStates: {}, commentCounts: {}, discussionCount: 2 });

  it('returns the entry matching the active id', () => {
    expect(activeTocEntry(entries, 'ch-1')?.id).toBe('ch-1');
    expect(activeTocEntry(entries, 'discussion')?.id).toBe('discussion');
  });

  it('falls back to the first entry when nothing is active or the id is unknown', () => {
    expect(activeTocEntry(entries, null)?.id).toBe('ch-0');
    expect(activeTocEntry(entries, 'ch-999')?.id).toBe('ch-0');
  });

  it('returns null for an empty toc', () => {
    expect(activeTocEntry([], 'ch-0')).toBeNull();
  });
});

describe('reviewedProgress', () => {
  it('counts reviewed chapters and ignores the discussion row', () => {
    const entries = buildTocEntries({
      chapters,
      chapterStates: { 'ch-0': 'reviewed', 'ch-2': 'reviewed' },
      commentCounts: {},
      discussionCount: 5,
    });
    expect(reviewedProgress(entries)).toEqual({ reviewed: 2, total: 3 });
  });
});
