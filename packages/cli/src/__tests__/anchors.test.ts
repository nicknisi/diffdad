import { describe, expect, it } from 'vitest';
import { computeHunkAnchor, enrichNarrativeAnchors, resolveAnchor } from '../narrative/anchors';
import { hashHunkLines } from '../github/diff-parser';
import { repairNarrative } from '../narrative/validator';
import type { DiffFile, DiffHunk, DiffLine } from '../github/types';
import type { NarrativeResponse } from '../narrative/types';

function line(type: DiffLine['type'], content: string): DiffLine {
  return { type, content, lineNumber: {} };
}

function hunk(newStart: number, newCount: number, contents: [DiffLine['type'], string][]): DiffHunk {
  const lines = contents.map(([t, c]) => line(t, c));
  return {
    header: `@@ -${newStart},1 +${newStart},${newCount} @@`,
    oldStart: newStart,
    oldCount: 1,
    newStart,
    newCount,
    lines,
    contentHash: hashHunkLines(lines),
  };
}

function file(path: string, hunks: DiffHunk[]): DiffFile {
  return { file: path, isNewFile: false, isDeleted: false, hunks };
}

function narrative(chapters: NarrativeResponse['chapters']): NarrativeResponse {
  return { title: 't', tldr: '', verdict: 'caution', readingPlan: [], concerns: [], chapters };
}

describe('computeHunkAnchor', () => {
  it('is stable: the same hunk contents produce the same contentHash', () => {
    const h = hunk(10, 2, [
      ['context', 'const a = 1;'],
      ['add', 'const b = 2;'],
    ]);
    const f = file('a.ts', [h]);
    const a1 = computeHunkAnchor(f, 0);
    const a2 = computeHunkAnchor(
      file('a.ts', [
        hunk(10, 2, [
          ['context', 'const a = 1;'],
          ['add', 'const b = 2;'],
        ]),
      ]),
      0,
    );
    expect(a1.contentHash).toBe(a2.contentHash);
    expect(a1).toEqual({ file: 'a.ts', newStart: 10, newLines: 2, contentHash: a1.contentHash });
  });

  it('changes contentHash when any line changes', () => {
    const base = computeHunkAnchor(
      file('a.ts', [
        hunk(10, 2, [
          ['context', 'const a = 1;'],
          ['add', 'const b = 2;'],
        ]),
      ]),
      0,
    );
    const changed = computeHunkAnchor(
      file('a.ts', [
        hunk(10, 2, [
          ['context', 'const a = 1;'],
          ['add', 'const b = 3;'],
        ]),
      ]),
      0,
    );
    expect(changed.contentHash).not.toBe(base.contentHash);
  });

  it('op changes (add vs context) change the hash even with identical text', () => {
    const add = computeHunkAnchor(file('a.ts', [hunk(1, 1, [['add', 'x']])]), 0);
    const ctx = computeHunkAnchor(file('a.ts', [hunk(1, 1, [['context', 'x']])]), 0);
    expect(add.contentHash).not.toBe(ctx.contentHash);
  });
});

describe('resolveAnchor ladder', () => {
  const target = hunk(20, 2, [
    ['context', 'foo'],
    ['add', 'bar'],
  ]);
  const anchor = computeHunkAnchor(file('a.ts', [target]), 0);

  it('1. exact: hash + position match', () => {
    const files = [file('a.ts', [target])];
    expect(resolveAnchor(files, anchor)).toEqual({ file: 'a.ts', hunkIndex: 0 });
  });

  it('2. moved-index: same hash at a shifted index', () => {
    const files = [file('a.ts', [hunk(1, 1, [['add', 'unrelated']]), target])];
    expect(resolveAnchor(files, anchor)).toEqual({ file: 'a.ts', hunkIndex: 1 });
  });

  it('3. line-range: hash gone, overlapping new-side range in the named file', () => {
    const edited = hunk(21, 2, [
      ['context', 'foo'],
      ['add', 'baz'], // changed content -> different hash, but overlaps [20,21]
    ]);
    const files = [file('a.ts', [edited])];
    expect(resolveAnchor(files, anchor)).toEqual({ file: 'a.ts', hunkIndex: 0 });
  });

  it('4. null: file present but no hash match and no overlapping range', () => {
    const faraway = hunk(200, 1, [['add', 'nope']]);
    const files = [file('a.ts', [faraway])];
    expect(resolveAnchor(files, anchor)).toBeNull();
  });

  it('4. null: named file absent entirely', () => {
    const files = [file('other.ts', [target])];
    expect(resolveAnchor(files, anchor)).toBeNull();
  });

  it('normalizes a/ b/ path prefixes on both sides', () => {
    const files = [file('a.ts', [target])];
    expect(resolveAnchor(files, { ...anchor, file: 'b/a.ts' })).toEqual({ file: 'a.ts', hunkIndex: 0 });
  });
});

describe('enrichNarrativeAnchors', () => {
  it('stamps a fresh anchor onto every resolvable diff section', () => {
    const h = hunk(5, 1, [['add', 'z']]);
    const files = [file('a.ts', [h])];
    const n = narrative([
      {
        title: 'A',
        summary: '',
        whyMatters: '',
        risk: 'low',
        sections: [{ type: 'diff', file: 'a.ts', hunkIndex: 0, startLine: 5, endLine: 5 }],
      },
    ]);
    const out = enrichNarrativeAnchors(n, files);
    const s = out.chapters[0]!.sections[0]!;
    expect(s.type === 'diff' && s.anchor).toEqual(computeHunkAnchor(files[0]!, 0));
  });
});

describe('repairNarrative re-resolution', () => {
  it('re-resolves a shifted hunkIndex via the anchor instead of dropping it', () => {
    const target = hunk(20, 2, [
      ['context', 'foo'],
      ['add', 'bar'],
    ]);
    const anchor = computeHunkAnchor(file('a.ts', [target]), 0);
    // Diff re-fetched: a new hunk got prepended, so the target now lives at index 1, but the narrative
    // still says index 0.
    const files = [file('a.ts', [hunk(1, 1, [['add', 'new']]), target])];
    const n = narrative([
      {
        title: 'A',
        summary: '',
        whyMatters: '',
        risk: 'low',
        sections: [{ type: 'diff', file: 'a.ts', hunkIndex: 0, startLine: 20, endLine: 21, anchor }],
      },
    ]);
    const { narrative: out, dropped } = repairNarrative(n, files);
    expect(dropped).toEqual([]);
    const s = out.chapters[0]!.sections[0]!;
    expect(s.type).toBe('diff');
    if (s.type === 'diff') {
      expect(s.hunkIndex).toBe(1);
      expect(s.file).toBe('a.ts');
      expect(s.anchor).toEqual(computeHunkAnchor(files[0]!, 1));
    }
  });

  it('re-resolves an unknown-file section when the anchor still names a present file', () => {
    const target = hunk(3, 1, [['add', 'kept']]);
    const anchor = computeHunkAnchor(file('a.ts', [target]), 0);
    const files = [file('a.ts', [target])];
    const n = narrative([
      {
        title: 'A',
        summary: '',
        whyMatters: '',
        risk: 'low',
        // Section names a stale/renamed path but the anchor points at the real file.
        sections: [{ type: 'diff', file: 'stale-name.ts', hunkIndex: 9, startLine: 3, endLine: 3, anchor }],
      },
    ]);
    const { narrative: out, dropped } = repairNarrative(n, files);
    expect(dropped).toEqual([]);
    const s = out.chapters[0]!.sections[0]!;
    expect(s.type === 'diff' && s.file).toBe('a.ts');
    expect(s.type === 'diff' && s.hunkIndex).toBe(0);
  });

  it('still drops when the anchor cannot be placed', () => {
    const anchor = computeHunkAnchor(file('a.ts', [hunk(20, 1, [['add', 'gone']])]), 0);
    const files = [file('a.ts', [hunk(500, 1, [['add', 'different']])])];
    const n = narrative([
      {
        title: 'A',
        summary: '',
        whyMatters: '',
        risk: 'low',
        sections: [{ type: 'diff', file: 'a.ts', hunkIndex: 7, startLine: 20, endLine: 20, anchor }],
      },
    ]);
    const { narrative: out, dropped } = repairNarrative(n, files);
    expect(out.chapters[0]!.sections).toEqual([]);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]!.kind).toBe('invalid-hunk-index');
  });

  it('drops (unchanged behavior) when a broken section carries no anchor', () => {
    const files = [file('a.ts', [hunk(1, 1, [['add', 'x']])])];
    const n = narrative([
      {
        title: 'A',
        summary: '',
        whyMatters: '',
        risk: 'low',
        sections: [{ type: 'diff', file: 'a.ts', hunkIndex: 9, startLine: 1, endLine: 1 }],
      },
    ]);
    const { narrative: out, dropped } = repairNarrative(n, files);
    expect(out.chapters[0]!.sections).toEqual([]);
    expect(dropped).toHaveLength(1);
  });
});
