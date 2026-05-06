import { describe, expect, it } from 'vitest';
import { computeMetrics, formatMetricsRow } from '../narrative/metrics';
import type { NarrativeResponse } from '../narrative/types';
import type { DiffFile, DiffHunk } from '../github/types';

function hunk(): DiffHunk {
  return { header: '@@', oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, lines: [] };
}

function file(path: string, hunkCount: number): DiffFile {
  return { file: path, isNewFile: false, isDeleted: false, hunks: Array.from({ length: hunkCount }, hunk) };
}

function diffSection(file: string, hunkIndex: number) {
  return { type: 'diff' as const, file, hunkIndex, startLine: 1, endLine: 1 };
}

function narrative(chapters: NarrativeResponse['chapters']): NarrativeResponse {
  return { title: '', tldr: '', verdict: 'caution', readingPlan: [], concerns: [], chapters };
}

describe('computeMetrics', () => {
  it('returns zeros for an empty narrative', () => {
    const m = computeMetrics(narrative([]), []);
    expect(m).toMatchObject({
      chapters: 0,
      hunksPrimary: 0,
      hunksOrphaned: 0,
      reshowCount: 0,
      crossFileChapterRatio: 0,
    });
  });

  it('counts primary hunks once even if duplicated across chapters', () => {
    const files = [file('a.ts', 2)];
    const n = narrative([
      { title: '1', summary: '', whyMatters: '', risk: 'low', sections: [diffSection('a.ts', 0)] },
      {
        title: '2',
        summary: '',
        whyMatters: '',
        risk: 'low',
        sections: [diffSection('a.ts', 0), diffSection('a.ts', 1)],
      },
    ]);
    const m = computeMetrics(n, files);
    expect(m.hunksPrimary).toBe(2);
    expect(m.hunksOrphaned).toBe(0);
  });

  it('detects cross-file chapters', () => {
    const files = [file('a.ts', 1), file('b.ts', 1), file('c.ts', 1)];
    const n = narrative([
      {
        title: '1',
        summary: '',
        whyMatters: '',
        risk: 'low',
        sections: [diffSection('a.ts', 0), diffSection('b.ts', 0)],
      },
      { title: '2', summary: '', whyMatters: '', risk: 'low', sections: [diffSection('c.ts', 0)] },
    ]);
    const m = computeMetrics(n, files);
    expect(m.crossFileChapterRatio).toBe(0.5);
  });

  it('counts orphans for hunks that are never referenced', () => {
    const files = [file('a.ts', 4)];
    const n = narrative([{ title: '1', summary: '', whyMatters: '', risk: 'low', sections: [diffSection('a.ts', 0)] }]);
    const m = computeMetrics(n, files);
    expect(m.hunksOrphaned).toBe(3);
  });

  it('counts reshow entries and treats reshown hunks as referenced', () => {
    const files = [file('a.ts', 2)];
    const n = narrative([
      { title: '1', summary: '', whyMatters: '', risk: 'low', sections: [diffSection('a.ts', 0)] },
      {
        title: '2',
        summary: '',
        whyMatters: '',
        risk: 'low',
        sections: [diffSection('a.ts', 1)],
        reshow: [{ ref: 0, file: 'a.ts' }],
      },
    ]);
    const m = computeMetrics(n, files);
    expect(m.reshowCount).toBe(1);
    expect(m.hunksOrphaned).toBe(0);
  });

  it('computes p50/p90 over primary-hunk counts per chapter', () => {
    const files = [file('a.ts', 5)];
    const n = narrative([
      { title: '1', summary: '', whyMatters: '', risk: 'low', sections: [diffSection('a.ts', 0)] },
      {
        title: '2',
        summary: '',
        whyMatters: '',
        risk: 'low',
        sections: [diffSection('a.ts', 1), diffSection('a.ts', 2)],
      },
      {
        title: '3',
        summary: '',
        whyMatters: '',
        risk: 'low',
        sections: [diffSection('a.ts', 3), diffSection('a.ts', 4)],
      },
    ]);
    const m = computeMetrics(n, files);
    expect(m.hunksPerChapterP50).toBe(2);
    expect(m.hunksPerChapterP90).toBe(2);
  });

  it('formatMetricsRow returns a non-empty single-line summary', () => {
    const m = computeMetrics(narrative([]), []);
    const row = formatMetricsRow('test', m);
    expect(row.length).toBeGreaterThan(0);
    expect(row).toContain('chapters=0');
  });
});
