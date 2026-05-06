import { describe, expect, it } from 'vitest';
import { buildRecapPrompt } from '../recap/prompt';
import type { RecapSources } from '../recap/sources';
import type { CheckRun, DiffFile, ForcePushEvent, IssueRef, PRCommit, PRMetadata, PRReview } from '../github/types';

function mkPR(over: Partial<PRMetadata> = {}): PRMetadata {
  return {
    number: 42,
    title: 'Add feature X',
    body: 'Fixes #1\n\nAdds feature X to the system.',
    state: 'open',
    draft: false,
    author: { login: 'octocat', avatarUrl: '' },
    branch: 'feat',
    base: 'main',
    labels: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    commits: 0,
    headSha: 'abc',
    ...over,
  };
}

function mkSources(over: Partial<RecapSources> = {}): RecapSources {
  return {
    pr: mkPR(),
    files: [],
    commits: [],
    comments: [],
    reviews: [],
    checkRuns: [],
    threads: [],
    forcePushes: [],
    linkedIssues: [],
    ...over,
  };
}

describe('buildRecapPrompt', () => {
  it('produces a system prompt that pins the schema and operating principles', () => {
    const { system } = buildRecapPrompt(mkSources());
    expect(system).toContain('recap mode');
    expect(system).toContain("Orient, don't audit");
    expect(system).toContain('"goal"');
    expect(system).toContain('"stateOfPlay"');
    expect(system).toContain('"decisions"');
    expect(system).toContain('"blockers"');
    expect(system).toContain('"mentalModel"');
    expect(system).toContain('"howToHelp"');
  });

  it('includes basic PR metadata', () => {
    const { user } = buildRecapPrompt(mkSources({ pr: mkPR({ title: 'My PR', branch: 'feat-x', base: 'main' }) }));
    expect(user).toContain('My PR');
    expect(user).toContain('#42');
    expect(user).toContain('feat-x → main');
    expect(user).toContain('@octocat');
  });

  it('marks the PR as draft when draft=true', () => {
    const { user } = buildRecapPrompt(mkSources({ pr: mkPR({ draft: true }) }));
    expect(user).toContain('(draft)');
  });

  it('falls back to "(no description)" when body is empty', () => {
    const { user } = buildRecapPrompt(mkSources({ pr: mkPR({ body: '   ' }) }));
    expect(user).toContain('(no description)');
  });

  it('truncates very long PR bodies', () => {
    const longBody = 'Q'.repeat(8000);
    const { user } = buildRecapPrompt(
      mkSources({ pr: mkPR({ body: longBody, title: 'plain title', author: { login: 'me', avatarUrl: '' } }) }),
    );
    // body is truncated at 4000 chars in the prompt
    const qCount = (user.match(/Q/g) ?? []).length;
    expect(qCount).toBeLessThanOrEqual(4000);
    expect(qCount).toBeGreaterThan(3500);
  });

  it('lists linked issues with their state and a truncated body', () => {
    const linkedIssues: IssueRef[] = [
      {
        number: 7,
        title: 'Bug: thing breaks',
        body: 'Y'.repeat(5000),
        state: 'open',
        url: 'https://x/7',
      },
    ];
    const { user } = buildRecapPrompt(mkSources({ linkedIssues }));
    expect(user).toContain('Linked issues:');
    expect(user).toContain('#7 Bug: thing breaks (open)');
    // Linked issue body capped to 2000 chars
    const ys = (user.match(/Y/g) ?? []).length;
    expect(ys).toBeLessThanOrEqual(2000);
  });

  it('caps commits at the 80-commit budget and notes the omission', () => {
    const commits: PRCommit[] = Array.from({ length: 100 }, (_, i) => ({
      sha: i.toString().padStart(7, '0'),
      message: `commit ${i}`,
      author: 'me',
      authoredAt: '2026-01-01T00:00:00Z',
    }));
    const { user } = buildRecapPrompt(mkSources({ commits }));
    expect(user).toContain('commit 0');
    expect(user).toContain('commit 79');
    expect(user).not.toContain('commit 80');
    expect(user).toContain('20 earlier commits omitted');
  });

  it('emits "(no commits)" when commits is empty', () => {
    const { user } = buildRecapPrompt(mkSources());
    expect(user).toContain('(no commits)');
  });

  it('summarizes force pushes with before/after sha7', () => {
    const forcePushes: ForcePushEvent[] = [
      {
        beforeSha: 'aaaaaaa1111111',
        afterSha: 'bbbbbbb2222222',
        actor: 'octocat',
        createdAt: '2026-01-02T00:00:00Z',
      },
    ];
    const { user } = buildRecapPrompt(mkSources({ forcePushes }));
    expect(user).toContain('Force-pushes (1)');
    expect(user).toContain('aaaaaaa -> bbbbbbb');
    expect(user).toContain('@octocat');
  });

  it('handles initial / unknown force-push commits gracefully', () => {
    const forcePushes: ForcePushEvent[] = [
      { beforeSha: null, afterSha: null, actor: '', createdAt: '2026-01-02T00:00:00Z' },
    ];
    const { user } = buildRecapPrompt(mkSources({ forcePushes }));
    expect(user).toContain('(initial) -> (unknown)');
    expect(user).toContain('@unknown');
  });

  it('reports failing checks with their output title and summary', () => {
    const checkRuns: CheckRun[] = [
      {
        id: 1,
        name: 'lint',
        status: 'completed',
        conclusion: 'success',
        startedAt: null,
        completedAt: null,
        detailsUrl: null,
        output: {},
      },
      {
        id: 2,
        name: 'test',
        status: 'completed',
        conclusion: 'failure',
        startedAt: null,
        completedAt: null,
        detailsUrl: null,
        output: { title: 'tests failed', summary: '3 failures in foo.test.ts' },
      },
      {
        id: 3,
        name: 'build',
        status: 'in_progress',
        conclusion: null,
        startedAt: null,
        completedAt: null,
        detailsUrl: null,
        output: {},
      },
    ];
    const { user } = buildRecapPrompt(mkSources({ checkRuns }));
    expect(user).toContain('lint: success');
    expect(user).toContain('test: failure');
    expect(user).toContain('tests failed');
    expect(user).toContain('3 failures in foo.test.ts');
    // In-progress checks show their status, not a conclusion.
    expect(user).toContain('build: in_progress');
  });

  it('summarizes file changes with new/deleted tags and add/del counts', () => {
    const files: DiffFile[] = [
      {
        file: 'src/new.ts',
        isNewFile: true,
        isDeleted: false,
        hunks: [
          {
            header: '@@ -0,0 +1,2 @@',
            oldStart: 0,
            oldCount: 0,
            newStart: 1,
            newCount: 2,
            lines: [
              { type: 'add', content: 'a', lineNumber: { new: 1 } },
              { type: 'add', content: 'b', lineNumber: { new: 2 } },
            ],
          },
        ],
      },
      {
        file: 'src/old.ts',
        isNewFile: false,
        isDeleted: true,
        hunks: [
          {
            header: '@@ -1,1 +0,0 @@',
            oldStart: 1,
            oldCount: 1,
            newStart: 0,
            newCount: 0,
            lines: [{ type: 'remove', content: 'gone', lineNumber: { old: 1 } }],
          },
        ],
      },
    ];
    const { user } = buildRecapPrompt(mkSources({ files }));
    expect(user).toContain('src/new.ts [new]  +2 -0');
    expect(user).toContain('src/old.ts [deleted]  +0 -1');
  });

  it('listing reviews only when there is at least one', () => {
    const withReview: PRReview[] = [
      {
        id: 1,
        user: 'alice',
        avatarUrl: '',
        state: 'APPROVED',
        submittedAt: '2026-01-01T00:00:00Z',
      },
    ];
    const withoutReview = buildRecapPrompt(mkSources()).user;
    const withReviewUser = buildRecapPrompt(mkSources({ reviews: withReview })).user;
    expect(withoutReview).not.toContain('Reviews (latest per user)');
    expect(withReviewUser).toContain('Reviews (latest per user)');
    expect(withReviewUser).toContain('@alice: APPROVED');
  });
});
