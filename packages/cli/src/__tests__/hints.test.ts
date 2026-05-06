import { describe, expect, it } from 'vitest';
import { classifyTrivial, computeHints, formatHintsBlock } from '../narrative/hints';
import type { DiffFile, DiffHunk, DiffLine, PRComment } from '../github/types';

function line(type: DiffLine['type'], content: string, n = 1): DiffLine {
  return { type, content, lineNumber: { new: n } };
}

function hunk(lines: DiffLine[], newStart = 1, newCount = lines.length): DiffHunk {
  return { header: '@@', oldStart: 1, oldCount: 0, newStart, newCount, lines };
}

function file(path: string, hunks: DiffHunk[]): DiffFile {
  return { file: path, isNewFile: false, isDeleted: false, hunks };
}

describe('classifyTrivial', () => {
  it('returns false for substantive changes', () => {
    expect(classifyTrivial(hunk([line('add', 'function foo() {}')]))).toBe(false);
  });

  it('detects whitespace-only changes', () => {
    expect(classifyTrivial(hunk([line('add', '  '), line('remove', '\t')]))).toBe('whitespace');
  });

  it('detects imports-only changes', () => {
    expect(
      classifyTrivial(
        hunk([line('add', "import { Foo } from './foo';"), line('remove', "import { Old } from './old';")]),
      ),
    ).toBe('imports-only');
  });

  it('returns false for an empty hunk', () => {
    expect(classifyTrivial(hunk([]))).toBe(false);
  });
});

describe('computeHints', () => {
  it('flags test files', () => {
    const files = [file('src/__tests__/foo.test.ts', [hunk([line('add', 'expect(x).toBe(1)')])])];
    const hints = computeHints(files);
    expect(hints[0]?.isTestFile).toBe(true);
  });

  it('flags hunks that have inline comments in their range', () => {
    const files = [file('src/foo.ts', [hunk([line('add', 'const x = 1', 5)], 5, 3)])];
    const comments: PRComment[] = [
      {
        id: 1,
        author: 'a',
        body: 'hmm',
        createdAt: '',
        updatedAt: '',
        path: 'src/foo.ts',
        line: 6,
      },
    ];
    const hints = computeHints(files, comments);
    expect(hints[0]?.hasInlineComment).toBe(true);
  });

  it('does not flag inline comments outside the hunk range', () => {
    const files = [file('src/foo.ts', [hunk([line('add', 'const x = 1', 5)], 5, 1)])];
    const comments: PRComment[] = [
      { id: 1, author: 'a', body: '', createdAt: '', updatedAt: '', path: 'src/foo.ts', line: 99 },
    ];
    const hints = computeHints(files, comments);
    expect(hints[0]?.hasInlineComment).toBeUndefined();
  });

  it('flags imports-only hunks as trivial', () => {
    const files = [file('src/foo.ts', [hunk([line('add', "import x from 'y';")])])];
    const hints = computeHints(files);
    expect(hints[0]?.isTrivial).toBe('imports-only');
  });

  it('emits one entry per hunk preserving file order', () => {
    const files = [
      file('a.ts', [hunk([line('add', 'a')]), hunk([line('add', 'b')])]),
      file('b.ts', [hunk([line('add', 'c')])]),
    ];
    const hints = computeHints(files);
    expect(hints).toHaveLength(3);
    expect(hints[0]?.file).toBe('a.ts');
    expect(hints[2]?.file).toBe('b.ts');
  });
});

describe('formatHintsBlock', () => {
  it('returns empty string when nothing is interesting', () => {
    expect(formatHintsBlock([{ file: 'a.ts', hunkIndex: 0 }])).toBe('');
  });

  it('formats hot-zone, test, and trivial tags', () => {
    const out = formatHintsBlock([
      { file: 'a.ts', hunkIndex: 0, hasInlineComment: true },
      { file: 'b.spec.ts', hunkIndex: 1, isTestFile: true },
      { file: 'c.ts', hunkIndex: 2, isTrivial: 'imports-only' },
    ]);
    expect(out).toContain('hot-zone');
    expect(out).toContain('test');
    expect(out).toContain('trivial=imports-only');
  });
});
