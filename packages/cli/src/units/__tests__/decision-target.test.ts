import { describe, expect, it } from 'vitest';
import { decisionTarget } from '../decision-target';
import type { ReviewUnit, UnitSource } from '../types';
import type { PRMetadata } from '../../github/types';

function mkMetadata(): PRMetadata {
  return {
    number: 0,
    title: 'feat/x',
    body: '',
    state: 'open',
    draft: false,
    author: { login: 'local', avatarUrl: '' },
    branch: 'feat/x',
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

function mkUnit(source: UnitSource): ReviewUnit {
  return {
    unitId: 'u1',
    repo: 'octo/demo',
    source,
    worktreePath: '/tmp/wt',
    taskLabel: 'task',
    intent: '',
    uncertainties: [],
    baseRef: 'main',
    diffContentKey: 'k',
    status: 'queued',
    toResolve: 0,
    files: [],
    metadata: mkMetadata(),
    createdAt: 'now',
    updatedAt: 'now',
  };
}

describe('decisionTarget', () => {
  it("routes a github unit's verdict to GitHub", () => {
    expect(decisionTarget(mkUnit('github'))).toBe('github');
  });

  it('routes agent and cli verdicts to the decision channel', () => {
    expect(decisionTarget(mkUnit('agent'))).toBe('channel');
    expect(decisionTarget(mkUnit('cli'))).toBe('channel');
  });
});
