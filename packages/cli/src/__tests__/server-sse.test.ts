import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type ServerContext } from '../server';
import type { NarrativeResponse } from '../narrative/types';
import type { CheckRun, DiffFile, PRComment, PRMetadata, PRReview } from '../github/types';
import type { GitHubClient } from '../github/client';

// SSE stream helpers ----------------------------------------------------------

type SseEvent = { event: string; data: unknown };

function parseSseChunk(raw: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const block of raw.split('\n\n')) {
    if (!block.trim()) continue;
    let event = '';
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice('event: '.length);
      else if (line.startsWith('data: ')) dataLines.push(line.slice('data: '.length));
    }
    if (event) {
      const dataStr = dataLines.join('\n');
      let data: unknown = dataStr;
      try {
        data = JSON.parse(dataStr);
      } catch {
        // leave as string
      }
      events.push({ event, data });
    }
  }
  return events;
}

class StreamReader {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private decoder = new TextDecoder();
  private buffer = '';
  /** A read() that timed out — we MUST not call read() again until this one resolves or is consumed. */
  private pendingRead: ReturnType<ReadableStreamDefaultReader<Uint8Array>['read']> | null = null;
  private closed = false;
  events: SseEvent[] = [];

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }

  /** Drain any chunks currently waiting in the queue. Resolves quickly. */
  async drain(timeoutMs = 50): Promise<SseEvent[] | 'closed'> {
    const newEvents: SseEvent[] = [];
    while (!this.closed) {
      if (!this.pendingRead) this.pendingRead = this.reader.read();
      const winner = await Promise.race([
        this.pendingRead.then((r) => ({ kind: 'data' as const, value: r })),
        new Promise<{ kind: 'timeout' }>((res) => setTimeout(() => res({ kind: 'timeout' }), timeoutMs)),
      ]);
      if (winner.kind === 'timeout') break;
      // Consume the resolved read.
      this.pendingRead = null;
      const r = winner.value;
      if (r.done) {
        this.closed = true;
        const flushed = parseSseChunk(this.buffer);
        newEvents.push(...flushed);
        this.events.push(...flushed);
        this.buffer = '';
        return 'closed';
      }
      this.buffer += this.decoder.decode(r.value, { stream: true });
      const lastBoundary = this.buffer.lastIndexOf('\n\n');
      if (lastBoundary !== -1) {
        const complete = this.buffer.slice(0, lastBoundary + 2);
        this.buffer = this.buffer.slice(lastBoundary + 2);
        const parsed = parseSseChunk(complete);
        newEvents.push(...parsed);
        this.events.push(...parsed);
      }
    }
    return newEvents;
  }

  async cancel(): Promise<void> {
    try {
      await this.reader.cancel();
    } catch {
      // ignore
    }
  }
}

// Fixtures --------------------------------------------------------------------

const baseNarrative: NarrativeResponse = {
  title: 'PR title',
  tldr: 'tldr',
  verdict: 'safe',
  readingPlan: [],
  concerns: [],
  chapters: [
    {
      title: 'C1',
      summary: 's',
      whyMatters: 'w',
      risk: 'low',
      sections: [{ type: 'diff', file: 'a.ts', startLine: 1, endLine: 3, hunkIndex: 0 }],
    },
  ],
};

function mkPR(over: Partial<PRMetadata> = {}): PRMetadata {
  return {
    number: 1,
    title: 'PR',
    body: '',
    state: 'open',
    draft: false,
    author: { login: 'me', avatarUrl: '' },
    branch: 'feat',
    base: 'main',
    labels: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    commits: 0,
    headSha: 'sha-A',
    ...over,
  };
}

function mkContext(over: Partial<ServerContext> = {}): ServerContext {
  return {
    narrative: baseNarrative,
    pr: mkPR(),
    files: [],
    comments: [],
    checkRuns: [],
    reviews: [],
    github: {} as GitHubClient,
    owner: 'o',
    repo: 'r',
    headSha: 'sha-A',
    ...over,
  };
}

type GhStub = {
  getPR: (...args: unknown[]) => Promise<PRMetadata>;
  getComments: (...args: unknown[]) => Promise<PRComment[]>;
  getCheckRuns: (...args: unknown[]) => Promise<CheckRun[]>;
  getReviews: (...args: unknown[]) => Promise<PRReview[]>;
  getDiff: (...args: unknown[]) => Promise<DiffFile[]>;
};

function defaultGh(state: {
  pr: PRMetadata;
  comments?: PRComment[];
  checks?: CheckRun[];
  reviews?: PRReview[];
  files?: DiffFile[];
}): GhStub {
  return {
    getPR: async () => state.pr,
    getComments: async () => state.comments ?? [],
    getCheckRuns: async () => state.checks ?? [],
    getReviews: async () => state.reviews ?? [],
    getDiff: async () => state.files ?? [],
  };
}

// Timer mocking ---------------------------------------------------------------

let capturedIntervalCb: (() => void | Promise<void>) | null;
let realSetInterval: typeof setInterval;
let realSetTimeout: typeof setTimeout;
let realClearInterval: typeof clearInterval;
let realClearTimeout: typeof clearTimeout;

beforeEach(() => {
  capturedIntervalCb = null;
  realSetInterval = globalThis.setInterval;
  realSetTimeout = globalThis.setTimeout;
  realClearInterval = globalThis.clearInterval;
  realClearTimeout = globalThis.clearTimeout;

  // Capture the polling interval callback. Return a stable handle so
  // clearInterval doesn't error.
  const fakeHandle = { __fake: true } as unknown as ReturnType<typeof setInterval>;
  globalThis.setInterval = ((fn: () => void | Promise<void>) => {
    capturedIntervalCb = fn;
    return fakeHandle;
  }) as typeof setInterval;
  globalThis.clearInterval = ((handle: unknown) => {
    if (handle === fakeHandle) capturedIntervalCb = null;
    else realClearInterval(handle as ReturnType<typeof setInterval>);
  }) as typeof clearInterval;

  // Stop the 30s exit timer (and the 500ms post-joke exit) from ever
  // calling process.exit during the test run. Other setTimeouts (used by
  // our drain helper) must still work, so only no-op long delays.
  globalThis.setTimeout = ((fn: () => void, ms?: number, ...args: unknown[]) => {
    if (typeof ms === 'number' && ms >= 500) {
      // long-delay timer (exit timer or its inner exit) — never fire it
      return { __fake: true } as unknown as ReturnType<typeof setTimeout>;
    }
    return realSetTimeout(fn, ms, ...args);
  }) as typeof setTimeout;
});

afterEach(() => {
  globalThis.setInterval = realSetInterval;
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearInterval = realClearInterval;
  globalThis.clearTimeout = realClearTimeout;
  capturedIntervalCb = null;
});

async function runPoll(): Promise<void> {
  expect(capturedIntervalCb).not.toBeNull();
  await capturedIntervalCb!();
}

// Tests -----------------------------------------------------------------------

describe('GET /api/events — initial connection', () => {
  it('emits a "connected" event immediately', async () => {
    const ctx = mkContext({ github: defaultGh({ pr: mkPR() }) as unknown as GitHubClient });
    const { app } = createServer(ctx);
    const ctrl = new AbortController();
    const res = await app.request('/api/events', { signal: ctrl.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');

    const reader = new StreamReader(res.body!);
    const events = (await reader.drain()) as SseEvent[];
    expect(events.find((e) => e.event === 'connected')).toBeTruthy();
    ctrl.abort();
    await reader.cancel();
  });

  it('replays in-flight narrative-progress when a client reconnects mid-generation', async () => {
    const ctx = mkContext({ github: defaultGh({ pr: mkPR() }) as unknown as GitHubClient });
    const { app, broadcast } = createServer(ctx);

    // Simulate progress having accumulated before the client connected.
    broadcast('narrative-progress', { chars: 1234 });

    const ctrl = new AbortController();
    const res = await app.request('/api/events', { signal: ctrl.signal });
    const reader = new StreamReader(res.body!);
    const events = (await reader.drain()) as SseEvent[];
    const progress = events.find((e) => e.event === 'narrative-progress');
    expect(progress).toBeDefined();
    expect((progress!.data as { chars: number }).chars).toBe(1234);

    ctrl.abort();
    await reader.cancel();
  });

  it('forwards broadcast events to all connected clients', async () => {
    const ctx = mkContext({ github: defaultGh({ pr: mkPR() }) as unknown as GitHubClient });
    const { app, broadcast } = createServer(ctx);

    const ctrl = new AbortController();
    const res = await app.request('/api/events', { signal: ctrl.signal });
    const reader = new StreamReader(res.body!);
    await reader.drain(); // consume connected

    broadcast('comment', { id: 1, body: 'hi' });
    const events = (await reader.drain()) as SseEvent[];
    expect(events.find((e) => e.event === 'comment')).toBeDefined();

    ctrl.abort();
    await reader.cancel();
  });
});

describe('GET /api/events — polling cycle', () => {
  it('emits "comments" when new comments appear', async () => {
    const state = {
      pr: mkPR(),
      comments: [] as PRComment[],
      checks: [] as CheckRun[],
      reviews: [] as PRReview[],
    };
    const ctx = mkContext({ github: defaultGh(state) as unknown as GitHubClient });
    const { app } = createServer(ctx);
    const ctrl = new AbortController();
    const res = await app.request('/api/events', { signal: ctrl.signal });
    const reader = new StreamReader(res.body!);
    await reader.drain();

    state.comments = [{ id: 7, author: 'alice', body: 'new', createdAt: '', updatedAt: '' }];
    await runPoll();
    const events = (await reader.drain()) as SseEvent[];
    const c = events.find((e) => e.event === 'comments');
    expect(c).toBeDefined();
    expect((c!.data as PRComment[])[0]?.id).toBe(7);

    ctrl.abort();
    await reader.cancel();
  });

  it('emits "comments" when an existing comment is deleted', async () => {
    const existing: PRComment = { id: 5, author: 'a', body: 'old', createdAt: '', updatedAt: '' };
    const state = {
      pr: mkPR(),
      comments: [existing],
    };
    const ctx = mkContext({
      github: defaultGh(state) as unknown as GitHubClient,
      comments: [existing],
    });
    const { app } = createServer(ctx);
    const ctrl = new AbortController();
    const res = await app.request('/api/events', { signal: ctrl.signal });
    const reader = new StreamReader(res.body!);
    await reader.drain();

    state.comments = []; // deleted
    await runPoll();
    const events = (await reader.drain()) as SseEvent[];
    expect(events.find((e) => e.event === 'comments')).toBeDefined();

    ctrl.abort();
    await reader.cancel();
  });

  it('does NOT emit "comments" when the comment set is unchanged', async () => {
    const c: PRComment = { id: 1, author: 'a', body: 'b', createdAt: '', updatedAt: '' };
    const state = { pr: mkPR(), comments: [c] };
    const ctx = mkContext({
      github: defaultGh(state) as unknown as GitHubClient,
      comments: [c],
    });
    const { app } = createServer(ctx);
    const ctrl = new AbortController();
    const res = await app.request('/api/events', { signal: ctrl.signal });
    const reader = new StreamReader(res.body!);
    await reader.drain();

    await runPoll();
    const events = (await reader.drain()) as SseEvent[];
    expect(events.find((e) => e.event === 'comments')).toBeUndefined();
    // Still emits checks + reviews unconditionally
    expect(events.find((e) => e.event === 'checks')).toBeDefined();
    expect(events.find((e) => e.event === 'reviews')).toBeDefined();

    ctrl.abort();
    await reader.cancel();
  });

  it('emits "pr" when PR metadata changes without a SHA change', async () => {
    const state = { pr: mkPR({ draft: true }) };
    const ctx = mkContext({
      pr: mkPR({ draft: false }),
      github: defaultGh(state) as unknown as GitHubClient,
    });
    const { app } = createServer(ctx);
    const ctrl = new AbortController();
    const res = await app.request('/api/events', { signal: ctrl.signal });
    const reader = new StreamReader(res.body!);
    await reader.drain();

    await runPoll();
    const events = (await reader.drain()) as SseEvent[];
    const prEvt = events.find((e) => e.event === 'pr');
    expect(prEvt).toBeDefined();
    expect((prEvt!.data as { draft: boolean }).draft).toBe(true);

    ctrl.abort();
    await reader.cancel();
  });

  it('does NOT emit "pr" when only the SHA changed (regeneration handles it)', async () => {
    const { cacheNarrative, computePromptMetaHash } = await import('../narrative/cache');
    const { resolveProviderKey } = await import('../narrative/engine');
    const { readConfig } = await import('../config');
    const providerKey = await resolveProviderKey(await readConfig());
    const newSha = `sha-shaonly-${Date.now()}`;
    const freshPr = mkPR({ headSha: newSha });
    const metaHash = computePromptMetaHash(freshPr);
    // Pre-seed cache so regen doesn't call out to a real LLM.
    await cacheNarrative('o', 'r', 1, newSha, metaHash, providerKey, baseNarrative);

    const state = { pr: freshPr };
    const ctx = mkContext({
      headSha: 'sha-A',
      pr: mkPR({ headSha: 'sha-A' }),
      github: defaultGh(state) as unknown as GitHubClient,
    });
    const { app } = createServer(ctx);
    const ctrl = new AbortController();
    const res = await app.request('/api/events', { signal: ctrl.signal });
    const reader = new StreamReader(res.body!);
    await reader.drain();

    await runPoll();
    await new Promise((r) => setTimeout(r, 30));
    const events = (await reader.drain(80)) as SseEvent[];
    expect(events.find((e) => e.event === 'pr')).toBeUndefined();
    expect(events.find((e) => e.event === 'regenerating')).toBeDefined();

    ctrl.abort();
    await reader.cancel();

    const { rm } = await import('fs/promises');
    const { homedir } = await import('os');
    const { join } = await import('path');
    await rm(join(homedir(), '.cache', 'diffdad', `o-r-1-${newSha}-${metaHash}.v3.${providerKey}.json`), {
      force: true,
    }).catch(() => {});
  });

  it('regenerates when only PR title changed (SHA unchanged)', async () => {
    const { cacheNarrative, computePromptMetaHash } = await import('../narrative/cache');
    const { resolveProviderKey } = await import('../narrative/engine');
    const { readConfig } = await import('../config');
    const providerKey = await resolveProviderKey(await readConfig());
    const sha = `sha-titleonly-${Date.now()}`;
    const editedPr = mkPR({ headSha: sha, title: 'Edited title' });
    const newMetaHash = computePromptMetaHash(editedPr);
    // Pre-seed cache for the *new* title so regen finds a hit instead of calling the LLM.
    await cacheNarrative('o', 'r', 1, sha, newMetaHash, providerKey, { ...baseNarrative, title: 'after edit' });

    const state = { pr: editedPr };
    const ctx = mkContext({
      headSha: sha,
      pr: mkPR({ headSha: sha, title: 'Original title' }),
      github: defaultGh(state) as unknown as GitHubClient,
    });
    const { app } = createServer(ctx);
    const ctrl = new AbortController();
    const res = await app.request('/api/events', { signal: ctrl.signal });
    const reader = new StreamReader(res.body!);
    await reader.drain();

    await runPoll();
    await new Promise((r) => setTimeout(r, 30));
    const events = (await reader.drain(80)) as SseEvent[];
    expect(events.find((e) => e.event === 'regenerating')).toBeDefined();
    // No standalone 'pr' event — the regen path's 'narrative' broadcast carries the fresh PR.
    expect(events.find((e) => e.event === 'pr')).toBeUndefined();
    const narrEvt = events.find((e) => e.event === 'narrative');
    expect(narrEvt).toBeDefined();
    expect((narrEvt!.data as { narrative: { title: string } }).narrative.title).toBe('after edit');
    expect(ctx.pr.title).toBe('Edited title');

    ctrl.abort();
    await reader.cancel();

    const { rm } = await import('fs/promises');
    const { homedir } = await import('os');
    const { join } = await import('path');
    await rm(join(homedir(), '.cache', 'diffdad', `o-r-1-${sha}-${newMetaHash}.v3.${providerKey}.json`), {
      force: true,
    }).catch(() => {});
  });

  it('regenerates when only PR body changed (SHA unchanged)', async () => {
    const { cacheNarrative, computePromptMetaHash } = await import('../narrative/cache');
    const { resolveProviderKey } = await import('../narrative/engine');
    const { readConfig } = await import('../config');
    const providerKey = await resolveProviderKey(await readConfig());
    const sha = `sha-bodyonly-${Date.now()}`;
    const editedPr = mkPR({ headSha: sha, body: 'New description with detail' });
    const newMetaHash = computePromptMetaHash(editedPr);
    await cacheNarrative('o', 'r', 1, sha, newMetaHash, providerKey, { ...baseNarrative, title: 'after body edit' });

    const state = { pr: editedPr };
    const ctx = mkContext({
      headSha: sha,
      pr: mkPR({ headSha: sha, body: '' }),
      github: defaultGh(state) as unknown as GitHubClient,
    });
    const { app } = createServer(ctx);
    const ctrl = new AbortController();
    const res = await app.request('/api/events', { signal: ctrl.signal });
    const reader = new StreamReader(res.body!);
    await reader.drain();

    await runPoll();
    await new Promise((r) => setTimeout(r, 30));
    const events = (await reader.drain(80)) as SseEvent[];
    expect(events.find((e) => e.event === 'regenerating')).toBeDefined();
    const narrEvt = events.find((e) => e.event === 'narrative');
    expect(narrEvt).toBeDefined();
    expect((narrEvt!.data as { narrative: { title: string } }).narrative.title).toBe('after body edit');
    expect(ctx.pr.body).toBe('New description with detail');

    ctrl.abort();
    await reader.cancel();

    const { rm } = await import('fs/promises');
    const { homedir } = await import('os');
    const { join } = await import('path');
    await rm(join(homedir(), '.cache', 'diffdad', `o-r-1-${sha}-${newMetaHash}.v3.${providerKey}.json`), {
      force: true,
    }).catch(() => {});
  });

  it('on SHA change with a cached narrative, broadcasts "narrative" without re-generating', async () => {
    // Pre-seed cache so the regenerate path uses it.
    const { cacheNarrative, computePromptMetaHash } = await import('../narrative/cache');
    const { resolveProviderKey } = await import('../narrative/engine');
    const { readConfig } = await import('../config');
    const providerKey = await resolveProviderKey(await readConfig());
    const sha = `sha-fresh-${Date.now()}`;
    const freshPr = mkPR({ headSha: sha });
    const metaHash = computePromptMetaHash(freshPr);
    await cacheNarrative('o', 'r', 1, sha, metaHash, providerKey, {
      ...baseNarrative,
      title: 'cached title',
    });

    const state = {
      pr: freshPr,
    };
    const ctx = mkContext({
      headSha: 'sha-A',
      pr: mkPR({ headSha: 'sha-A' }),
      github: defaultGh(state) as unknown as GitHubClient,
    });
    const { app } = createServer(ctx);
    const ctrl = new AbortController();
    const res = await app.request('/api/events', { signal: ctrl.signal });
    const reader = new StreamReader(res.body!);
    await reader.drain();

    await runPoll();
    // Give the regen path a tick to run getDiff + cache lookup (all async).
    await new Promise((r) => setTimeout(r, 30));
    const events = (await reader.drain(80)) as SseEvent[];
    expect(events.find((e) => e.event === 'regenerating')).toBeDefined();
    const narrEvt = events.find((e) => e.event === 'narrative');
    expect(narrEvt).toBeDefined();
    expect((narrEvt!.data as { narrative: { title: string } }).narrative.title).toBe('cached title');
    // ctx state should have been updated
    expect(ctx.headSha).toBe(sha);
    expect(ctx.narrative?.title).toBe('cached title');

    ctrl.abort();
    await reader.cancel();

    // cleanup the fixture cache file
    const { rm } = await import('fs/promises');
    const { homedir } = await import('os');
    const { join } = await import('path');
    await rm(join(homedir(), '.cache', 'diffdad', `o-r-1-${sha}-${metaHash}.v3.${providerKey}.json`), {
      force: true,
    }).catch(() => {});
  });

  it('regenerates when only PR labels changed (SHA unchanged)', async () => {
    const { cacheNarrative, computePromptMetaHash } = await import('../narrative/cache');
    const { resolveProviderKey } = await import('../narrative/engine');
    const { readConfig } = await import('../config');
    const providerKey = await resolveProviderKey(await readConfig());
    const sha = `sha-labelonly-${Date.now()}`;
    const editedPr = mkPR({ headSha: sha, labels: ['security', 'breaking'] });
    const newMetaHash = computePromptMetaHash(editedPr);
    await cacheNarrative('o', 'r', 1, sha, newMetaHash, providerKey, { ...baseNarrative, title: 'after label edit' });

    const state = { pr: editedPr };
    const ctx = mkContext({
      headSha: sha,
      pr: mkPR({ headSha: sha, labels: [] }),
      github: defaultGh(state) as unknown as GitHubClient,
    });
    const { app } = createServer(ctx);
    const ctrl = new AbortController();
    const res = await app.request('/api/events', { signal: ctrl.signal });
    const reader = new StreamReader(res.body!);
    await reader.drain();

    await runPoll();
    await new Promise((r) => setTimeout(r, 30));
    const events = (await reader.drain(80)) as SseEvent[];
    expect(events.find((e) => e.event === 'regenerating')).toBeDefined();
    const narrEvt = events.find((e) => e.event === 'narrative');
    expect(narrEvt).toBeDefined();
    expect((narrEvt!.data as { narrative: { title: string } }).narrative.title).toBe('after label edit');
    expect(ctx.pr.labels).toEqual(['security', 'breaking']);

    ctrl.abort();
    await reader.cancel();

    const { rm } = await import('fs/promises');
    const { homedir } = await import('os');
    const { join } = await import('path');
    await rm(join(homedir(), '.cache', 'diffdad', `o-r-1-${sha}-${newMetaHash}.v3.${providerKey}.json`), {
      force: true,
    }).catch(() => {});
  });

  it('does NOT regenerate when only draft/state changed (no prompt impact)', async () => {
    // draft and state aren't fed into the narrative prompt, so flipping them
    // should emit 'pr' but never trigger regeneration. Guards against future
    // changes accidentally treating these like prompt-relevant fields.
    const state = { pr: mkPR({ draft: true }) };
    const ctx = mkContext({
      pr: mkPR({ draft: false }),
      github: defaultGh(state) as unknown as GitHubClient,
    });
    const { app } = createServer(ctx);
    const ctrl = new AbortController();
    const res = await app.request('/api/events', { signal: ctrl.signal });
    const reader = new StreamReader(res.body!);
    await reader.drain();

    await runPoll();
    await new Promise((r) => setTimeout(r, 30));
    const events = (await reader.drain(80)) as SseEvent[];
    expect(events.find((e) => e.event === 'pr')).toBeDefined();
    expect(events.find((e) => e.event === 'regenerating')).toBeUndefined();
    expect(events.find((e) => e.event === 'narrative')).toBeUndefined();

    ctrl.abort();
    await reader.cancel();
  });

  it('does not start a second regeneration while one is already in flight', async () => {
    // If a poll arrives mid-regeneration with a PR title edit, the regen
    // branch must be guarded by `regenerating` and skip — only one
    // 'regenerating' event should fire across the two polls.
    const { cacheNarrative, computePromptMetaHash } = await import('../narrative/cache');
    const { resolveProviderKey } = await import('../narrative/engine');
    const { readConfig } = await import('../config');
    const providerKey = await resolveProviderKey(await readConfig());
    const newSha = `sha-reentrant-${Date.now()}`;
    const initialPr = mkPR({ headSha: newSha });
    const editedPr = mkPR({ headSha: newSha, title: 'Edited mid-regen' });
    // Pre-seed the cache under the edited title's hash. The standalone 'pr'
    // branch in poll 2 mutates ctx.pr before poll 1's getDiff resolves, so the
    // post-await metaHash computation picks up the edited title.
    const editedMeta = computePromptMetaHash(editedPr);
    await cacheNarrative('o', 'r', 1, newSha, editedMeta, providerKey, baseNarrative);

    let releaseDiff!: () => void;
    const diffGate = new Promise<void>((res) => {
      releaseDiff = res;
    });

    const state = { pr: initialPr };
    const gh: GhStub = {
      getPR: async () => state.pr,
      getComments: async () => [],
      getCheckRuns: async () => [],
      getReviews: async () => [],
      getDiff: async () => {
        await diffGate;
        return [];
      },
    };
    const ctx = mkContext({
      headSha: 'sha-A',
      pr: mkPR({ headSha: 'sha-A' }),
      github: gh as unknown as GitHubClient,
    });
    const { app } = createServer(ctx);
    const ctrl = new AbortController();
    const res = await app.request('/api/events', { signal: ctrl.signal });
    const reader = new StreamReader(res.body!);
    await reader.drain();

    // First poll: SHA changes, regen starts and blocks on getDiff.
    const firstPoll = capturedIntervalCb!();
    await new Promise((r) => setTimeout(r, 10));

    // Mid-flight: someone edits the PR title.
    state.pr = editedPr;

    // Second poll: should hit the regen guard and skip — but still emit 'pr'
    // for the title change so the UI doesn't go stale.
    await capturedIntervalCb!();
    let events = (await reader.drain(50)) as SseEvent[];
    expect(events.filter((e) => e.event === 'regenerating')).toHaveLength(1);
    expect(events.find((e) => e.event === 'pr')).toBeDefined();

    // Let the first regen finish.
    releaseDiff();
    await firstPoll;
    events = (await reader.drain(50)) as SseEvent[];
    // The completed regen broadcasts a 'narrative' event.
    expect(events.find((e) => e.event === 'narrative')).toBeDefined();

    ctrl.abort();
    await reader.cancel();

    const { rm } = await import('fs/promises');
    const { homedir } = await import('os');
    const { join } = await import('path');
    await rm(join(homedir(), '.cache', 'diffdad', `o-r-1-${newSha}-${editedMeta}.v3.${providerKey}.json`), {
      force: true,
    }).catch(() => {});
  });

  it('swallows polling errors and keeps the loop alive', async () => {
    let pollCount = 0;
    const gh: GhStub = {
      getPR: async () => {
        pollCount++;
        if (pollCount === 1) throw new Error('transient');
        return mkPR();
      },
      getComments: async () => [],
      getCheckRuns: async () => [],
      getReviews: async () => [],
      getDiff: async () => [],
    };
    const ctx = mkContext({ github: gh as unknown as GitHubClient });
    const { app } = createServer(ctx);
    const ctrl = new AbortController();
    const res = await app.request('/api/events', { signal: ctrl.signal });
    const reader = new StreamReader(res.body!);
    await reader.drain();

    // First poll: getPR throws — should not crash.
    await runPoll();
    let events = (await reader.drain()) as SseEvent[];
    // No 'pr' or 'checks' events emitted because the error swallowed everything.
    expect(events.find((e) => e.event === 'checks')).toBeUndefined();

    // Second poll: getPR succeeds — interval should still be active.
    expect(capturedIntervalCb).not.toBeNull();
    await runPoll();
    events = (await reader.drain()) as SseEvent[];
    expect(events.find((e) => e.event === 'checks')).toBeDefined();

    ctrl.abort();
    await reader.cancel();
  });
});

describe('GET /api/events — disconnect cleanup', () => {
  it('clears the interval and removes the SSE client on abort', async () => {
    const ctx = mkContext({ github: defaultGh({ pr: mkPR() }) as unknown as GitHubClient });
    const { app, broadcast } = createServer(ctx);
    const ctrl = new AbortController();
    const res = await app.request('/api/events', { signal: ctrl.signal });
    const reader = new StreamReader(res.body!);
    await reader.drain();
    expect(capturedIntervalCb).not.toBeNull();

    ctrl.abort();
    // After abort, the on-abort handler clears the interval. Allow any
    // microtasks to flush.
    await new Promise((r) => setTimeout(r, 10));
    expect(capturedIntervalCb).toBeNull();

    // Broadcasting after abort shouldn't error and shouldn't deliver to the
    // (now removed) client.
    expect(() => broadcast('comment', { id: 999 })).not.toThrow();

    await reader.cancel();
  });
});
