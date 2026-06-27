import { readdir, rm } from 'fs/promises';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentCommentStore } from '../agent-comments/store';
import { UnknownCommentError } from '../agent-comments/types';
import { dataDir } from '../paths';

const STORE_DIR = join(dataDir(), 'agent-comments');
const FIXTURE_KEY = '__diffdad_test__store';

function deterministic() {
  let id = 0;
  let t = 0;
  return { genId: () => `id-${++id}`, now: () => `2026-06-15T00:00:0${t++}.000Z` };
}

async function cleanFixture() {
  try {
    for (const e of await readdir(STORE_DIR)) {
      if (e.startsWith('__diffdad_test__')) await rm(join(STORE_DIR, e), { force: true });
    }
  } catch {
    // dir might not exist
  }
}

const newComment = (over = {}) => ({ path: 'src/a.ts', line: 1, body: 'fix this', ...over });

describe('AgentCommentStore', () => {
  afterEach(cleanFixture);

  it('starts empty and adds comments as open/user', async () => {
    const store = new AgentCommentStore(FIXTURE_KEY, [], deterministic());
    expect(store.list()).toHaveLength(0);
    const c = await store.add(newComment());
    expect(c).toMatchObject({ id: 'id-1', status: 'open', author: 'user', side: 'RIGHT', replies: [] });
    expect(store.list('open')).toHaveLength(1);
  });

  it('markDelivered flips only open comments', async () => {
    const store = new AgentCommentStore(FIXTURE_KEY, [], deterministic());
    const a = await store.add(newComment());
    const b = await store.add(newComment({ line: 2 }));
    await store.resolve(b.id);
    await store.markDelivered([a.id, b.id]);
    expect(store.list().find((c) => c.id === a.id)?.status).toBe('delivered');
    expect(store.list().find((c) => c.id === b.id)?.status).toBe('addressed'); // resolved stays addressed
  });

  it('appends replies and resolves with a note', async () => {
    const store = new AgentCommentStore(FIXTURE_KEY, [], deterministic());
    const a = await store.add(newComment());
    await store.addReply(a.id, { author: 'agent', body: 'done — extracted guard' });
    const resolved = await store.resolve(a.id, 'moved validation up');
    expect(resolved.replies).toHaveLength(1);
    expect(resolved.replies[0]).toMatchObject({ author: 'agent', body: 'done — extracted guard' });
    expect(resolved).toMatchObject({ status: 'addressed', addressedNote: 'moved validation up' });
  });

  it('round-trips through disk', async () => {
    const writeStore = new AgentCommentStore(FIXTURE_KEY, [], deterministic());
    const a = await writeStore.add(newComment());
    await writeStore.add(newComment({ line: 9 }));
    await writeStore.markDelivered([a.id]);

    const reloaded = await AgentCommentStore.load(FIXTURE_KEY);
    expect(reloaded.list()).toHaveLength(2);
    expect(reloaded.list().find((c) => c.id === a.id)?.status).toBe('delivered');
  });

  it('throws UnknownCommentError for a bogus id', async () => {
    const store = new AgentCommentStore(FIXTURE_KEY, [], deterministic());
    await expect(store.resolve('nope')).rejects.toBeInstanceOf(UnknownCommentError);
    await expect(store.addReply('nope', { author: 'agent', body: 'x' })).rejects.toBeInstanceOf(UnknownCommentError);
  });
});
