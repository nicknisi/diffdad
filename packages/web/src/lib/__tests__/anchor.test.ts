import { describe, expect, it } from 'vitest';
import { resolveAnchor } from '../anchor';
import type { DiffFile, DiffHunk, HunkAnchor } from '../../state/types';

function hunk(newStart: number, newCount: number, contentHash?: string): DiffHunk {
  return {
    header: `@@ +${newStart},${newCount} @@`,
    oldStart: newStart,
    oldCount: 1,
    newStart,
    newCount,
    lines: [],
    contentHash,
  };
}

function file(path: string, hunks: DiffHunk[]): DiffFile {
  return { file: path, isNewFile: false, isDeleted: false, hunks };
}

const anchor: HunkAnchor = { file: 'a.ts', newStart: 20, newLines: 2, contentHash: 'abc123' };

describe('web resolveAnchor', () => {
  it('exact: hash + position match', () => {
    const files = [file('a.ts', [hunk(20, 2, 'abc123')])];
    expect(resolveAnchor(files, anchor)).toEqual({ file: files[0], hunkIndex: 0 });
  });

  it('moved hunk found by hash at a shifted index', () => {
    const files = [file('a.ts', [hunk(1, 1, 'other'), hunk(40, 2, 'abc123')])];
    const r = resolveAnchor(files, anchor);
    expect(r?.hunkIndex).toBe(1);
  });

  it('missing hash falls back to overlapping line range', () => {
    // Hunk shifted a line and its content changed, so no contentHash match; range [20,21] overlaps [21,22].
    const files = [file('a.ts', [hunk(21, 2, 'changed')])];
    expect(resolveAnchor(files, anchor)?.hunkIndex).toBe(0);
  });

  it('both hash and range fail -> null', () => {
    const files = [file('a.ts', [hunk(200, 1, 'changed')])];
    expect(resolveAnchor(files, anchor)).toBeNull();
  });

  it('named file absent -> null', () => {
    const files = [file('other.ts', [hunk(20, 2, 'abc123')])];
    expect(resolveAnchor(files, anchor)).toBeNull();
  });

  it('does not match on an undefined contentHash even if the anchor hash is also falsy-adjacent', () => {
    // A wire hunk with no contentHash must not accidentally match; only line-range can save it.
    const files = [file('a.ts', [hunk(20, 2, undefined)])];
    // range overlaps, so it resolves via the range rung, not the hash rung.
    expect(resolveAnchor(files, anchor)?.hunkIndex).toBe(0);
  });

  it('normalizes path prefixes', () => {
    const files = [file('a.ts', [hunk(20, 2, 'abc123')])];
    expect(resolveAnchor(files, { ...anchor, file: 'b/a.ts' })?.hunkIndex).toBe(0);
  });
});
