import { describe, expect, it } from 'vitest';
import { buildSuppressedChapter, normalizeChapter } from '../narrative/writer';
import type { PlanTheme } from '../narrative/plan-types';

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

  it('coerces missing fields to safe defaults', () => {
    const out = normalizeChapter({}, baseTheme);
    expect(out.title).toBe('Auth boundary');
    expect(out.summary).toBe('');
    expect(out.whyMatters).toBe('');
    expect(out.sections).toEqual([]);
    expect(out.themeId).toBe('theme-0');
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
});
