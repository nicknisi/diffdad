import { describe, expect, it } from 'vitest';
import { formatViolation, validateNarrative, type ValidationViolation } from '../narrative/validator';
import type { NarrativeResponse } from '../narrative/types';
import type { DiffFile, DiffHunk } from '../github/types';

function hunk(): DiffHunk {
  return {
    header: '@@',
    oldStart: 1,
    oldCount: 1,
    newStart: 1,
    newCount: 1,
    lines: [],
  };
}

function file(path: string, hunkCount: number): DiffFile {
  return {
    file: path,
    isNewFile: false,
    isDeleted: false,
    hunks: Array.from({ length: hunkCount }, hunk),
  };
}

function diffSection(file: string, hunkIndex: number) {
  return { type: 'diff' as const, file, hunkIndex, startLine: 1, endLine: 1 };
}

function narrative(chapters: NarrativeResponse['chapters']): NarrativeResponse {
  return {
    title: 't',
    tldr: '',
    verdict: 'caution',
    readingPlan: [],
    concerns: [],
    chapters,
  };
}

function findKind<K extends ValidationViolation['kind']>(
  violations: ValidationViolation[],
  kind: K,
): Extract<ValidationViolation, { kind: K }>[] {
  return violations.filter((v) => v.kind === kind) as Extract<ValidationViolation, { kind: K }>[];
}

describe('validateNarrative', () => {
  it('accepts a clean narrative with one chapter per hunk', () => {
    const files = [file('a.ts', 2)];
    const n = narrative([
      {
        title: 'A',
        summary: '',
        whyMatters: '',
        risk: 'low',
        sections: [diffSection('a.ts', 0), diffSection('a.ts', 1)],
      },
    ]);
    const r = validateNarrative(n, files);
    expect(r.ok).toBe(true);
    expect(r.violations).toEqual([]);
  });

  it('flags duplicate-primary when two chapters claim the same hunk', () => {
    const files = [file('a.ts', 1)];
    const n = narrative([
      { title: '1', summary: '', whyMatters: '', risk: 'low', sections: [diffSection('a.ts', 0)] },
      { title: '2', summary: '', whyMatters: '', risk: 'low', sections: [diffSection('a.ts', 0)] },
    ]);
    const r = validateNarrative(n, files);
    const dups = findKind(r.violations, 'duplicate-primary');
    expect(dups).toHaveLength(1);
    expect(dups[0]).toMatchObject({ file: 'a.ts', hunkIndex: 0, chapters: [0, 1] });
  });

  it('flags orphan-hunk for hunks no chapter references', () => {
    const files = [file('a.ts', 3)];
    const n = narrative([{ title: '1', summary: '', whyMatters: '', risk: 'low', sections: [diffSection('a.ts', 0)] }]);
    const r = validateNarrative(n, files);
    const orphans = findKind(r.violations, 'orphan-hunk');
    expect(orphans).toHaveLength(2);
    expect(orphans.map((o) => o.hunkIndex).sort()).toEqual([1, 2]);
  });

  it('flags invalid-hunk-index when hunkIndex is out of range', () => {
    const files = [file('a.ts', 1)];
    const n = narrative([{ title: '1', summary: '', whyMatters: '', risk: 'low', sections: [diffSection('a.ts', 5)] }]);
    const r = validateNarrative(n, files);
    const bad = findKind(r.violations, 'invalid-hunk-index');
    expect(bad).toHaveLength(1);
    expect(bad[0]).toMatchObject({ file: 'a.ts', hunkIndex: 5, chapter: 0 });
  });

  it('flags unknown-file when chapter references a path not in the diff', () => {
    const files = [file('a.ts', 1)];
    const n = narrative([
      { title: '1', summary: '', whyMatters: '', risk: 'low', sections: [diffSection('ghost.ts', 0)] },
    ]);
    const r = validateNarrative(n, files);
    const unk = findKind(r.violations, 'unknown-file');
    expect(unk).toHaveLength(1);
    expect(unk[0]).toMatchObject({ file: 'ghost.ts', chapter: 0 });
  });

  it('flags reshow-unresolved when reshow points at a missing hunk', () => {
    const files = [file('a.ts', 1)];
    const n = narrative([
      { title: '1', summary: '', whyMatters: '', risk: 'low', sections: [diffSection('a.ts', 0)] },
      {
        title: '2',
        summary: '',
        whyMatters: '',
        risk: 'low',
        sections: [],
        reshow: [{ ref: 9, file: 'a.ts' }],
      },
    ]);
    const r = validateNarrative(n, files);
    const ur = findKind(r.violations, 'reshow-unresolved');
    expect(ur).toHaveLength(1);
    expect(ur[0]).toMatchObject({ chapter: 1, ref: 9 });
  });

  it('flags reshow-forward-ref when reshow points at a hunk whose primary is later (or absent)', () => {
    const files = [file('a.ts', 2)];
    const n = narrative([
      {
        title: '1',
        summary: '',
        whyMatters: '',
        risk: 'low',
        sections: [diffSection('a.ts', 0)],
        // refers to hunk 1, but no chapter ever shows hunk 1 as primary
        reshow: [{ ref: 1, file: 'a.ts' }],
      },
    ]);
    const r = validateNarrative(n, files);
    const fwd = findKind(r.violations, 'reshow-forward-ref');
    expect(fwd).toHaveLength(1);
    expect(fwd[0]).toMatchObject({ chapter: 0, ref: 1, file: 'a.ts' });
  });

  it('accepts a valid reshow that points back at an earlier chapter', () => {
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
    const r = validateNarrative(n, files);
    expect(findKind(r.violations, 'reshow-forward-ref')).toEqual([]);
    expect(findKind(r.violations, 'reshow-unresolved')).toEqual([]);
  });

  it('normalizes a/ b/ prefixes when comparing paths', () => {
    const files = [file('src/foo.ts', 1)];
    const n = narrative([
      {
        title: '1',
        summary: '',
        whyMatters: '',
        risk: 'low',
        sections: [diffSection('b/src/foo.ts', 0)],
      },
    ]);
    const r = validateNarrative(n, files);
    expect(findKind(r.violations, 'unknown-file')).toEqual([]);
    expect(findKind(r.violations, 'orphan-hunk')).toEqual([]);
  });

  it('formatViolation produces a non-empty string for every kind', () => {
    const samples: ValidationViolation[] = [
      { kind: 'duplicate-primary', file: 'a', hunkIndex: 0, chapters: [0, 1] },
      { kind: 'orphan-hunk', file: 'a', hunkIndex: 0 },
      { kind: 'invalid-hunk-index', file: 'a', hunkIndex: 9, chapter: 0 },
      { kind: 'unknown-file', file: 'a', chapter: 0 },
      { kind: 'reshow-unresolved', chapter: 0, ref: 0 },
      { kind: 'reshow-forward-ref', chapter: 0, ref: 0, file: 'a' },
    ];
    for (const s of samples) {
      expect(formatViolation(s).length).toBeGreaterThan(0);
    }
  });
});
