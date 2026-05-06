import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitHubClient } from '../github/client';

type FetchCall = { url: string; init: RequestInit };
type Responder = (call: FetchCall) => Response | Promise<Response>;

const calls: FetchCall[] = [];
let responder: Responder = () => new Response('not configured', { status: 500 });
const realFetch = globalThis.fetch;

function setResponder(fn: Responder) {
  responder = fn;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  calls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const call: FetchCall = { url, init };
    calls.push(call);
    return responder(call);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  responder = () => new Response('not configured', { status: 500 });
});

describe('GitHubClient.getPR', () => {
  it('parses a merged PR into PRMetadata', async () => {
    setResponder(() =>
      jsonResponse({
        number: 42,
        title: 'Test PR',
        body: 'desc',
        state: 'closed',
        draft: false,
        merged: true,
        user: { login: 'octocat', avatar_url: 'https://x/y' },
        head: { ref: 'feat', sha: 'abc' },
        base: { ref: 'main' },
        labels: [{ name: 'bug' }, { name: 'enhancement' }],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
        additions: 10,
        deletions: 5,
        changed_files: 3,
        commits: 2,
      }),
    );
    const client = new GitHubClient('test-token');
    const pr = await client.getPR('owner', 'repo', 42);
    expect(pr.state).toBe('merged');
    expect(pr.headSha).toBe('abc');
    expect(pr.author.login).toBe('octocat');
    expect(pr.labels).toEqual(['bug', 'enhancement']);
    expect(calls[0]?.url).toBe('https://api.github.com/repos/owner/repo/pulls/42');
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get('Authorization')).toBe('Bearer test-token');
    expect(headers.get('Accept')).toBe('application/vnd.github+json');
  });

  it('maps state="closed" + merged=false to "closed"', async () => {
    setResponder(() =>
      jsonResponse({
        number: 1,
        title: 't',
        body: null,
        state: 'closed',
        draft: false,
        merged: false,
        user: null,
        head: { ref: 'f', sha: 'h' },
        base: { ref: 'main' },
        labels: [],
        created_at: '',
        updated_at: '',
        additions: 0,
        deletions: 0,
        changed_files: 0,
        commits: 0,
      }),
    );
    const pr = await new GitHubClient('t').getPR('o', 'r', 1);
    expect(pr.state).toBe('closed');
    expect(pr.author.login).toBe('');
    expect(pr.body).toBe('');
  });

  it('throws on non-2xx response with the body included', async () => {
    setResponder(() => new Response('not found', { status: 404 }));
    await expect(new GitHubClient('t').getPR('o', 'r', 99)).rejects.toThrow(/404/);
  });
});

describe('GitHubClient.getDiff', () => {
  it('requests the v3.diff accept header and parses the result', async () => {
    setResponder(
      () =>
        new Response(
          [
            'diff --git a/src/x.ts b/src/x.ts',
            'index 1..2 100644',
            '--- a/src/x.ts',
            '+++ b/src/x.ts',
            '@@ -1,1 +1,1 @@',
            '-old',
            '+new',
            '',
          ].join('\n'),
        ),
    );
    const files = await new GitHubClient('t').getDiff('o', 'r', 1);
    expect(files).toHaveLength(1);
    expect(files[0]?.file).toBe('src/x.ts');
    const headers = new Headers(calls[0]?.init.headers);
    expect(headers.get('Accept')).toBe('application/vnd.github.v3.diff');
  });
});

describe('GitHubClient.getComments', () => {
  it('merges review + issue comments and sorts by createdAt', async () => {
    setResponder((call) => {
      if (call.url.includes('/pulls/1/comments')) {
        return jsonResponse([
          {
            id: 200,
            user: { login: 'a', avatar_url: 'a-av' },
            body: 'inline 1',
            created_at: '2026-01-02T00:00:00Z',
            updated_at: '2026-01-02T00:00:00Z',
            path: 'a.ts',
            line: 5,
            original_line: null,
            position: null,
            side: 'RIGHT',
            start_line: null,
            original_start_line: null,
            start_side: null,
            in_reply_to_id: undefined,
            diff_hunk: '',
          },
          {
            // outdated review comment with line=null but original_line set
            id: 201,
            user: { login: 'a', avatar_url: 'a-av' },
            body: 'outdated',
            created_at: '2026-01-04T00:00:00Z',
            updated_at: '2026-01-04T00:00:00Z',
            path: 'a.ts',
            line: null,
            original_line: 7,
            position: null,
            side: 'RIGHT',
            start_line: null,
            original_start_line: null,
            start_side: null,
            diff_hunk: '',
          },
        ]);
      }
      if (call.url.includes('/issues/1/comments')) {
        return jsonResponse([
          {
            id: 100,
            user: { login: 'b', avatar_url: 'b-av' },
            body: 'general',
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
          },
        ]);
      }
      return new Response('unexpected', { status: 500 });
    });

    const comments = await new GitHubClient('t').getComments('o', 'r', 1);
    expect(comments.map((c) => c.id)).toEqual([100, 200, 201]);
    expect(comments[0]?.path).toBeUndefined(); // issue comment
    expect(comments[1]?.path).toBe('a.ts');
    expect(comments[1]?.line).toBe(5);
    expect(comments[2]?.line).toBe(7); // outdated comment falls back to original_line
  });
});

describe('GitHubClient.getReviews', () => {
  it('keeps only the latest review per user', async () => {
    setResponder(() =>
      jsonResponse([
        { id: 1, user: { login: 'alice', avatar_url: '' }, state: 'COMMENTED', submitted_at: '2026-01-01T00:00:00Z' },
        { id: 2, user: { login: 'alice', avatar_url: '' }, state: 'APPROVED', submitted_at: '2026-01-02T00:00:00Z' },
        {
          id: 3,
          user: { login: 'bob', avatar_url: '' },
          state: 'CHANGES_REQUESTED',
          submitted_at: '2026-01-03T00:00:00Z',
        },
        // unrecognized state — should be filtered
        { id: 4, user: { login: 'carol', avatar_url: '' }, state: 'WAT', submitted_at: '2026-01-04T00:00:00Z' },
        // null user — should be filtered
        { id: 5, user: null, state: 'APPROVED', submitted_at: '2026-01-05T00:00:00Z' },
      ]),
    );
    const reviews = await new GitHubClient('t').getReviews('o', 'r', 1);
    const byUser = new Map(reviews.map((r) => [r.user, r]));
    expect(byUser.get('alice')?.id).toBe(2);
    expect(byUser.get('alice')?.state).toBe('APPROVED');
    expect(byUser.get('bob')?.state).toBe('CHANGES_REQUESTED');
    expect(byUser.has('carol')).toBe(false);
    expect(reviews).toHaveLength(2);
  });
});

describe('GitHubClient.postComment', () => {
  it('posts an issue comment when no path/line is provided', async () => {
    setResponder(() =>
      jsonResponse({
        id: 1,
        user: { login: 'me', avatar_url: '' },
        body: 'hi',
        created_at: '',
        updated_at: '',
      }),
    );
    await new GitHubClient('t').postComment('o', 'r', 5, 'hi');
    expect(calls[0]?.url).toBe('https://api.github.com/repos/o/r/issues/5/comments');
    expect(calls[0]?.init.method).toBe('POST');
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body).toEqual({ body: 'hi' });
  });

  it('posts an inline review comment when path/line/commitId are provided', async () => {
    setResponder(() =>
      jsonResponse({
        id: 9,
        user: { login: 'me', avatar_url: '' },
        body: 'inline',
        created_at: '',
        updated_at: '',
        path: 'a.ts',
        line: 5,
        side: 'RIGHT',
        start_line: null,
        start_side: null,
        diff_hunk: '',
      }),
    );
    await new GitHubClient('t').postComment('o', 'r', 5, 'inline', {
      path: 'a.ts',
      line: 5,
      commitId: 'sha123',
    });
    expect(calls[0]?.url).toBe('https://api.github.com/repos/o/r/pulls/5/comments');
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body).toMatchObject({
      body: 'inline',
      commit_id: 'sha123',
      path: 'a.ts',
      line: 5,
      side: 'RIGHT',
    });
  });

  it('flips reversed start/end lines so start_line < line', async () => {
    setResponder(() =>
      jsonResponse({
        id: 1,
        user: { login: 'me', avatar_url: '' },
        body: 'r',
        created_at: '',
        updated_at: '',
        path: 'a.ts',
        line: 10,
        side: 'RIGHT',
        start_line: 5,
        start_side: 'RIGHT',
        diff_hunk: '',
      }),
    );
    await new GitHubClient('t').postComment('o', 'r', 1, 'r', {
      path: 'a.ts',
      line: 5, // reversed
      startLine: 10, // reversed
      side: 'RIGHT',
      startSide: 'LEFT',
      commitId: 'sha',
    });
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.line).toBe(10);
    expect(body.start_line).toBe(5);
    // sides should swap with their lines
    expect(body.side).toBe('LEFT');
    expect(body.start_side).toBe('RIGHT');
  });

  it('posts a reply when only inReplyToId is provided', async () => {
    setResponder(() =>
      jsonResponse({
        id: 10,
        user: { login: 'me', avatar_url: '' },
        body: 'reply',
        created_at: '',
        updated_at: '',
        path: 'a.ts',
        line: 1,
        side: 'RIGHT',
        diff_hunk: '',
      }),
    );
    await new GitHubClient('t').postComment('o', 'r', 5, 'reply', { inReplyToId: 42 });
    expect(calls[0]?.url).toBe('https://api.github.com/repos/o/r/pulls/5/comments');
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body).toEqual({ body: 'reply', in_reply_to: 42 });
  });
});

describe('GitHubClient.submitReview', () => {
  function emptyResponse() {
    return jsonResponse({});
  }

  it('forwards event + body and omits comments when none provided', async () => {
    setResponder(emptyResponse);
    await new GitHubClient('t').submitReview('o', 'r', 5, 'APPROVE', 'lgtm');
    expect(calls[0]?.url).toBe('https://api.github.com/repos/o/r/pulls/5/reviews');
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body).toEqual({ event: 'APPROVE', body: 'lgtm' });
  });

  it('drops empty body field rather than sending body=""', async () => {
    setResponder(emptyResponse);
    await new GitHubClient('t').submitReview('o', 'r', 5, 'COMMENT', '');
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.body).toBeUndefined();
  });

  it('forwards inline comments with their path/line/side', async () => {
    setResponder(emptyResponse);
    await new GitHubClient('t').submitReview('o', 'r', 5, 'REQUEST_CHANGES', 'see below', [
      { path: 'a.ts', line: 7, body: 'fix this', side: 'RIGHT' },
    ]);
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0]).toMatchObject({
      path: 'a.ts',
      line: 7,
      body: 'fix this',
      side: 'RIGHT',
    });
  });

  it('flips reversed start/end lines so start_line < line and side moves with the line', async () => {
    setResponder(emptyResponse);
    await new GitHubClient('t').submitReview('o', 'r', 5, 'COMMENT', undefined, [
      {
        path: 'a.ts',
        // reversed: end < start
        line: 5,
        startLine: 10,
        side: 'RIGHT',
        startSide: 'LEFT',
        body: 'r',
      },
    ]);
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.comments[0].line).toBe(10);
    expect(body.comments[0].start_line).toBe(5);
    // The end-side (formerly the start side) and vice versa.
    expect(body.comments[0].side).toBe('LEFT');
    expect(body.comments[0].start_side).toBe('RIGHT');
  });

  it('does not include start_line/start_side for single-line comments (start === end)', async () => {
    setResponder(emptyResponse);
    await new GitHubClient('t').submitReview('o', 'r', 5, 'COMMENT', undefined, [
      { path: 'a.ts', line: 7, startLine: 7, body: 'r', side: 'RIGHT' },
    ]);
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.comments[0].start_line).toBeUndefined();
    expect(body.comments[0].start_side).toBeUndefined();
  });

  it('omits comments array when filtered list is empty', async () => {
    setResponder(emptyResponse);
    await new GitHubClient('t').submitReview('o', 'r', 5, 'COMMENT', 'hi', []);
    const body = JSON.parse(String(calls[0]?.init.body));
    expect(body.comments).toBeUndefined();
  });
});

describe('GitHubClient.getCheckRuns', () => {
  it('maps API response to CheckRun shape', async () => {
    setResponder(() =>
      jsonResponse({
        check_runs: [
          {
            id: 1,
            name: 'lint',
            status: 'completed',
            conclusion: 'success',
            started_at: 's',
            completed_at: 'c',
            details_url: 'http://x',
            output: { title: 'OK', summary: 'all good' },
          },
        ],
      }),
    );
    const runs = await new GitHubClient('t').getCheckRuns('o', 'r', 'sha');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: 1,
      name: 'lint',
      status: 'completed',
      conclusion: 'success',
      output: { title: 'OK', summary: 'all good' },
    });
    expect(calls[0]?.url).toBe('https://api.github.com/repos/o/r/commits/sha/check-runs');
  });
});

describe('GitHubClient.getIssue', () => {
  it('returns null if the issue is actually a PR', async () => {
    setResponder(() =>
      jsonResponse({
        number: 1,
        title: 't',
        body: 'b',
        state: 'open',
        html_url: 'http://x',
        pull_request: { url: '...' },
      }),
    );
    const issue = await new GitHubClient('t').getIssue('o', 'r', 1);
    expect(issue).toBeNull();
  });

  it('returns the issue when it is a real issue', async () => {
    setResponder(() =>
      jsonResponse({
        number: 7,
        title: 'bug',
        body: 'desc',
        state: 'closed',
        html_url: 'http://x/7',
      }),
    );
    const issue = await new GitHubClient('t').getIssue('o', 'r', 7);
    expect(issue).toEqual({
      number: 7,
      title: 'bug',
      body: 'desc',
      state: 'closed',
      url: 'http://x/7',
    });
  });

  it('returns null on fetch failure', async () => {
    setResponder(() => new Response('no', { status: 500 }));
    expect(await new GitHubClient('t').getIssue('o', 'r', 1)).toBeNull();
  });
});

describe('GitHubClient.getForcePushEvents', () => {
  it('only returns head_ref_force_pushed events', async () => {
    setResponder(() =>
      jsonResponse([
        { event: 'commented', actor: { login: 'a' }, created_at: 't' },
        {
          event: 'head_ref_force_pushed',
          actor: { login: 'a' },
          created_at: '2026-01-01T00:00:00Z',
          before_commit: { sha: 'before' },
          after_commit: { sha: 'after' },
        },
      ]),
    );
    const events = await new GitHubClient('t').getForcePushEvents('o', 'r', 1);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      beforeSha: 'before',
      afterSha: 'after',
      actor: 'a',
      createdAt: '2026-01-01T00:00:00Z',
    });
  });
});
