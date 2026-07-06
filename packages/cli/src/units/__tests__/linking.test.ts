import { describe, expect, it } from 'vitest';
import { classify, shouldResurface } from '../linking';
import type { PolledPr, ReviewUnit, UnitStatus } from '../types';
import type { PRMetadata } from '../../github/types';

// --- fixtures -------------------------------------------------------------

function mkMetadata(branch = 'feat/x'): PRMetadata {
  return {
    number: 0,
    title: branch,
    body: '',
    state: 'open',
    draft: false,
    author: { login: 'local', avatarUrl: '' },
    branch,
    base: 'main',
    labels: [],
    createdAt: 'now',
    updatedAt: 'now',
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    commits: 0,
    headSha: 'h',
  };
}

function mkUnit(o: Partial<ReviewUnit> & { status: UnitStatus }): ReviewUnit {
  const branch = o.metadata?.branch ?? 'feat/x';
  return {
    unitId: 'u1',
    repo: 'octo/demo',
    source: 'github',
    worktreePath: '',
    taskLabel: 'task',
    intent: '',
    uncertainties: [],
    baseRef: 'main',
    diffContentKey: 'k',
    toResolve: 0,
    files: [],
    metadata: mkMetadata(branch),
    createdAt: 'now',
    updatedAt: 'now',
    ...o,
  };
}

function mkPr(o: Partial<PolledPr> = {}): PolledPr {
  return {
    owner: 'octo',
    repo: 'demo',
    number: 42,
    title: 'Add widgets',
    headBranch: 'feat/widgets',
    headSha: 'deadbeef',
    base: 'main',
    author: 'octocat',
    url: 'https://github.com/octo/demo/pull/42',
    updatedAt: 'now',
    ...o,
  };
}

// --- classify -------------------------------------------------------------

describe('classify', () => {
  it("returns 'create' for an unseen PR (no units at all)", () => {
    expect(classify([], mkPr())).toEqual({ kind: 'create' });
  });

  it("returns 'create' when no github unit holds the polled prNumber", () => {
    const units = [
      mkUnit({ unitId: 'a', status: 'queued', repo: 'octo/demo', prNumber: 7 }),
      mkUnit({ unitId: 'b', status: 'approved', repo: 'octo/other', prNumber: 42 }),
    ];
    expect(classify(units, mkPr())).toEqual({ kind: 'create' });
  });

  it("returns 'existing-github' when a github unit already holds that prNumber", () => {
    const units = [mkUnit({ unitId: 'gh-1', status: 'queued', repo: 'octo/demo', prNumber: 42 })];
    expect(classify(units, mkPr())).toEqual({ kind: 'existing-github', unitId: 'gh-1' });
  });

  it('does not match a github unit from a different repo with the same number', () => {
    const units = [mkUnit({ unitId: 'gh-other', status: 'queued', repo: 'octo/other', prNumber: 42 })];
    expect(classify(units, mkPr())).toEqual({ kind: 'create' });
  });
});

// --- shouldResurface ------------------------------------------------------

describe('shouldResurface', () => {
  it('true for an approved github unit whose lastReviewedSha differs from the polled head', () => {
    const u = mkUnit({ status: 'approved', lastReviewedSha: 'old' });
    expect(shouldResurface(u, 'new')).toBe(true);
  });

  it('true for a changes_requested github unit whose lastReviewedSha differs', () => {
    const u = mkUnit({ status: 'changes_requested', lastReviewedSha: 'old' });
    expect(shouldResurface(u, 'new')).toBe(true);
  });

  it('false when the polled head equals lastReviewedSha (already reviewed this head)', () => {
    const u = mkUnit({ status: 'approved', lastReviewedSha: 'same' });
    expect(shouldResurface(u, 'same')).toBe(false);
  });

  it('false for a github unit that is not in a reviewed state (queued)', () => {
    const u = mkUnit({ status: 'queued', lastReviewedSha: undefined });
    expect(shouldResurface(u, 'new')).toBe(false);
  });

  it('true when lastReviewedSha is undefined and differs from a defined polled head', () => {
    const u = mkUnit({ status: 'approved', lastReviewedSha: undefined });
    expect(shouldResurface(u, 'new')).toBe(true);
  });
});
