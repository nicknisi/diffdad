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

  it('accepts a callstack section and preserves valid frames', () => {
    const out = normalizeNarrative({
      chapters: [
        {
          title: 'C',
          summary: 's',
          whyMatters: 'w',
          risk: 'low',
          sections: [
            {
              type: 'callstack',
              title: 'flow',
              frames: [
                { label: 'a — f.ts', change: 'added', depth: 0 },
                { label: 'b — f.ts', change: 'modified', depth: 1, file: 'f.ts', hunkIndex: 2 },
              ],
            },
          ],
        },
      ],
    });
    const section = out.chapters[0]?.sections[0];
    expect(section?.type).toBe('callstack');
    if (section?.type === 'callstack') {
      expect(section.title).toBe('flow');
      expect(section.frames).toHaveLength(2);
      expect(section.frames[1]).toEqual({
        label: 'b — f.ts',
        change: 'modified',
        depth: 1,
        file: 'f.ts',
        hunkIndex: 2,
      });
    }
  });

  it('clamps frame depth, coerces bad change, drops malformed frames, and caps frame count', () => {
    const frames = [
      { label: 'ok', change: 'weird', depth: 99 }, // change -> unchanged, depth -> 8
      { label: 'deep', change: 'removed', depth: -3 }, // depth -> 0
      { change: 'added', depth: 1 }, // no label -> dropped
      { label: '', change: 'added', depth: 1 }, // empty label -> dropped
      ...Array.from({ length: 40 }, (_, i) => ({ label: `f${i}`, change: 'unchanged', depth: 0 })),
    ];
    const out = normalizeNarrative({
      chapters: [
        { title: 'C', summary: '', whyMatters: '', risk: 'low', sections: [{ type: 'callstack', title: 't', frames }] },
      ],
    });
    const section = out.chapters[0]?.sections[0];
    expect(section?.type).toBe('callstack');
    if (section?.type === 'callstack') {
      expect(section.frames).toHaveLength(30); // capped
      expect(section.frames[0]).toMatchObject({ change: 'unchanged', depth: 8 });
      expect(section.frames[1]).toMatchObject({ change: 'removed', depth: 0 });
      // the two malformed frames were dropped, so index 2 is the first synthesized filler
      expect(section.frames[2]?.label).toBe('f0');
    }
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
