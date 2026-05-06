import { describe, expect, it } from 'vitest';
import { createServer, type ServerContext } from '../server';
import type { NarrativeResponse } from '../narrative/types';
import type { CheckRun, DiffFile, PRComment, PRMetadata } from '../github/types';
import type { GitHubClient, PostCommentOptions } from '../github/client';

const mockNarrative: NarrativeResponse = {
  title: 'Test PR',
  tldr: 'Adds a feature.',
  verdict: 'safe',
  readingPlan: [{ step: 'Start at chapter 1.', chapterIndex: 0 }],
  concerns: [],
  chapters: [
    {
      title: 'Add feature',
      summary: 'Adds a new feature',
      whyMatters: 'Without this the user cannot do X.',
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

const mockFiles: DiffFile[] = [
  {
    file: 'src/index.ts',
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
        ],
      },
    ],
  },
];

type StubGitHub = Partial<GitHubClient> & {
  postCommentCalls: { args: unknown[]; opts?: PostCommentOptions }[];
  submitReviewCalls: unknown[][];
  postCommentResponse?: PRComment;
};

function createStubGithub(overrides: Partial<StubGitHub> = {}): StubGitHub {
  const stub: StubGitHub = {
    postCommentCalls: [],
    submitReviewCalls: [],
    postCommentResponse: {
      id: 999,
      author: 'me',
      body: 'posted',
      createdAt: '',
      updatedAt: '',
    },
    ...overrides,
  };
  stub.postComment = (async (owner: string, repo: string, number: number, body: string, opts?: PostCommentOptions) => {
    stub.postCommentCalls.push({ args: [owner, repo, number, body], opts });
    return {
      ...(stub.postCommentResponse as PRComment),
      body,
    };
  }) as GitHubClient['postComment'];
  stub.submitReview = (async (...args: unknown[]) => {
    stub.submitReviewCalls.push(args);
  }) as unknown as GitHubClient['submitReview'];
  return stub;
}

function buildContext(overrides: Partial<ServerContext> = {}): ServerContext {
  const github = createStubGithub();
  return {
    narrative: mockNarrative,
    pr: mockPR,
    files: mockFiles,
    comments: [],
    checkRuns: [],
    reviews: [],
    github: github as unknown as GitHubClient,
    owner: 'test',
    repo: 'test',
    headSha: 'abc123',
    ...overrides,
  };
}

describe('GET /api/narrative', () => {
  it('returns the full narrative when ready', async () => {
    const { app } = createServer(buildContext());
    const res = await app.request('/api/narrative');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.narrative.title).toBe('Test PR');
    expect(data.narrative.chapters).toHaveLength(1);
    expect(data.repoUrl).toBe('https://github.com/test/test');
    expect(data.config).toMatchObject({
      theme: 'auto',
      storyStructure: 'chapters',
      layoutMode: 'toc',
    });
  });

  it('returns generating=true when narrative is still in progress', async () => {
    const { app } = createServer(buildContext({ narrative: null }));
    const res = await app.request('/api/narrative');
    const data = (await res.json()) as { generating: boolean; narrative?: unknown };
    expect(data.generating).toBe(true);
    expect(data.narrative).toBeUndefined();
  });

  it('annotates inline comments with chapterIndices', async () => {
    const inline: PRComment = {
      id: 1,
      author: 'a',
      body: 'q',
      createdAt: '',
      updatedAt: '',
      path: 'src/index.ts',
      line: 1,
    };
    const { app } = createServer(buildContext({ comments: [inline] }));
    const res = await app.request('/api/narrative');
    const data = (await res.json()) as { comments: { id: number; chapterIndices: number[] }[] };
    expect(data.comments[0]?.chapterIndices).toEqual([0]);
  });
});

describe('GET /api/recap', () => {
  it('returns idle when no recap and no error', async () => {
    const { app } = createServer(buildContext());
    const res = await app.request('/api/recap');
    expect(await res.json()).toEqual({ status: 'idle' });
  });

  it('returns ready with recap when present', async () => {
    const { app } = createServer(
      buildContext({
        recap: {
          goal: 'g',
          stateOfPlay: { done: [], wip: [], notStarted: [] },
          decisions: [],
          blockers: [],
          mentalModel: { coreFiles: [], touchpoints: [], sketch: '' },
          howToHelp: [],
        },
      }),
    );
    const res = await app.request('/api/recap');
    const body = (await res.json()) as { status: string; recap: { goal: string } };
    expect(body.status).toBe('ready');
    expect(body.recap.goal).toBe('g');
  });

  it('returns generating when in flight', async () => {
    const { app } = createServer(buildContext({ recapGenerating: true }));
    expect(await (await app.request('/api/recap')).json()).toEqual({ status: 'generating' });
  });

  it('returns error when last attempt failed', async () => {
    const { app } = createServer(buildContext({ recapError: 'boom' }));
    expect(await (await app.request('/api/recap')).json()).toEqual({ status: 'error', error: 'boom' });
  });
});

describe('POST /api/comments', () => {
  it('rejects missing body with 400', async () => {
    const ctx = buildContext();
    const { app } = createServer(ctx);
    const res = await app.request('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect((ctx.github as unknown as StubGitHub).postCommentCalls).toHaveLength(0);
  });

  it('rejects malformed JSON with 400', async () => {
    const { app } = createServer(buildContext());
    const res = await app.request('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
  });

  it('posts an issue comment when no path/line is given', async () => {
    const ctx = buildContext();
    const { app } = createServer(ctx);
    const res = await app.request('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'general thought' }),
    });
    expect(res.status).toBe(201);
    const stub = ctx.github as unknown as StubGitHub;
    expect(stub.postCommentCalls).toHaveLength(1);
    expect(stub.postCommentCalls[0]?.opts).toBeUndefined();
  });

  it('posts an inline comment with the head SHA when path/line are given', async () => {
    const ctx = buildContext();
    const { app } = createServer(ctx);
    await app.request('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'inline', path: 'src/index.ts', line: 2 }),
    });
    const stub = ctx.github as unknown as StubGitHub;
    expect(stub.postCommentCalls[0]?.opts).toMatchObject({
      path: 'src/index.ts',
      line: 2,
      side: 'RIGHT',
      commitId: 'abc123',
    });
  });

  it('appends posted comment to ctx.comments', async () => {
    const ctx = buildContext();
    const { app } = createServer(ctx);
    expect(ctx.comments).toHaveLength(0);
    await app.request('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'hi' }),
    });
    expect(ctx.comments).toHaveLength(1);
  });
});

describe('POST /api/review', () => {
  it('rejects an unknown event with 400', async () => {
    const { app } = createServer(buildContext());
    const res = await app.request('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'merge_it' }),
    });
    expect(res.status).toBe(400);
  });

  it('maps event names and forwards to submitReview', async () => {
    const ctx = buildContext();
    const { app } = createServer(ctx);
    const res = await app.request('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'approve',
        body: 'lgtm',
        comments: [{ path: 'src/index.ts', line: 2, body: 'nit' }],
      }),
    });
    expect(res.status).toBe(200);
    const stub = ctx.github as unknown as StubGitHub;
    expect(stub.submitReviewCalls).toHaveLength(1);
    expect(stub.submitReviewCalls[0]?.[3]).toBe('APPROVE');
  });

  it('returns 422 when GitHub rejects self-approval', async () => {
    const ctx = buildContext({
      github: {
        ...createStubGithub(),
        submitReview: (async () => {
          throw new Error('Can not approve your own pull request');
        }) as unknown as GitHubClient['submitReview'],
      } as unknown as GitHubClient,
    });
    const { app } = createServer(ctx);
    const res = await app.request('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'approve' }),
    });
    expect(res.status).toBe(422);
  });

  it('rejects malformed JSON with 400', async () => {
    const { app } = createServer(buildContext());
    const res = await app.request('/api/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{nope',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/ai', () => {
  it('rejects unknown action with 400', async () => {
    const { app } = createServer(buildContext());
    const res = await app.request('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'mystery', chapterIndex: 0 }),
    });
    expect(res.status).toBe(400);
    const data = (await res.json()) as { error: string };
    expect(data.error).toBe('unknown action');
  });

  it('rejects missing chapterIndex on ask action with 400', async () => {
    const { app } = createServer(buildContext());
    const res = await app.request('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ask', question: 'why?' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects ask with no question', async () => {
    const { app } = createServer(buildContext());
    const res = await app.request('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ask', chapterIndex: 0 }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects renarrate with no lens', async () => {
    const { app } = createServer(buildContext());
    const res = await app.request('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'renarrate', chapterIndex: 0 }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 503 when narrative is still generating and action requires it', async () => {
    const { app } = createServer(buildContext({ narrative: null }));
    const res = await app.request('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ask', chapterIndex: 0, question: 'why?' }),
    });
    expect(res.status).toBe(503);
  });

  it('returns 400 for an invalid chapter index', async () => {
    const { app } = createServer(buildContext());
    const res = await app.request('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'ask', chapterIndex: 99, question: 'q' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects malformed JSON with 400', async () => {
    const { app } = createServer(buildContext());
    const res = await app.request('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad',
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/checks and /api/comments', () => {
  it('GET /api/checks calls the github client with the head SHA', async () => {
    const calls: string[] = [];
    const stub = {
      ...createStubGithub(),
      getCheckRuns: (async (_owner: string, _repo: string, sha: string): Promise<CheckRun[]> => {
        calls.push(sha);
        return [];
      }) as unknown as GitHubClient['getCheckRuns'],
    };
    const ctx = buildContext({ github: stub as unknown as GitHubClient });
    const { app } = createServer(ctx);
    const res = await app.request('/api/checks');
    expect(res.status).toBe(200);
    expect(calls).toEqual(['abc123']);
  });

  it('GET /api/comments returns mapped comments when narrative is ready', async () => {
    const inline: PRComment = {
      id: 1,
      author: 'a',
      body: 'q',
      createdAt: '',
      updatedAt: '',
      path: 'src/index.ts',
      line: 1,
    };
    const stub = {
      ...createStubGithub(),
      getComments: (async () => [inline]) as unknown as GitHubClient['getComments'],
    };
    const ctx = buildContext({ github: stub as unknown as GitHubClient });
    const { app } = createServer(ctx);
    const res = await app.request('/api/comments');
    expect(res.status).toBe(200);
    const data = (await res.json()) as Array<PRComment & { chapterIndices?: number[] }>;
    expect(data[0]?.chapterIndices).toEqual([0]);
  });

  it('GET /api/comments returns raw comments when narrative is not ready', async () => {
    const inline: PRComment = {
      id: 1,
      author: 'a',
      body: 'q',
      createdAt: '',
      updatedAt: '',
      path: 'src/index.ts',
      line: 1,
    };
    const stub = {
      ...createStubGithub(),
      getComments: (async () => [inline]) as unknown as GitHubClient['getComments'],
    };
    const ctx = buildContext({
      narrative: null,
      github: stub as unknown as GitHubClient,
    });
    const { app } = createServer(ctx);
    const res = await app.request('/api/comments');
    const data = (await res.json()) as Array<PRComment & { chapterIndices?: number[] }>;
    // Raw comments don't have chapterIndices.
    expect(data[0]?.chapterIndices).toBeUndefined();
  });
});
