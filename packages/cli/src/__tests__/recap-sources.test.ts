import { describe, expect, it } from 'vitest';
import { buildThreads, parseLinkedIssues } from '../recap/sources';
import type { PRComment } from '../github/types';

describe('parseLinkedIssues', () => {
  it('parses unqualified linking keywords as belonging to the PR repo', () => {
    const refs = parseLinkedIssues('Fixes #42 and closes #100', 'octocat', 'hello');
    expect(refs).toEqual([
      { owner: 'octocat', repo: 'hello', number: 42 },
      { owner: 'octocat', repo: 'hello', number: 100 },
    ]);
  });

  it('parses qualified owner/repo refs', () => {
    const refs = parseLinkedIssues('Resolves other/repo#7', 'me', 'mine');
    expect(refs).toEqual([{ owner: 'other', repo: 'repo', number: 7 }]);
  });

  it('accepts the full set of linking keywords case-insensitively', () => {
    const body = 'fix #1, Fixes #2, fixed #3, close #4, Closes #5, closed #6, Resolve #7, resolves #8, Resolved #9';
    const refs = parseLinkedIssues(body, 'a', 'b');
    expect(refs.map((r) => r.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('dedupes repeated references', () => {
    const refs = parseLinkedIssues('Fixes #1. Closes #1. Fixes a/b#1', 'me', 'mine');
    expect(refs).toEqual([
      { owner: 'me', repo: 'mine', number: 1 },
      { owner: 'a', repo: 'b', number: 1 },
    ]);
  });

  it('returns [] when nothing matches', () => {
    expect(parseLinkedIssues('See #42 (no keyword)', 'me', 'mine')).toEqual([]);
    expect(parseLinkedIssues('', 'me', 'mine')).toEqual([]);
  });

  it('does not match the keyword without an issue number', () => {
    expect(parseLinkedIssues('Fixes nothing here', 'me', 'mine')).toEqual([]);
  });
});

function mkComment(over: Partial<PRComment> & Pick<PRComment, 'id' | 'createdAt'>): PRComment {
  return {
    id: over.id,
    author: over.author ?? 'alice',
    body: over.body ?? '',
    createdAt: over.createdAt,
    updatedAt: over.updatedAt ?? over.createdAt,
    path: over.path,
    line: over.line,
    inReplyToId: over.inReplyToId,
    side: over.side,
    startLine: over.startLine,
    startSide: over.startSide,
    diffHunk: over.diffHunk,
    avatarUrl: over.avatarUrl,
  };
}

describe('buildThreads', () => {
  it('groups inline comments into threads keyed by root id', () => {
    const root = mkComment({ id: 1, createdAt: '2026-01-01T00:00:00Z', path: 'a.ts', line: 10 });
    const reply1 = mkComment({
      id: 2,
      createdAt: '2026-01-01T01:00:00Z',
      path: 'a.ts',
      line: 10,
      inReplyToId: 1,
    });
    const reply2 = mkComment({
      id: 3,
      createdAt: '2026-01-01T02:00:00Z',
      path: 'a.ts',
      line: 10,
      inReplyToId: 1,
    });
    const threads = buildThreads([reply2, root, reply1]);
    expect(threads).toHaveLength(1);
    expect(threads[0]?.rootId).toBe(1);
    expect(threads[0]?.comments.map((c) => c.id)).toEqual([1, 2, 3]);
    expect(threads[0]?.path).toBe('a.ts');
    expect(threads[0]?.line).toBe(10);
  });

  it('produces a separate thread per root comment', () => {
    const t1 = mkComment({ id: 1, createdAt: '2026-01-01T00:00:00Z', path: 'a.ts', line: 1 });
    const t2 = mkComment({ id: 5, createdAt: '2026-01-01T00:00:01Z', path: 'b.ts', line: 9 });
    const threads = buildThreads([t1, t2]);
    expect(threads).toHaveLength(2);
    expect(threads.map((t) => t.rootId).sort((a, b) => a - b)).toEqual([1, 5]);
  });

  it('ignores issue comments (no path)', () => {
    const issueLevel = mkComment({ id: 99, createdAt: '2026-01-01T00:00:00Z', body: 'general' });
    const inline = mkComment({ id: 1, createdAt: '2026-01-01T00:00:00Z', path: 'a.ts', line: 2 });
    const threads = buildThreads([issueLevel, inline]);
    expect(threads).toHaveLength(1);
    expect(threads[0]?.rootId).toBe(1);
  });

  it('sorts comments within a thread oldest-first', () => {
    const root = mkComment({ id: 1, createdAt: '2026-01-01T00:00:00Z', path: 'a.ts', line: 5 });
    const newest = mkComment({
      id: 3,
      createdAt: '2026-01-03T00:00:00Z',
      path: 'a.ts',
      line: 5,
      inReplyToId: 1,
    });
    const middle = mkComment({
      id: 2,
      createdAt: '2026-01-02T00:00:00Z',
      path: 'a.ts',
      line: 5,
      inReplyToId: 1,
    });
    const threads = buildThreads([newest, middle, root]);
    expect(threads[0]?.comments.map((c) => c.id)).toEqual([1, 2, 3]);
  });
});
