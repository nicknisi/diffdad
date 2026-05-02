import { describe, expect, it, vi } from 'vitest';
import { createServer, resolveCommitCommentLines } from '../server';
import type { CommitMetadata, DiffFile, PRComment, PRMetadata } from '../github/types';
import type { NarrativeResponse } from '../narrative/types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Single-hunk file. Diff positions (1-based, GitHub's commit comment API):
 *   1  →  hunk header          → resolves to newStart (1)
 *   2  →  context line 1       → new: 1, old: 1
 *   3  →  add    line 2        → new: 2
 *   4  →  context line 3       → new: 3, old: 2
 *   5  →  context line 4       → new: 4, old: 3
 */
const singleHunkFile: DiffFile = {
  file: 'src/foo.ts',
  isNewFile: false,
  isDeleted: false,
  hunks: [
    {
      header: '@@ -1,3 +1,4 @@',
      oldStart: 1,
      oldCount: 3,
      newStart: 1,
      newCount: 4,
      lines: [
        { type: 'context', content: 'a', lineNumber: { old: 1, new: 1 } },
        { type: 'add', content: 'b', lineNumber: { new: 2 } },
        { type: 'context', content: 'c', lineNumber: { old: 2, new: 3 } },
        { type: 'context', content: 'd', lineNumber: { old: 3, new: 4 } },
      ],
    },
  ],
};

/**
 * Two-hunk file. Diff positions:
 *   1  →  hunk[0] header       → resolves to newStart (1)
 *   2  →  context line         → new: 1, old: 1
 *   3  →  remove line          → old: 2   (no new-side number)
 *   4  →  hunk[1] header       → resolves to newStart (9)
 *   5  →  context line         → new: 9,  old: 10
 *   6  →  add    line          → new: 10
 *   7  →  context line         → new: 11, old: 11
 */
const multiHunkFile: DiffFile = {
  file: 'src/bar.ts',
  isNewFile: false,
  isDeleted: false,
  hunks: [
    {
      header: '@@ -1,2 +1,1 @@',
      oldStart: 1,
      oldCount: 2,
      newStart: 1,
      newCount: 1,
      lines: [
        { type: 'context', content: 'a', lineNumber: { old: 1, new: 1 } },
        { type: 'remove', content: 'b', lineNumber: { old: 2 } },
      ],
    },
    {
      header: '@@ -10,2 +9,3 @@',
      oldStart: 10,
      oldCount: 2,
      newStart: 9,
      newCount: 3,
      lines: [
        { type: 'context', content: 'c', lineNumber: { old: 10, new: 9 } },
        { type: 'add', content: 'd', lineNumber: { new: 10 } },
        { type: 'context', content: 'e', lineNumber: { old: 11, new: 11 } },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// resolveCommitCommentLines
// ---------------------------------------------------------------------------

describe('resolveCommitCommentLines', () => {
  it('fills in line for a comment that has position but no line', () => {
    const comments: PRComment[] = [
      { id: 1, author: 'user', body: 'x', createdAt: '', updatedAt: '', path: 'src/foo.ts', position: 3 },
    ];
    const result = resolveCommitCommentLines(comments, [singleHunkFile]);
    expect(result[0]?.line).toBe(2); // pos 3 → add line → new: 2
  });

  it('does not change a comment that already has a line', () => {
    const comments: PRComment[] = [
      { id: 1, author: 'user', body: 'x', createdAt: '', updatedAt: '', path: 'src/foo.ts', position: 3, line: 99 },
    ];
    const result = resolveCommitCommentLines(comments, [singleHunkFile]);
    expect(result[0]?.line).toBe(99);
  });

  it('does not touch a top-level comment (no path)', () => {
    const comments: PRComment[] = [{ id: 1, author: 'user', body: 'x', createdAt: '', updatedAt: '', position: 3 }];
    const result = resolveCommitCommentLines(comments, [singleHunkFile]);
    expect(result[0]?.line).toBeUndefined();
  });

  it('does not touch a comment with no position', () => {
    const comments: PRComment[] = [
      { id: 1, author: 'user', body: 'x', createdAt: '', updatedAt: '', path: 'src/foo.ts' },
    ];
    const result = resolveCommitCommentLines(comments, [singleHunkFile]);
    expect(result[0]?.line).toBeUndefined();
  });

  it('resolves a position that points at the hunk header to hunk.newStart', () => {
    const comments: PRComment[] = [
      { id: 1, author: 'user', body: 'x', createdAt: '', updatedAt: '', path: 'src/foo.ts', position: 1 },
    ];
    const result = resolveCommitCommentLines(comments, [singleHunkFile]);
    expect(result[0]?.line).toBe(1); // hunk header → newStart = 1
  });

  it('resolves the second hunk header position to that hunk newStart', () => {
    const comments: PRComment[] = [
      { id: 1, author: 'user', body: 'x', createdAt: '', updatedAt: '', path: 'src/bar.ts', position: 4 },
    ];
    const result = resolveCommitCommentLines(comments, [multiHunkFile]);
    expect(result[0]?.line).toBe(9); // second hunk header → newStart = 9
  });

  it('resolves positions across multiple hunks', () => {
    const comments: PRComment[] = [
      { id: 1, author: 'user', body: 'x', createdAt: '', updatedAt: '', path: 'src/bar.ts', position: 5 },
      { id: 2, author: 'user', body: 'y', createdAt: '', updatedAt: '', path: 'src/bar.ts', position: 6 },
    ];
    const result = resolveCommitCommentLines(comments, [multiHunkFile]);
    expect(result[0]?.line).toBe(9); // pos 5 → hunk[1].lines[0] → new: 9
    expect(result[1]?.line).toBe(10); // pos 6 → hunk[1].lines[1] → new: 10
  });

  it('falls back to the old-side line number for remove-only lines', () => {
    const comments: PRComment[] = [
      { id: 1, author: 'user', body: 'x', createdAt: '', updatedAt: '', path: 'src/bar.ts', position: 3 },
    ];
    const result = resolveCommitCommentLines(comments, [multiHunkFile]);
    expect(result[0]?.line).toBe(2); // pos 3 → remove line → lineNumber.old: 2
  });

  it('matches comment paths after stripping a/ b/ diff prefixes', () => {
    const comments: PRComment[] = [
      { id: 1, author: 'user', body: 'x', createdAt: '', updatedAt: '', path: 'src/foo.ts', position: 3 },
    ];
    const fileWithPrefix: DiffFile = { ...singleHunkFile, file: 'b/src/foo.ts' };
    const result = resolveCommitCommentLines(comments, [fileWithPrefix]);
    expect(result[0]?.line).toBe(2);
  });

  it('does not add line when the position is out of range', () => {
    const comments: PRComment[] = [
      { id: 1, author: 'user', body: 'x', createdAt: '', updatedAt: '', path: 'src/foo.ts', position: 999 },
    ];
    const result = resolveCommitCommentLines(comments, [singleHunkFile]);
    expect(result[0]?.line).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Server route helpers
// ---------------------------------------------------------------------------

const mockNarrative: NarrativeResponse = { title: 'Test commit', chapters: [] };

const mockCommit: CommitMetadata = {
  sha: 'abc123def456abc123def456abc123def456abc1',
  shortSha: 'abc123d',
  subject: 'test commit',
  body: '',
  author: { login: 'user', avatarUrl: '', name: 'User', date: '2026-01-01T00:00:00Z' },
  additions: 4,
  deletions: 0,
  changedFiles: 1,
};

const mockCommitPR: PRMetadata = {
  number: 0,
  title: 'test commit',
  body: '',
  state: 'merged',
  draft: false,
  author: { login: 'user', avatarUrl: '' },
  branch: 'abc123d',
  base: '',
  labels: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  additions: 4,
  deletions: 0,
  changedFiles: 1,
  commits: 1,
  headSha: 'abc123def456abc123def456abc123def456abc1',
};

function makeCommitApp(githubOverrides: Record<string, unknown> = {}, files: DiffFile[] = [singleHunkFile]) {
  return createServer({
    narrative: mockNarrative,
    pr: mockCommitPR,
    commit: mockCommit,
    sourceType: 'commit',
    files,
    comments: [],
    checkRuns: [],
    reviews: [],
    github: githubOverrides as any,
    owner: 'owner',
    repo: 'repo',
    headSha: 'abc123def456abc123def456abc123def456abc1',
  }).app;
}

// ---------------------------------------------------------------------------
// POST /api/review — blocked in commit mode
// ---------------------------------------------------------------------------

describe('POST /api/review in commit mode', () => {
  it('returns 400 with an explanatory error message', async () => {
    const app = makeCommitApp();
    const res = await app.request('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'approve' }),
    });
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/not available for commits/i);
  });
});

// ---------------------------------------------------------------------------
// POST /api/comments — commit mode submit behaviour
// ---------------------------------------------------------------------------

describe('POST /api/comments in commit mode', () => {
  it('translates a new-side line number to a diff position when calling postCommitComment', async () => {
    const postCommitComment = vi.fn().mockResolvedValue({
      id: 42,
      author: 'user',
      body: 'nice',
      createdAt: '',
      updatedAt: '',
      path: 'src/foo.ts',
      position: 3,
    });
    const app = makeCommitApp({ postCommitComment });

    const res = await app.request('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'nice', path: 'src/foo.ts', line: 2 }),
    });

    expect(res.status).toBe(201);
    expect(postCommitComment).toHaveBeenCalledWith(
      'owner',
      'repo',
      'abc123def456abc123def456abc123def456abc1',
      'nice',
      { path: 'src/foo.ts', position: 3 }, // new-side line 2 → diff position 3
    );
  });

  it('back-fills line on the response when GitHub returns line: null', async () => {
    // GitHub's commit comment API returns line: null when the comment was posted
    // via `position`. The server must resolve it so the frontend can render inline.
    const postCommitComment = vi.fn().mockResolvedValue({
      id: 42,
      author: 'user',
      body: 'nice',
      createdAt: '',
      updatedAt: '',
      path: 'src/foo.ts',
      position: 3,
      line: undefined, // GitHub omits / nulls this
    });
    const app = makeCommitApp({ postCommitComment });

    const res = await app.request('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'nice', path: 'src/foo.ts', line: 2 }),
    });

    const data = await res.json();
    expect(data.line).toBe(2); // resolved back from position 3 → new-side line 2
  });

  it('posts a top-level commit comment with no path or position', async () => {
    const postCommitComment = vi.fn().mockResolvedValue({
      id: 43,
      author: 'user',
      body: 'lgtm',
      createdAt: '',
      updatedAt: '',
    });
    const app = makeCommitApp({ postCommitComment });

    const res = await app.request('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'lgtm' }),
    });

    expect(res.status).toBe(201);
    expect(postCommitComment).toHaveBeenCalledWith(
      'owner',
      'repo',
      'abc123def456abc123def456abc123def456abc1',
      'lgtm',
      {}, // no path/position for a top-level comment
    );
  });

  it('omits position from the call when the line is not found in the diff', async () => {
    const postCommitComment = vi.fn().mockResolvedValue({
      id: 44,
      author: 'user',
      body: 'comment',
      createdAt: '',
      updatedAt: '',
    });
    const app = makeCommitApp({ postCommitComment });

    const res = await app.request('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'comment', path: 'src/foo.ts', line: 999 }),
    });

    expect(res.status).toBe(201);
    expect(postCommitComment).toHaveBeenCalledWith(
      'owner',
      'repo',
      'abc123def456abc123def456abc123def456abc1',
      'comment',
      {}, // line 999 not in diff → no position → empty opts
    );
  });
});
