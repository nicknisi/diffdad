import { describe, expect, it } from 'vitest';
import { normalizeNarrative } from '../narrative/types';

describe('normalizeNarrative', () => {
  it('fills missing required fields with defaults', () => {
    const out = normalizeNarrative({});
    expect(out.title).toBe('');
    expect(out.tldr).toBe('');
    expect(out.verdict).toBe('caution');
    expect(out.readingPlan).toEqual([]);
    expect(out.concerns).toEqual([]);
    expect(out.chapters).toEqual([]);
  });

  it('preserves valid fields', () => {
    const input = {
      title: 'Refactor X',
      tldr: 'Splits X.',
      verdict: 'risky',
      readingPlan: [{ step: 'start at 1', chapterIndex: 0 }],
      concerns: [{ question: 'what if foo?', file: 'a.ts', line: 1, category: 'logic', why: 'because bar' }],
      chapters: [
        {
          title: 'A',
          summary: 'a chapter',
          whyMatters: 'matters because',
          risk: 'high',
          sections: [{ type: 'narrative', content: 'hi' }],
        },
      ],
    };
    const out = normalizeNarrative(input);
    expect(out.title).toBe('Refactor X');
    expect(out.verdict).toBe('risky');
    expect(out.readingPlan).toHaveLength(1);
    expect(out.concerns).toHaveLength(1);
    expect(out.chapters).toHaveLength(1);
    expect(out.chapters[0]?.whyMatters).toBe('matters because');
  });

  it('coerces unknown verdict to caution', () => {
    const out = normalizeNarrative({ verdict: 'nope' });
    expect(out.verdict).toBe('caution');
  });

  it('upgrades old narratives missing the new fields', () => {
    const oldShape = {
      title: 'Old',
      chapters: [{ title: 'C', summary: 's', risk: 'low', sections: [] }],
    };
    const out = normalizeNarrative(oldShape);
    expect(out.tldr).toBe('');
    expect(out.concerns).toEqual([]);
    expect(out.readingPlan).toEqual([]);
    expect(out.chapters[0]?.whyMatters).toBe('');
    expect(out.chapters[0]?.risk).toBe('low');
  });
});
