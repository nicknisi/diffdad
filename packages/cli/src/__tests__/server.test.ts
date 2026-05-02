import { describe, it, expect } from 'vitest';
import { createServer, diffPosition, positionToLine } from '../server';
import type { NarrativeResponse } from '../narrative/types';
import type { DiffFile, PRMetadata } from '../github/types';

const mockNarrative: NarrativeResponse = {
  title: 'Test PR',
  chapters: [
    {
      title: 'Add feature',
      summary: 'Adds a new feature',
      risk: 'low',
      sections: [
        { type: 'narrative', content: 'This adds a feature.' },
        { type: 'diff', file: 'src/index.ts', startLine: 1, endLine: 5, hunkIndex: 0 },
      ],
    },
  ],
};

const mockPR: PRMetadata = {
  number: 1,
  title: 'Test PR',
  body: '',
  state: 'open',
  draft: false,
  author: { login: 'test', avatarUrl: '' },
  branch: 'feat',
  base: 'main',
  labels: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  additions: 10,
  deletions: 2,
  changedFiles: 1,
  commits: 1,
  headSha: 'abc123',
};

// Fixture: one file with two hunks — covers headers, removes, and add/context lines.
//
// Positions in the file diff:
//   1  = hunk 1 header  (@@ -10,3 +10,4 @@)
//   2  = context  old=10 new=10
//   3  = remove   old=11        (LEFT side only)
//   4  = add             new=11
//   5  = context  old=12 new=12
//   6  = hunk 2 header  (@@ -20,2 +21,2 @@)
//   7  = context  old=20 new=21
//   8  = add             new=22
const diffFiles: DiffFile[] = [
  {
    file: 'src/foo.ts',
    isNewFile: false,
    isDeleted: false,
    hunks: [
      {
        header: '@@ -10,3 +10,4 @@',
        oldStart: 10,
        oldCount: 3,
        newStart: 10,
        newCount: 4,
        lines: [
          { type: 'context', content: 'a', lineNumber: { old: 10, new: 10 } },
          { type: 'remove', content: 'b', lineNumber: { old: 11 } },
          { type: 'add', content: 'c', lineNumber: { new: 11 } },
          { type: 'context', content: 'd', lineNumber: { old: 12, new: 12 } },
        ],
      },
      {
        header: '@@ -20,2 +21,2 @@',
        oldStart: 20,
        oldCount: 2,
        newStart: 21,
        newCount: 2,
        lines: [
          { type: 'context', content: 'e', lineNumber: { old: 20, new: 21 } },
          { type: 'add', content: 'f', lineNumber: { new: 22 } },
        ],
      },
    ],
  },
];

describe('diffPosition / positionToLine inverse', () => {
  // ── positionToLine ────────────────────────────────────────────────────────
  it('returns undefined for a hunk-header position (not a code line)', () => {
    expect(positionToLine(diffFiles, 'src/foo.ts', 1)).toBeUndefined(); // hunk 1 header
    expect(positionToLine(diffFiles, 'src/foo.ts', 6)).toBeUndefined(); // hunk 2 header
  });

  it('returns LEFT side + old line for a remove-only line', () => {
    expect(positionToLine(diffFiles, 'src/foo.ts', 3)).toEqual({ line: 11, side: 'LEFT' });
  });

  it('returns new-side line for context and add lines', () => {
    expect(positionToLine(diffFiles, 'src/foo.ts', 2)).toEqual({ line: 10 }); // context old=10,new=10
    expect(positionToLine(diffFiles, 'src/foo.ts', 4)).toEqual({ line: 11 }); // add new=11
    expect(positionToLine(diffFiles, 'src/foo.ts', 5)).toEqual({ line: 12 }); // context new=12
    expect(positionToLine(diffFiles, 'src/foo.ts', 7)).toEqual({ line: 21 }); // context new=21
    expect(positionToLine(diffFiles, 'src/foo.ts', 8)).toEqual({ line: 22 }); // add new=22
  });

  it('returns undefined for out-of-range position', () => {
    expect(positionToLine(diffFiles, 'src/foo.ts', 99)).toBeUndefined();
    expect(positionToLine(diffFiles, 'missing.ts', 1)).toBeUndefined();
  });

  // ── diffPosition ─────────────────────────────────────────────────────────
  it('resolves a remove-only line with side=LEFT', () => {
    expect(diffPosition(diffFiles, 'src/foo.ts', 11, 'LEFT')).toBe(3);
  });

  it('resolves context and add lines on the RIGHT side', () => {
    expect(diffPosition(diffFiles, 'src/foo.ts', 10)).toBe(2);
    expect(diffPosition(diffFiles, 'src/foo.ts', 11)).toBe(4); // add, not the remove
    expect(diffPosition(diffFiles, 'src/foo.ts', 12)).toBe(5);
    expect(diffPosition(diffFiles, 'src/foo.ts', 21)).toBe(7);
    expect(diffPosition(diffFiles, 'src/foo.ts', 22)).toBe(8);
  });

  it('returns undefined for a line not present in the diff', () => {
    expect(diffPosition(diffFiles, 'src/foo.ts', 99)).toBeUndefined();
    expect(diffPosition(diffFiles, 'missing.ts', 10)).toBeUndefined();
  });

  // ── roundtrip: positionToLine ∘ diffPosition = identity ──────────────────
  it('diffPosition(positionToLine(p)) === p for remove lines', () => {
    const resolved = positionToLine(diffFiles, 'src/foo.ts', 3)!;
    expect(diffPosition(diffFiles, 'src/foo.ts', resolved.line, resolved.side)).toBe(3);
  });

  it('diffPosition(positionToLine(p)) === p for add/context lines', () => {
    for (const pos of [2, 4, 5, 7, 8]) {
      const resolved = positionToLine(diffFiles, 'src/foo.ts', pos)!;
      expect(diffPosition(diffFiles, 'src/foo.ts', resolved.line, resolved.side)).toBe(pos);
    }
  });

  // ── roundtrip: positionToLine ∘ diffPosition = identity ──────────────────
  it('positionToLine(diffPosition(line, LEFT)).line === line for remove lines', () => {
    const pos = diffPosition(diffFiles, 'src/foo.ts', 11, 'LEFT')!;
    expect(positionToLine(diffFiles, 'src/foo.ts', pos)).toEqual({ line: 11, side: 'LEFT' });
  });

  it('positionToLine(diffPosition(line)).line === line for add/context lines', () => {
    for (const line of [10, 11, 12, 21, 22]) {
      const pos = diffPosition(diffFiles, 'src/foo.ts', line)!;
      expect(positionToLine(diffFiles, 'src/foo.ts', pos)?.line).toBe(line);
    }
  });
});

describe('server', () => {
  it('serves narrative at /api/narrative', async () => {
    const { app } = createServer({
      narrative: mockNarrative,
      pr: mockPR,
      sourceType: 'pr',
      files: [],
      comments: [],
      checkRuns: [],
      reviews: [],
      github: {} as any,
      owner: 'test',
      repo: 'test',
      headSha: 'abc123',
    });
    const res = await app.request('/api/narrative');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.narrative.title).toBe('Test PR');
    expect(data.narrative.chapters).toHaveLength(1);
  });
});
