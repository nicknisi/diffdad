import { describe, expect, it } from 'vitest';
import { repairNarrative, validateNarrative } from '../narrative/validator';
import type { NarrativeResponse } from '../narrative/types';
import type { DiffFile, DiffHunk } from '../github/types';

function hunk(): DiffHunk {
  return { header: '@@', oldStart: 1, oldCount: 1, newStart: 1, newCount: 1, lines: [] };
}

function file(path: string, hunkCount: number): DiffFile {
  return { file: path, isNewFile: false, isDeleted: false, hunks: Array.from({ length: hunkCount }, hunk) };
}

function diffSection(f: string, hunkIndex: number) {
  return { type: 'diff' as const, file: f, hunkIndex, startLine: 1, endLine: 1 };
}

function narrative(chapters: NarrativeResponse['chapters']): NarrativeResponse {
  return { title: 't', tldr: '', verdict: 'caution', readingPlan: [], concerns: [], chapters };
}

describe('repairNarrative', () => {
  it('leaves a clean narrative untouched and drops nothing', () => {
    const files = [file('a.ts', 2)];
    const n = narrative([
      {
        title: 'A',
        summary: 's',
        whyMatters: 'w',
        risk: 'low',
        sections: [diffSection('a.ts', 0), diffSection('a.ts', 1)],
      },
    ]);
    const { narrative: out, dropped } = repairNarrative(n, files);
    expect(dropped).toEqual([]);
    expect(out).toEqual(n);
  });

  it('strips an unknown-file diff section but keeps prose and valid refs', () => {
    const files = [file('a.ts', 1)];
    const n = narrative([
      {
        title: 'A',
        summary: 's',
        whyMatters: 'w',
        risk: 'low',
        sections: [{ type: 'narrative', content: 'keep me' }, diffSection('ghost.ts', 0), diffSection('a.ts', 0)],
      },
    ]);
    const { narrative: out, dropped } = repairNarrative(n, files);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({ kind: 'unknown-file', file: 'ghost.ts', chapter: 0 });
    expect(out.chapters[0]!.sections).toEqual([{ type: 'narrative', content: 'keep me' }, diffSection('a.ts', 0)]);
  });

  it('strips an invalid-hunk-index diff section', () => {
    const files = [file('a.ts', 1)];
    const n = narrative([
      {
        title: 'A',
        summary: '',
        whyMatters: '',
        risk: 'low',
        sections: [diffSection('a.ts', 5), diffSection('a.ts', 0)],
      },
    ]);
    const { narrative: out, dropped } = repairNarrative(n, files);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({ kind: 'invalid-hunk-index', file: 'a.ts', hunkIndex: 5, chapter: 0 });
    expect(out.chapters[0]!.sections).toEqual([diffSection('a.ts', 0)]);
  });

  it('strips an unresolvable reshow entry (ref out of range)', () => {
    const files = [file('a.ts', 1)];
    const n = narrative([
      { title: '1', summary: '', whyMatters: '', risk: 'low', sections: [diffSection('a.ts', 0)] },
      { title: '2', summary: '', whyMatters: '', risk: 'low', sections: [], reshow: [{ ref: 9, file: 'a.ts' }] },
    ]);
    const { narrative: out, dropped } = repairNarrative(n, files);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({ kind: 'reshow-unresolved', chapter: 1, ref: 9 });
    expect(out.chapters[1]!.reshow).toBeUndefined();
  });

  it('strips a reshow pointing at an unknown file', () => {
    const files = [file('a.ts', 1)];
    const n = narrative([
      { title: '1', summary: '', whyMatters: '', risk: 'low', sections: [diffSection('a.ts', 0)] },
      { title: '2', summary: '', whyMatters: '', risk: 'low', sections: [], reshow: [{ ref: 0, file: 'ghost.ts' }] },
    ]);
    const { narrative: out, dropped } = repairNarrative(n, files);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]).toMatchObject({ kind: 'reshow-unresolved', chapter: 1, ref: 0, file: 'ghost.ts' });
    expect(out.chapters[1]!.reshow).toBeUndefined();
  });

  it('keeps a valid reshow that points back at an earlier chapter', () => {
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
    const { narrative: out, dropped } = repairNarrative(n, files);
    expect(dropped).toEqual([]);
    expect(out.chapters[1]!.reshow).toEqual([{ ref: 0, file: 'a.ts' }]);
  });

  it('does not strip a forward-ref reshow (the hunk exists)', () => {
    const files = [file('a.ts', 2)];
    const n = narrative([
      {
        title: '1',
        summary: '',
        whyMatters: '',
        risk: 'low',
        sections: [diffSection('a.ts', 0)],
        reshow: [{ ref: 1, file: 'a.ts' }],
      },
      { title: '2', summary: '', whyMatters: '', risk: 'low', sections: [diffSection('a.ts', 1)] },
    ]);
    const { narrative: out, dropped } = repairNarrative(n, files);
    expect(dropped).toEqual([]);
    expect(out.chapters[0]!.reshow).toEqual([{ ref: 1, file: 'a.ts' }]);
  });

  it('nulls out a callstack frame dead link but keeps the frame and its prose', () => {
    const files = [file('a.ts', 1)];
    const n = narrative([
      {
        title: 'A',
        summary: '',
        whyMatters: '',
        risk: 'low',
        sections: [
          diffSection('a.ts', 0),
          {
            type: 'callstack',
            title: 'flow',
            frames: [
              { label: 'root', change: 'unchanged', depth: 0 },
              { label: 'gone', change: 'added', depth: 1, file: 'ghost.ts', hunkIndex: 0 },
              { label: 'oob', change: 'modified', depth: 1, file: 'a.ts', hunkIndex: 9 },
              { label: 'good', change: 'added', depth: 1, file: 'a.ts', hunkIndex: 0 },
            ],
          },
        ],
      },
    ]);
    const { narrative: out, dropped } = repairNarrative(n, files);
    const section = out.chapters[0]!.sections[1]!;
    expect(section.type).toBe('callstack');
    if (section.type === 'callstack') {
      expect(section.frames).toHaveLength(4); // no frame dropped
      expect(section.frames[1]).toEqual({
        label: 'gone',
        change: 'added',
        depth: 1,
        file: undefined,
        hunkIndex: undefined,
      });
      expect(section.frames[2]).toEqual({
        label: 'oob',
        change: 'modified',
        depth: 1,
        file: undefined,
        hunkIndex: undefined,
      });
      expect(section.frames[3]).toEqual({ label: 'good', change: 'added', depth: 1, file: 'a.ts', hunkIndex: 0 });
    }
    expect(dropped).toHaveLength(2);
    expect(dropped.map((d) => d.kind).sort()).toEqual(['invalid-hunk-index', 'unknown-file']);
  });

  it('nulls out a sequence message dead link but keeps the message and its prose', () => {
    const files = [file('a.ts', 1)];
    const n = narrative([
      {
        title: 'A',
        summary: '',
        whyMatters: '',
        risk: 'low',
        sections: [
          diffSection('a.ts', 0),
          {
            type: 'sequence',
            title: 'flow',
            participants: ['A', 'B'],
            messages: [
              { from: 'A', to: 'B', label: 'plain' },
              { from: 'A', to: 'B', label: 'gone', note: 'why', file: 'ghost.ts', hunkIndex: 0 },
              { from: 'B', to: 'A', label: 'oob', file: 'a.ts', hunkIndex: 9 },
              { from: 'A', to: 'B', label: 'good', file: 'a.ts', hunkIndex: 0 },
            ],
          },
        ],
      },
    ]);
    const { narrative: out, dropped } = repairNarrative(n, files);
    const section = out.chapters[0]!.sections[1]!;
    expect(section.type).toBe('sequence');
    if (section.type === 'sequence') {
      expect(section.messages).toHaveLength(4); // no message dropped
      expect(section.messages[1]).toEqual({
        from: 'A',
        to: 'B',
        label: 'gone',
        note: 'why',
        file: undefined,
        hunkIndex: undefined,
      });
      expect(section.messages[2]).toEqual({ from: 'B', to: 'A', label: 'oob', file: undefined, hunkIndex: undefined });
      expect(section.messages[3]).toEqual({ from: 'A', to: 'B', label: 'good', file: 'a.ts', hunkIndex: 0 });
    }
    expect(dropped).toHaveLength(2);
    expect(dropped.map((d) => d.kind).sort()).toEqual(['invalid-hunk-index', 'unknown-file']);
  });

  it('produces a narrative with no unresolvable refs left (validator agrees)', () => {
    const files = [file('a.ts', 2)];
    const n = narrative([
      {
        title: 'A',
        summary: '',
        whyMatters: '',
        risk: 'low',
        sections: [diffSection('a.ts', 0), diffSection('ghost.ts', 0), diffSection('a.ts', 7)],
        reshow: [{ ref: 42, file: 'a.ts' }],
      },
      { title: 'B', summary: '', whyMatters: '', risk: 'low', sections: [diffSection('a.ts', 1)] },
    ]);
    const { narrative: out } = repairNarrative(n, files);
    const kinds = new Set(validateNarrative(out, files).violations.map((v) => v.kind));
    expect(kinds.has('unknown-file')).toBe(false);
    expect(kinds.has('invalid-hunk-index')).toBe(false);
    expect(kinds.has('reshow-unresolved')).toBe(false);
  });
});
