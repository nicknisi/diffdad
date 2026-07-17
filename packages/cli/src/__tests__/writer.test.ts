import { describe, expect, it } from 'vitest';
import { buildSuppressedChapter, normalizeChapter, parseChapterResponse } from '../narrative/writer';
import type { PlanTheme } from '../narrative/plan-types';
import type { DiffFile, DiffHunk } from '../github/types';

const baseTheme: PlanTheme = {
  id: 'theme-0',
  title: 'Auth boundary',
  riskLevel: 'high',
  rationale: 'Moves the auth check from controller to middleware.',
  hunkRefs: [
    { file: 'src/auth.ts', hunkIndex: 0 },
    { file: 'src/middleware.ts', hunkIndex: 2 },
  ],
};

function hunk(o: Partial<DiffHunk> = {}): DiffHunk {
  return { header: '@@', oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, lines: [], ...o };
}

const themeFiles: DiffFile[] = [
  {
    file: 'src/auth.ts',
    isNewFile: false,
    isDeleted: false,
    hunks: [hunk({ newStart: 10, newCount: 8 })],
  },
  {
    file: 'src/middleware.ts',
    isNewFile: false,
    isDeleted: false,
    hunks: [hunk(), hunk(), hunk({ newStart: 30, newCount: 4 })],
  },
];

describe('normalizeChapter', () => {
  it('keeps narrative and valid diff sections, drops fabricated diff refs', () => {
    const out = normalizeChapter(
      {
        title: 'Auth boundary',
        summary: 's',
        whyMatters: 'w',
        risk: 'high',
        sections: [
          { type: 'narrative', content: 'hello' },
          { type: 'diff', file: 'src/auth.ts', hunkIndex: 0, startLine: 1, endLine: 5 },
          { type: 'diff', file: 'ghost.ts', hunkIndex: 0, startLine: 1, endLine: 1 }, // not in theme
          { type: 'diff', file: 'src/middleware.ts', hunkIndex: 2, startLine: 10, endLine: 12 },
        ],
      },
      baseTheme,
    );
    expect(out.sections).toHaveLength(3);
    expect(out.sections.filter((s) => s.type === 'diff')).toHaveLength(2);
    expect(out.themeId).toBe('theme-0');
  });

  it('falls back to theme.title when output title is empty', () => {
    const out = normalizeChapter({ title: '', sections: [] }, baseTheme);
    expect(out.title).toBe('Auth boundary');
  });

  it('falls back to theme.riskLevel when risk is invalid', () => {
    const out = normalizeChapter({ title: 'X', risk: 'extreme', sections: [] }, baseTheme);
    expect(out.risk).toBe('high');
  });

  it('coerces missing fields to safe defaults (planned hunks still backfilled)', () => {
    const out = normalizeChapter({}, baseTheme);
    expect(out.title).toBe('Auth boundary');
    expect(out.summary).toBe('');
    expect(out.whyMatters).toBe('');
    // No sections came back at all — the theme's hunks are backfilled so they still surface.
    expect(out.sections).toEqual([
      { type: 'diff', file: 'src/auth.ts', hunkIndex: 0, startLine: 1, endLine: 1 },
      { type: 'diff', file: 'src/middleware.ts', hunkIndex: 2, startLine: 1, endLine: 1 },
    ]);
    expect(out.themeId).toBe('theme-0');
  });

  it('backfills a planned hunk the output lost, at the full new-side range', () => {
    const out = normalizeChapter(
      {
        title: 'Auth boundary',
        sections: [
          { type: 'narrative', content: 'only covers auth' },
          { type: 'diff', file: 'src/auth.ts', hunkIndex: 0, startLine: 11, endLine: 14 },
        ],
      },
      baseTheme,
      themeFiles,
    );
    // The writer's own window on auth.ts is preserved verbatim; the lost middleware hunk is
    // appended spanning its whole new-side range.
    expect(out.sections).toEqual([
      { type: 'narrative', content: 'only covers auth' },
      { type: 'diff', file: 'src/auth.ts', hunkIndex: 0, startLine: 11, endLine: 14 },
      { type: 'diff', file: 'src/middleware.ts', hunkIndex: 2, startLine: 30, endLine: 33 },
    ]);
  });

  it('backfills a deletion-only hunk using the old-side range', () => {
    const files: DiffFile[] = [
      { file: 'src/auth.ts', isNewFile: false, isDeleted: false, hunks: [hunk({ newStart: 10, newCount: 8 })] },
      {
        file: 'src/middleware.ts',
        isNewFile: false,
        isDeleted: false,
        hunks: [hunk(), hunk(), hunk({ oldStart: 40, oldCount: 6, newCount: 0 })],
      },
    ];
    const out = normalizeChapter(
      { sections: [{ type: 'diff', file: 'src/auth.ts', hunkIndex: 0, startLine: 10, endLine: 17 }] },
      baseTheme,
      files,
    );
    expect(out.sections.at(-1)).toEqual({
      type: 'diff',
      file: 'src/middleware.ts',
      hunkIndex: 2,
      startLine: 40,
      endLine: 45,
    });
  });

  it('does not backfill a hunk the writer covered under an a/-prefixed path', () => {
    const out = normalizeChapter(
      {
        sections: [
          { type: 'diff', file: 'a/src/auth.ts', hunkIndex: 0, startLine: 1, endLine: 2 },
          { type: 'diff', file: 'src/middleware.ts', hunkIndex: 2, startLine: 30, endLine: 31 },
        ],
      },
      baseTheme,
      themeFiles,
    );
    expect(out.sections).toHaveLength(2); // normalized paths match — nothing re-appended
  });
});

describe('parseChapterResponse', () => {
  it('returns the recovered object for valid JSON', () => {
    const out = parseChapterResponse('{"title":"X","sections":[]}', 'theme-0') as { title: string };
    expect(out.title).toBe('X');
  });

  it('throws with a raw-response snippet when the model returns prose', () => {
    expect(() => parseChapterResponse('I cannot help with that.', 'theme-0')).toThrow(/theme-0 returned non-JSON/);
    expect(() => parseChapterResponse('I cannot help with that.', 'theme-0')).toThrow(/raw response/);
    expect(() => parseChapterResponse('I cannot help with that.', 'theme-0')).toThrow(/I cannot help with that\./);
  });

  it('reports an empty response explicitly rather than an empty snippet', () => {
    expect(() => parseChapterResponse('', 'theme-0')).toThrow(/\(empty response\)/);
  });
});

describe('buildSuppressedChapter', () => {
  it('produces a low-risk synthetic chapter with diff sections per ref', () => {
    const ch = buildSuppressedChapter({
      ...baseTheme,
      title: 'Mechanical',
      riskLevel: 'low',
      suppress: true,
    });
    expect(ch.title).toBe('Mechanical');
    expect(ch.risk).toBe('low');
    expect(ch.sections).toHaveLength(2);
    expect(ch.sections.every((s) => s.type === 'diff')).toBe(true);
    expect(ch.themeId).toBe('theme-0');
  });

  it('stays minimal: no narrative prose, no callouts, one canned summary sentence', () => {
    // Suppressed themes never reach the writer LLM — this synthetic output is the ONLY
    // contract for them, so it must not reintroduce the verbose prose the prompts banned.
    const ch = buildSuppressedChapter({ ...baseTheme, suppress: true });
    expect(ch.sections.some((s) => s.type === 'narrative')).toBe(false);
    expect(ch.callouts).toBeUndefined();
    expect(ch.whyMatters).toBe('');
    expect(ch.summary.length).toBeLessThan(100);
  });
});
