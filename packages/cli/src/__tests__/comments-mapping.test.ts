import { describe, expect, it } from 'vitest';
import { mapCommentsToChapters } from '../github/comments';
import type { NarrativeResponse } from '../narrative/types';
import type { PRComment } from '../github/types';

function mkNarrative(overrides: Partial<NarrativeResponse> = {}): NarrativeResponse {
  return {
    title: 't',
    tldr: '',
    verdict: 'safe',
    readingPlan: [],
    concerns: [],
    chapters: [
      {
        title: 'one',
        summary: 's',
        whyMatters: 'w',
        risk: 'low',
        sections: [{ type: 'diff', file: 'src/a.ts', startLine: 1, endLine: 5, hunkIndex: 0 }],
      },
      {
        title: 'two',
        summary: 's',
        whyMatters: 'w',
        risk: 'low',
        sections: [{ type: 'diff', file: 'src/b.ts', startLine: 1, endLine: 5, hunkIndex: 0 }],
      },
    ],
    ...overrides,
  };
}

function mkComment(over: Partial<PRComment> & { id: number; body?: string }): PRComment {
  return {
    id: over.id,
    author: 'alice',
    body: over.body ?? '',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    path: over.path,
    line: over.line,
  };
}

describe('mapCommentsToChapters', () => {
  it('maps inline comments to every chapter that references the file', () => {
    const narrative = mkNarrative({
      chapters: [
        {
          title: 'A',
          summary: '',
          whyMatters: '',
          risk: 'low',
          sections: [{ type: 'diff', file: 'src/a.ts', startLine: 1, endLine: 3, hunkIndex: 0 }],
        },
        {
          title: 'A again',
          summary: '',
          whyMatters: '',
          risk: 'low',
          sections: [{ type: 'diff', file: 'src/a.ts', startLine: 4, endLine: 7, hunkIndex: 1 }],
        },
        {
          title: 'B',
          summary: '',
          whyMatters: '',
          risk: 'low',
          sections: [{ type: 'diff', file: 'src/b.ts', startLine: 1, endLine: 3, hunkIndex: 0 }],
        },
      ],
    });
    const comments = [mkComment({ id: 1, path: 'src/a.ts', line: 2 })];
    const mapped = mapCommentsToChapters(comments, narrative);
    expect(mapped[0]?.chapterIndices).toEqual([0, 1]);
    expect(mapped[0]?.isNarrativeComment).toBe(false);
  });

  it('returns empty chapterIndices when an inline comment references an untouched file', () => {
    const narrative = mkNarrative();
    const comments = [mkComment({ id: 9, path: 'src/zzz.ts', line: 1 })];
    const mapped = mapCommentsToChapters(comments, narrative);
    expect(mapped[0]?.chapterIndices).toEqual([]);
    expect(mapped[0]?.isNarrativeComment).toBe(false);
  });

  it('normalizes a/ b/ prefixes when matching paths', () => {
    const narrative = mkNarrative({
      chapters: [
        {
          title: 'A',
          summary: '',
          whyMatters: '',
          risk: 'low',
          sections: [{ type: 'diff', file: 'b/src/a.ts', startLine: 1, endLine: 3, hunkIndex: 0 }],
        },
      ],
    });
    const mapped = mapCommentsToChapters([mkComment({ id: 1, path: 'a/src/a.ts', line: 2 })], narrative);
    expect(mapped[0]?.chapterIndices).toEqual([0]);
  });

  it('treats issue comments without a [diff.dad: Chapter N] tag as unattached', () => {
    const narrative = mkNarrative();
    const mapped = mapCommentsToChapters([mkComment({ id: 1, body: 'just a thought' })], narrative);
    expect(mapped[0]?.chapterIndices).toEqual([]);
    expect(mapped[0]?.isNarrativeComment).toBe(false);
    expect(mapped[0]?.narrativeChapter).toBeUndefined();
  });

  it('extracts narrative chapter from [diff.dad: Chapter N] tag (1-based)', () => {
    const narrative = mkNarrative();
    const mapped = mapCommentsToChapters(
      [mkComment({ id: 1, body: 'great chapter [diff.dad: Chapter 2]' })],
      narrative,
    );
    expect(mapped[0]?.isNarrativeComment).toBe(true);
    expect(mapped[0]?.narrativeChapter).toBe(2);
    expect(mapped[0]?.chapterIndices).toEqual([1]); // 0-based
  });

  it('clamps invalid chapter index in the tag to empty chapterIndices', () => {
    const narrative = mkNarrative(); // 2 chapters
    const mapped = mapCommentsToChapters([mkComment({ id: 1, body: '[diff.dad: Chapter 99]' })], narrative);
    expect(mapped[0]?.isNarrativeComment).toBe(true);
    expect(mapped[0]?.narrativeChapter).toBe(99);
    expect(mapped[0]?.chapterIndices).toEqual([]);
  });

  it('chapterIndices for inline matches are sorted ascending', () => {
    const narrative = mkNarrative({
      chapters: [
        {
          title: 'B',
          summary: '',
          whyMatters: '',
          risk: 'low',
          sections: [{ type: 'diff', file: 'src/b.ts', startLine: 1, endLine: 3, hunkIndex: 0 }],
        },
        {
          title: 'A',
          summary: '',
          whyMatters: '',
          risk: 'low',
          sections: [{ type: 'diff', file: 'src/x.ts', startLine: 1, endLine: 3, hunkIndex: 0 }],
        },
        {
          title: 'B again',
          summary: '',
          whyMatters: '',
          risk: 'low',
          sections: [{ type: 'diff', file: 'src/b.ts', startLine: 5, endLine: 7, hunkIndex: 1 }],
        },
      ],
    });
    const mapped = mapCommentsToChapters([mkComment({ id: 1, path: 'src/b.ts', line: 1 })], narrative);
    expect(mapped[0]?.chapterIndices).toEqual([0, 2]);
  });
});
