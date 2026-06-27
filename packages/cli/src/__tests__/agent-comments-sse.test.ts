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

type SseEvent = { event: string; data: unknown };

function parseSse(raw: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const block of raw.split('\n\n')) {
    if (!block.trim()) continue;
    let event = '';
    const data: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7);
      else if (line.startsWith('data: ')) data.push(line.slice(6));
    }
    if (event) events.push({ event, data: data.join('\n') });
  }
  return events;
}

/**
 * A stateful drainer over one reader. `pending` MUST persist across drain() calls — a
 * read left outstanding by one call would otherwise swallow the next chunk for the next call.
 */
function makeDrainer(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder();
  let pending: ReturnType<typeof reader.read> | null = null;
  return async function drain(ms = 150): Promise<SseEvent[]> {
    let text = '';
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (!pending) pending = reader.read();
      const winner = await Promise.race([
        pending.then((r) => ({ kind: 'data' as const, r })),
        new Promise<{ kind: 'timeout' }>((res) => setTimeout(() => res({ kind: 'timeout' }), 40)),
      ]);
      if (winner.kind === 'timeout') continue;
      pending = null;
      if (winner.r.done) break;
      if (winner.r.value) text += decoder.decode(winner.r.value, { stream: true });
    }
    return parseSse(text);
  };
}

const mockPr = { number: 0, title: 't', branch: 'b', base: 'main', headSha: 'x' } as unknown as PRMetadata;

describe('agent-comment SSE', () => {
  afterEach(cleanFixture);

  it('emits an agent-comment event when a comment is composed', async () => {
    const store = new AgentCommentStore('__diffdad_test__ssecomment');
    const ctx: ServerContext = {
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
      store,
    };
    const { app } = createServer(ctx);

    const ctrl = new AbortController();
    const res = await app.request('/api/events', { signal: ctrl.signal });
    const reader = res.body!.getReader();
    const drain = makeDrainer(reader);
    try {
      await drain(80); // consume the initial `connected` event

      await app.request('/api/agent-comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'a.ts', line: 1, body: 'fix' }),
      });

      const events = await drain(200);
      expect(events.some((e) => e.event === 'agent-comment')).toBe(true);
    } finally {
      ctrl.abort();
      reader.cancel().catch(() => {});
    }
  });
});
