import { describe, expect, it } from 'vitest';
import { formatPlanViolation, normalizePlan, validatePlan } from '../narrative/planner';
import type { DiffFile, DiffHunk } from '../github/types';
import type { Plan } from '../narrative/plan-types';

function hunk(): DiffHunk {
  return { header: '@@', oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, lines: [] };
}

function file(path: string, hunkCount: number): DiffFile {
  return { file: path, isNewFile: false, isDeleted: false, hunks: Array.from({ length: hunkCount }, hunk) };
}

describe('normalizePlan', () => {
  it('coerces missing fields to safe defaults', () => {
    const out = normalizePlan({}, []);
    expect(out.schemaVersion).toBe(1);
    expect(out.themes).toEqual([]);
    expect(out.prVerdict).toBe('caution');
  });

  it('assigns stable theme IDs when missing', () => {
    const out = normalizePlan(
      {
        themes: [
          { title: 'A', riskLevel: 'high', rationale: 'r', hunkRefs: [{ file: 'a.ts', hunkIndex: 0 }] },
          { title: 'B', riskLevel: 'low', rationale: 'r', hunkRefs: [{ file: 'a.ts', hunkIndex: 1 }] },
        ],
      },
      [file('a.ts', 2)],
    );
    expect(out.themes.map((t) => t.id)).toEqual(['theme-0', 'theme-1']);
  });

  it('drops hunkRefs that point at unknown files or out-of-range indices', () => {
    const out = normalizePlan(
      {
        themes: [
          {
            title: 'A',
            riskLevel: 'high',
            rationale: 'r',
            hunkRefs: [
              { file: 'a.ts', hunkIndex: 0 },
              { file: 'a.ts', hunkIndex: 9 }, // out of range
              { file: 'ghost.ts', hunkIndex: 0 }, // unknown
            ],
          },
        ],
      },
      [file('a.ts', 2)],
    );
    expect(out.themes[0]?.hunkRefs).toEqual([{ file: 'a.ts', hunkIndex: 0 }]);
  });

  it('drops themes with zero valid hunkRefs', () => {
    const out = normalizePlan({ themes: [{ title: 'X', hunkRefs: [{ file: 'ghost.ts', hunkIndex: 0 }] }] }, [
      file('a.ts', 1),
    ]);
    expect(out.themes).toEqual([]);
  });
});

describe('validatePlan', () => {
  function plan(themes: Plan['themes']): Plan {
    return {
      schemaVersion: 1,
      prTitle: '',
      prTldr: '',
      prVerdict: 'caution',
      themes,
      readingPlan: [],
      concerns: [],
    };
  }

  it('passes when every hunk is covered exactly once', () => {
    const files = [file('a.ts', 2)];
    const p = plan([
      {
        id: 'theme-0',
        title: 'A',
        riskLevel: 'high',
        rationale: 'r',
        hunkRefs: [
          { file: 'a.ts', hunkIndex: 0 },
          { file: 'a.ts', hunkIndex: 1 },
        ],
      },
    ]);
    const r = validatePlan(p, files);
    expect(r.ok).toBe(true);
  });

  it('flags orphan hunks not assigned to any theme', () => {
    const files = [file('a.ts', 2)];
    const p = plan([
      { id: 't0', title: 'A', riskLevel: 'low', rationale: '', hunkRefs: [{ file: 'a.ts', hunkIndex: 0 }] },
    ]);
    const r = validatePlan(p, files);
    const orphans = r.violations.filter((v) => v.kind === 'orphan-hunk');
    expect(orphans).toHaveLength(1);
  });

  it('flags duplicate refs across themes', () => {
    const files = [file('a.ts', 1)];
    const p = plan([
      { id: 't0', title: 'A', riskLevel: 'low', rationale: '', hunkRefs: [{ file: 'a.ts', hunkIndex: 0 }] },
      { id: 't1', title: 'B', riskLevel: 'low', rationale: '', hunkRefs: [{ file: 'a.ts', hunkIndex: 0 }] },
    ]);
    const r = validatePlan(p, files);
    expect(r.violations.some((v) => v.kind === 'duplicate-ref')).toBe(true);
  });

  it('flags multiple suppressed themes', () => {
    const files = [file('a.ts', 2)];
    const p = plan([
      {
        id: 't0',
        title: 'A',
        riskLevel: 'low',
        rationale: '',
        hunkRefs: [{ file: 'a.ts', hunkIndex: 0 }],
        suppress: true,
      },
      {
        id: 't1',
        title: 'B',
        riskLevel: 'low',
        rationale: '',
        hunkRefs: [{ file: 'a.ts', hunkIndex: 1 }],
        suppress: true,
      },
    ]);
    const r = validatePlan(p, files);
    expect(r.violations.some((v) => v.kind === 'multiple-suppressed')).toBe(true);
  });

  it('flags an empty themes array as no-themes', () => {
    const r = validatePlan(plan([]), [file('a.ts', 1)]);
    expect(r.violations.some((v) => v.kind === 'no-themes')).toBe(true);
  });

  it('formatPlanViolation returns a non-empty string for every kind', () => {
    expect(formatPlanViolation({ kind: 'no-themes' })).toBeTruthy();
    expect(formatPlanViolation({ kind: 'orphan-hunk', file: 'a', hunkIndex: 0 })).toBeTruthy();
    expect(formatPlanViolation({ kind: 'duplicate-ref', file: 'a', hunkIndex: 0, themeIds: ['x'] })).toBeTruthy();
    expect(formatPlanViolation({ kind: 'multiple-suppressed', themeIds: ['x'] })).toBeTruthy();
    expect(formatPlanViolation({ kind: 'too-many-themes', count: 9, max: 7 })).toBeTruthy();
  });
});
