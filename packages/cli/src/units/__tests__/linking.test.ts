import { describe, expect, it } from 'vitest';
import { classify, shouldResurface } from '../linking';
import type { PolledPr, ReviewUnit, UnitSource, UnitStatus } from '../types';
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

function mkUnit(o: Partial<ReviewUnit> & { source: UnitSource; status: UnitStatus }): ReviewUnit {
  const branch = o.metadata?.branch ?? 'feat/x';
  return {
    unitId: 'u1',
    repo: 'octo/demo',
    worktreePath: '/tmp/wt',
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

  it("returns 'create' when no unit matches repo+branch and no github unit holds the prNumber", () => {
    const units = [
      mkUnit({
        unitId: 'a',
        source: 'agent',
        status: 'reviewing',
        repo: 'octo/other',
        metadata: mkMetadata('feat/widgets'),
      }),
      mkUnit({
        unitId: 'b',
        source: 'agent',
        status: 'reviewing',
        repo: 'octo/demo',
        metadata: mkMetadata('different-branch'),
      }),
    ];
    expect(classify(units, mkPr())).toEqual({ kind: 'create' });
  });

  it("returns 'link' when an agent unit matches repo+headBranch with no prNumber yet", () => {
    const units = [
      mkUnit({
        unitId: 'agent-1',
        source: 'agent',
        status: 'reviewing',
        repo: 'octo/demo',
        metadata: mkMetadata('feat/widgets'),
      }),
    ];
    expect(classify(units, mkPr())).toEqual({ kind: 'link', unitId: 'agent-1' });
  });

  it("returns 'link' for a cli unit matching repo+headBranch with no prNumber", () => {
    const units = [
      mkUnit({
        unitId: 'cli-1',
        source: 'cli',
        status: 'queued',
        repo: 'octo/demo',
        metadata: mkMetadata('feat/widgets'),
      }),
    ];
    expect(classify(units, mkPr())).toEqual({ kind: 'link', unitId: 'cli-1' });
  });

  it('does NOT link an agent/cli unit that already has a prNumber for a DIFFERENT pr (falls through to create)', () => {
    const units = [
      mkUnit({
        unitId: 'agent-1',
        source: 'agent',
        status: 'reviewing',
        repo: 'octo/demo',
        metadata: mkMetadata('feat/widgets'),
        prNumber: 7, // already linked to some OTHER PR → not eligible for a fresh link
      }),
    ];
    expect(classify(units, mkPr())).toEqual({ kind: 'create' });
  });

  it("returns 'existing-github' for an already-LINKED agent/cli unit (prNumber matches), not 'create' (no duplicate)", () => {
    // After the poller links a PR onto an agent unit, source stays 'agent' but prNumber is set.
    // The next poll of the SAME PR must recognise it as already-tracked, not mint a duplicate.
    const units = [
      mkUnit({
        unitId: 'agent-1',
        source: 'agent',
        status: 'reviewing',
        repo: 'octo/demo',
        metadata: mkMetadata('feat/widgets'),
        prNumber: 42, // linked to THIS pr already
      }),
    ];
    expect(classify(units, mkPr())).toEqual({ kind: 'existing-github', unitId: 'agent-1' });
  });

  it("returns 'existing-github' when a github unit already holds that prNumber", () => {
    const units = [
      mkUnit({
        unitId: 'gh-1',
        source: 'github',
        status: 'queued',
        repo: 'octo/demo',
        metadata: mkMetadata('feat/widgets'),
        prNumber: 42,
      }),
    ];
    expect(classify(units, mkPr())).toEqual({ kind: 'existing-github', unitId: 'gh-1' });
  });

  it("prefers 'existing-github' over 'link' when both a github match and a branch match exist", () => {
    const units = [
      mkUnit({
        unitId: 'agent-1',
        source: 'agent',
        status: 'reviewing',
        repo: 'octo/demo',
        metadata: mkMetadata('feat/widgets'),
      }),
      mkUnit({
        unitId: 'gh-1',
        source: 'github',
        status: 'approved',
        repo: 'octo/demo',
        metadata: mkMetadata('feat/widgets'),
        prNumber: 42,
      }),
    ];
    expect(classify(units, mkPr())).toEqual({ kind: 'existing-github', unitId: 'gh-1' });
  });

  it('does not match a github unit from a different repo with the same number', () => {
    const units = [
      mkUnit({
        unitId: 'gh-other',
        source: 'github',
        status: 'queued',
        repo: 'octo/other',
        metadata: mkMetadata('feat/widgets'),
        prNumber: 42,
      }),
    ];
    expect(classify(units, mkPr())).toEqual({ kind: 'create' });
  });
});

// --- shouldResurface ------------------------------------------------------

describe('shouldResurface', () => {
  it('true for an approved github unit whose lastReviewedSha differs from the polled head', () => {
    const u = mkUnit({ source: 'github', status: 'approved', lastReviewedSha: 'old' });
    expect(shouldResurface(u, 'new')).toBe(true);
  });

  it('true for a changes_requested github unit whose lastReviewedSha differs', () => {
    const u = mkUnit({ source: 'github', status: 'changes_requested', lastReviewedSha: 'old' });
    expect(shouldResurface(u, 'new')).toBe(true);
  });

  it('false when the polled head equals lastReviewedSha (already reviewed this head)', () => {
    const u = mkUnit({ source: 'github', status: 'approved', lastReviewedSha: 'same' });
    expect(shouldResurface(u, 'same')).toBe(false);
  });

  it('false for a non-github unit even if reviewed against a different sha', () => {
    const u = mkUnit({ source: 'agent', status: 'approved', lastReviewedSha: 'old' });
    expect(shouldResurface(u, 'new')).toBe(false);
  });

  it('false for a github unit that is not in a reviewed state (queued)', () => {
    const u = mkUnit({ source: 'github', status: 'queued', lastReviewedSha: undefined });
    expect(shouldResurface(u, 'new')).toBe(false);
  });

  it('true when lastReviewedSha is undefined and differs from a defined polled head', () => {
    const u = mkUnit({ source: 'github', status: 'approved', lastReviewedSha: undefined });
    expect(shouldResurface(u, 'new')).toBe(true);
  });
});
