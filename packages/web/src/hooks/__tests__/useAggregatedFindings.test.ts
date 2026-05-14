import { describe, expect, it } from 'vitest';
import { aggregateFindings } from '../../lib/findings';
import type { Callout, Concern, DiffFile } from '../../state/types';

function makeConcern(file: string, line: number, category = 'logic' as const): Concern {
  return { question: `What about ${file}:${line}?`, file, line, category, why: 'test' };
}

function makeCallout(file: string, line: number, level = 'concern' as const): Callout {
  return { file, line, level, message: `callout at ${file}:${line}` };
}

function makeFile(file: string, hunks: { newStart: number; newCount: number }[]): DiffFile {
  return {
    file,
    isNewFile: false,
    isDeleted: false,
    hunks: hunks.map((h) => ({
      header: `@@ -${h.newStart} +${h.newStart},${h.newCount} @@`,
      oldStart: h.newStart,
      oldCount: h.newCount,
      newStart: h.newStart,
      newCount: h.newCount,
      lines: Array.from({ length: h.newCount }, (_, i) => ({
        type: 'context' as const,
        content: `line ${h.newStart + i}`,
        lineNumber: { old: h.newStart + i, new: h.newStart + i },
      })),
    })),
  };
}

describe('aggregateFindings', () => {
  it('returns empty for empty narrative', () => {
    expect(aggregateFindings([], [], [])).toEqual([]);
  });

  it('returns concerns only when no callouts exist', () => {
    const concerns = [makeConcern('src/a.ts', 10), makeConcern('src/b.ts', 20), makeConcern('src/c.ts', 5)];
    const result = aggregateFindings(concerns, [{ sections: [], callouts: [] }], []);
    expect(result).toHaveLength(3);
    expect(result.every((f) => f.kind === 'concern')).toBe(true);
  });

  it('returns callouts only when no concerns exist', () => {
    const chapters = [
      { sections: [], callouts: [makeCallout('src/a.ts', 10), makeCallout('src/a.ts', 20)] },
      { sections: [], callouts: [makeCallout('src/b.ts', 5), makeCallout('src/b.ts', 15), makeCallout('src/c.ts', 1)] },
    ];
    const result = aggregateFindings([], chapters, []);
    expect(result).toHaveLength(5);
    expect(result.every((f) => f.kind === 'callout')).toBe(true);
  });

  it('sorts by chapterIndex then file then line', () => {
    const files = [makeFile('src/a.ts', [{ newStart: 1, newCount: 50 }])];
    const concerns = [makeConcern('src/a.ts', 10)];
    const chapters = [
      { sections: [{ type: 'diff', file: 'src/a.ts', hunkIndex: 0 }], callouts: [makeCallout('src/a.ts', 5)] },
      { sections: [], callouts: [makeCallout('src/b.ts', 1)] },
    ];
    const result = aggregateFindings(concerns, chapters, files);

    expect(result[0]!.chapterIndex).toBe(0);
    expect(result[0]!.line).toBe(5);
    expect(result[1]!.chapterIndex).toBe(0);
    expect(result[1]!.line).toBe(10);
    expect(result[2]!.chapterIndex).toBe(1);
  });

  it('concern with no matching hunk gets chapterIndex undefined', () => {
    const concerns = [makeConcern('src/unknown.ts', 99)];
    const chapters = [{ sections: [], callouts: [] }];
    const result = aggregateFindings(concerns, chapters, []);
    expect(result).toHaveLength(1);
    expect(result[0]!.kind).toBe('concern');
    expect(result[0]!.chapterIndex).toBeUndefined();
  });

  it('keeps duplicate concerns on the same line', () => {
    const concerns = [makeConcern('src/a.ts', 10), makeConcern('src/a.ts', 10)];
    const result = aggregateFindings(concerns, [], []);
    expect(result).toHaveLength(2);
  });

  it('resolves concern chapterIndex via hunk coverage', () => {
    const files = [makeFile('src/a.ts', [{ newStart: 1, newCount: 20 }])];
    const concerns = [makeConcern('src/a.ts', 5)];
    const chapters = [
      { sections: [], callouts: [] },
      { sections: [{ type: 'diff', file: 'src/a.ts', hunkIndex: 0 }], callouts: [] },
    ];
    const result = aggregateFindings(concerns, chapters, files);
    expect(result[0]!.chapterIndex).toBe(1);
  });
});
