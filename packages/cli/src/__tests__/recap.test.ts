import { describe, expect, it } from 'vitest';
import { buildThreads, parseLinkedIssues, type RecapSources } from '../recap/sources';
import { buildRecapPrompt } from '../recap/prompt';
import { normalizeRecap } from '../recap/types';
import type { PRComment, PRMetadata } from '../github/types';

function pr(): PRMetadata {
  return {
    number: 42,
    title: 'Add OAuth flow',
    body: 'Implements OAuth login.\n\nFixes #100\nCloses other-org/other-repo#7',
    state: 'open',
    draft: true,
    author: { login: 'alice', avatarUrl: '' },
    branch: 'feat/oauth',
    base: 'main',
    labels: ['feature'],
    createdAt: '2026-05-01T00:00:00Z',
    updatedAt: '2026-05-04T00:00:00Z',
    additions: 200,
    deletions: 50,
    changedFiles: 6,
    commits: 8,
    headSha: 'abc1234abc1234abc1234abc1234abc1234abc12',
  };
}

describe('parseLinkedIssues', () => {
  it('extracts unqualified Fixes/Closes refs and qualifies them with the PR repo', () => {
    const out = parseLinkedIssues('Fixes #100\nCloses #200', 'me', 'mine');
    expect(out).toEqual([
      { owner: 'me', repo: 'mine', number: 100 },
      { owner: 'me', repo: 'mine', number: 200 },
    ]);
  });

  it('extracts qualified owner/repo refs', () => {
    const out = parseLinkedIssues('Closes other-org/other-repo#7', 'me', 'mine');
    expect(out).toEqual([{ owner: 'other-org', repo: 'other-repo', number: 7 }]);
  });

  it('dedupes references', () => {
    const out = parseLinkedIssues('Fixes #1\nfix #1\nclosed #1', 'a', 'b');
    expect(out).toHaveLength(1);
  });

  it('ignores plain # mentions without a linking keyword', () => {
    const out = parseLinkedIssues('See #123 for context', 'a', 'b');
    expect(out).toEqual([]);
  });
});

describe('buildThreads', () => {
  it('groups inline comments by in_reply_to_id and ignores issue comments', () => {
    const comments: PRComment[] = [
      {
        id: 1,
        author: 'reviewer',
        body: 'Why not memoize?',
        createdAt: '2026-05-02T00:00:00Z',
        updatedAt: '2026-05-02T00:00:00Z',
        path: 'src/foo.ts',
        line: 10,
      },
      {
        id: 2,
        author: 'alice',
        body: 'Tried it, perf got worse.',
        createdAt: '2026-05-02T01:00:00Z',
        updatedAt: '2026-05-02T01:00:00Z',
        path: 'src/foo.ts',
        line: 10,
        inReplyToId: 1,
      },
      {
        id: 3,
        author: 'bystander',
        body: 'Plain issue comment',
        createdAt: '2026-05-02T02:00:00Z',
        updatedAt: '2026-05-02T02:00:00Z',
      },
    ];
    const threads = buildThreads(comments);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.rootId).toBe(1);
    expect(threads[0]!.comments.map((c) => c.id)).toEqual([1, 2]);
    expect(threads[0]!.path).toBe('src/foo.ts');
    expect(threads[0]!.line).toBe(10);
  });

  it('keeps a root-only thread when there are no replies', () => {
    const comments: PRComment[] = [
      {
        id: 5,
        author: 'reviewer',
        body: 'unanswered question?',
        createdAt: '2026-05-02T00:00:00Z',
        updatedAt: '2026-05-02T00:00:00Z',
        path: 'src/bar.ts',
        line: 1,
      },
    ];
    const threads = buildThreads(comments);
    expect(threads).toHaveLength(1);
    expect(threads[0]!.comments).toHaveLength(1);
  });
});

describe('buildRecapPrompt', () => {
  function emptySources(): RecapSources {
    return {
      pr: pr(),
      files: [],
      commits: [],
      comments: [],
      reviews: [],
      checkRuns: [],
      threads: [],
      forcePushes: [],
      linkedIssues: [],
    };
  }

  it('includes PR metadata and recap-only schema fields', () => {
    const { system, user } = buildRecapPrompt(emptySources());
    expect(system).toContain('recap mode');
    expect(system).toContain('decision log');
    expect(system).toContain('mentalModel');
    expect(system).toContain('howToHelp');
    expect(system).not.toContain('verdict');
    expect(user).toContain('Add OAuth flow');
    expect(user).toContain('feat/oauth');
    expect(user).toContain('main');
  });

  it('includes commits, force-pushes, and threads when present', () => {
    const sources: RecapSources = {
      ...emptySources(),
      commits: [
        {
          sha: 'aaaaaaa1111111111111111111111111111111aa',
          message: 'try memoizing the cache',
          author: 'alice',
          authoredAt: '2026-05-02T00:00:00Z',
        },
        {
          sha: 'bbbbbbb2222222222222222222222222222222bb',
          message: 'revert: memoization made it worse',
          author: 'alice',
          authoredAt: '2026-05-02T01:00:00Z',
        },
      ],
      forcePushes: [
        {
          beforeSha: 'aaaaaaa1111111111111111111111111111111aa',
          afterSha: 'bbbbbbb2222222222222222222222222222222bb',
          actor: 'alice',
          createdAt: '2026-05-03T00:00:00Z',
        },
      ],
      threads: buildThreads([
        {
          id: 99,
          author: 'reviewer',
          body: 'Should this swallow errors?',
          createdAt: '2026-05-04T00:00:00Z',
          updatedAt: '2026-05-04T00:00:00Z',
          path: 'src/foo.ts',
          line: 12,
        },
      ]),
    };
    const { user } = buildRecapPrompt(sources);
    expect(user).toContain('aaaaaaa');
    expect(user).toContain('bbbbbbb');
    expect(user).toContain('try memoizing');
    expect(user).toContain('revert: memoization');
    expect(user).toContain('aaaaaaa -> bbbbbbb');
    expect(user).toContain('Should this swallow errors?');
    expect(user).toContain('src/foo.ts:12');
  });

  it('includes linked issues with title and body', () => {
    const sources: RecapSources = {
      ...emptySources(),
      linkedIssues: [
        {
          number: 100,
          title: 'OAuth login support',
          body: 'We need to support GitHub OAuth.',
          state: 'open',
          url: 'https://github.com/me/mine/issues/100',
        },
      ],
    };
    const { user } = buildRecapPrompt(sources);
    expect(user).toContain('Linked issues');
    expect(user).toContain('OAuth login support');
    expect(user).toContain('GitHub OAuth');
  });
});

describe('normalizeRecap', () => {
  it('returns empty arrays and strings for missing fields', () => {
    const out = normalizeRecap({});
    expect(out.goal).toBe('');
    expect(out.stateOfPlay).toEqual({ done: [], wip: [], notStarted: [] });
    expect(out.decisions).toEqual([]);
    expect(out.blockers).toEqual([]);
    expect(out.howToHelp).toEqual([]);
    expect(out.mentalModel).toEqual({ coreFiles: [], touchpoints: [], sketch: '' });
  });

  it('drops decisions without a `decision` field and clamps unknown source types', () => {
    const out = normalizeRecap({
      decisions: [
        { decision: 'Switched to GraphQL', reason: 'N+1', source: { type: 'made-up', ref: 'abc1234' } },
        { reason: 'no decision' },
      ],
    });
    expect(out.decisions).toHaveLength(1);
    expect(out.decisions[0]!.source.type).toBe('commit');
  });

  it('drops blockers without `issue` and clamps unknown blocker types', () => {
    const out = normalizeRecap({
      blockers: [
        { issue: 'CI red', evidence: 'foo.test.ts', type: 'ci' },
        { issue: 'Wat', type: 'mystery' },
        { evidence: 'no issue field' },
      ],
    });
    expect(out.blockers).toHaveLength(2);
    expect(out.blockers[0]!.type).toBe('ci');
    expect(out.blockers[1]!.type).toBe('todo');
  });
});
