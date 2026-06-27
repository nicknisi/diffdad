import { readdir, rm } from 'fs/promises';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentCommentStore } from '../agent-comments/store';
import { dataDir } from '../paths';
import { createServer, type ServerContext } from '../server';
import type { PRMetadata } from '../github/types';

const STORE_DIR = join(dataDir(), 'agent-comments');

async function cleanFixture() {
  try {
    for (const e of await readdir(STORE_DIR)) {
      if (e.startsWith('__diffdad_test__')) await rm(join(STORE_DIR, e), { force: true });
    }
  } catch {
    /* dir may not exist */
  }
}

const mockPr = { number: 0, title: 't', branch: 'b', base: 'main', headSha: 'x' } as unknown as PRMetadata;

function watchContext(): ServerContext {
  return {
    narrative: null,
    pr: mockPr,
    files: [],
    comments: [],
    checkRuns: [],
    reviews: [],
    github: null,
    owner: 'local',
    repo: 'repo',
    headSha: 'x',
    store: new AgentCommentStore('__diffdad_test__routes'),
  };
}

describe('agent-comment routes', () => {
  afterEach(cleanFixture);

  it('POST then GET round-trips a comment', async () => {
    const { app } = createServer(watchContext());

    const empty = await app.request('/api/agent-comments');
    expect(await empty.json()).toEqual([]);

    const created = await app.request('/api/agent-comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'src/a.ts', line: 12, body: 'extract this guard' }),
    });
    expect(created.status).toBe(201);
    const comment = (await created.json()) as { id: string; status: string; author: string };
    expect(comment).toMatchObject({ status: 'open', author: 'user' });

    const list = await app.request('/api/agent-comments');
    const all = (await list.json()) as { id: string }[];
    expect(all).toHaveLength(1);
    expect(all[0]!.id).toBe(comment.id);
  });

  it('threads a reply under the parent when inReplyToId is given', async () => {
    const { app } = createServer(watchContext());
    const created = await app.request('/api/agent-comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'a.ts', line: 1, body: 'parent' }),
    });
    const id = ((await created.json()) as { id: string }).id;

    const reply = await app.request('/api/agent-comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inReplyToId: id, body: 'child' }),
    });
    expect(reply.status).toBe(201);

    const list = (await (await app.request('/api/agent-comments')).json()) as {
      replies: { author: string; body: string }[];
    }[];
    expect(list).toHaveLength(1); // one top-level comment, not two
    expect(list[0]!.replies).toHaveLength(1);
    expect(list[0]!.replies[0]).toMatchObject({ author: 'user', body: 'child' });
  });

  it('404s a reply to an unknown comment id', async () => {
    const { app } = createServer(watchContext());
    const res = await app.request('/api/agent-comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inReplyToId: 'nope', body: 'x' }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects a comment missing body or path/line', async () => {
    const { app } = createServer(watchContext());
    const noBody = await app.request('/api/agent-comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'a.ts', line: 1 }),
    });
    expect(noBody.status).toBe(400);
    const noPath = await app.request('/api/agent-comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'hi' }),
    });
    expect(noPath.status).toBe(400);
  });

  it('returns 409 for GitHub routes in watch mode', async () => {
    const { app } = createServer(watchContext());
    const post = await app.request('/api/comments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'x' }),
    });
    expect(post.status).toBe(409);
    const checks = await app.request('/api/checks');
    expect(await checks.json()).toEqual([]);
  });
});
