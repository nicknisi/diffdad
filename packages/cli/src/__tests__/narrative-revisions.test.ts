import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { mkdtemp, readdir, readFile, rm, writeFile, utimes } from 'fs/promises';
import {
  appendNarrativeRevision,
  cacheNarrative,
  computePromptMetaHash,
  getLastGoodNarrative,
} from '../narrative/cache';
import { withLock } from '../narrative/file-lock';
import type { NarrativeResponse } from '../narrative/types';

const OWNER = 'acme';
const REPO = 'widgets';
const PR = 42;
const META = computePromptMetaHash({ title: 't', body: 'b', labels: [] });
const PROVIDER = 'claude-haiku';

let cacheDir: string;

beforeEach(async () => {
  cacheDir = await mkdtemp(join(tmpdir(), 'diffdad-rev-'));
});

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true });
});

function mkResponse(overrides: Partial<NarrativeResponse> = {}): NarrativeResponse {
  return {
    title: 'A PR',
    tldr: 'Adds X.',
    verdict: 'safe',
    readingPlan: [],
    concerns: [],
    chapters: [{ title: 'Chapter 1', summary: 's', whyMatters: 'w', risk: 'low', sections: [] }],
    ...overrides,
  };
}

function revDir(): string {
  return join(cacheDir, 'revisions', `${OWNER}-${REPO}-${PR}`);
}

describe('narrative revisions', () => {
  it('returns null when no revision exists', async () => {
    expect(await getLastGoodNarrative(OWNER, REPO, PR, { cacheDir })).toBeNull();
  });

  it('seals a revision and advances the pointer on write', async () => {
    await appendNarrativeRevision(OWNER, REPO, PR, 'sha1', META, PROVIDER, mkResponse({ title: 'V1' }), { cacheDir });
    const got = await getLastGoodNarrative(OWNER, REPO, PR, { cacheDir });
    expect(got?.narrative.title).toBe('V1');
    expect(got?.meta.sha).toBe('sha1');
    expect(got?.meta.providerKey).toBe(PROVIDER);
    expect(typeof got?.meta.savedAt).toBe('number');

    const pointer = JSON.parse(await readFile(join(revDir(), 'current.json'), 'utf-8'));
    expect(await readdir(revDir())).toContain(`${pointer.revision}.json`);
  });

  it('is content-addressed: identical content reuses the same revision file', async () => {
    await appendNarrativeRevision(OWNER, REPO, PR, 'sha1', META, PROVIDER, mkResponse({ title: 'Same' }), { cacheDir });
    await appendNarrativeRevision(OWNER, REPO, PR, 'sha1', META, PROVIDER, mkResponse({ title: 'Same' }), { cacheDir });
    const files = (await readdir(revDir())).filter((f) => f !== 'current.json' && f !== '.lock');
    expect(files).toHaveLength(1);
  });

  it('the pointer always resolves to the latest write', async () => {
    await appendNarrativeRevision(OWNER, REPO, PR, 'sha1', META, PROVIDER, mkResponse({ title: 'V1' }), { cacheDir });
    await appendNarrativeRevision(OWNER, REPO, PR, 'sha2', META, PROVIDER, mkResponse({ title: 'V2' }), { cacheDir });
    const got = await getLastGoodNarrative(OWNER, REPO, PR, { cacheDir });
    expect(got?.narrative.title).toBe('V2');
    expect(got?.meta.sha).toBe('sha2');
  });

  it('prunes to at most 5 revisions, dropping the oldest by mtime', async () => {
    for (let i = 0; i < 7; i++) {
      await appendNarrativeRevision(OWNER, REPO, PR, `sha-${i}`, META, PROVIDER, mkResponse({ title: `V${i}` }), {
        cacheDir,
      });
      // Force distinct, ascending mtimes so prune order is deterministic.
      const file = JSON.parse(await readFile(join(revDir(), 'current.json'), 'utf-8')).revision + '.json';
      const t = new Date(Date.now() + i * 1000);
      await utimes(join(revDir(), file), t, t);
    }
    const files = (await readdir(revDir())).filter((f) => f.endsWith('.json') && f !== 'current.json');
    expect(files.length).toBeLessThanOrEqual(5);
    // Newest (V6) survives and is still the pointer target.
    expect((await getLastGoodNarrative(OWNER, REPO, PR, { cacheDir }))?.narrative.title).toBe('V6');
  });

  it('cacheNarrative also seals a revision', async () => {
    await cacheNarrative(OWNER, REPO, PR, 'sha-c', META, PROVIDER, mkResponse({ title: 'Cached' }), { cacheDir });
    expect((await getLastGoodNarrative(OWNER, REPO, PR, { cacheDir }))?.narrative.title).toBe('Cached');
  });

  it('tolerates a corrupt pointer (returns null)', async () => {
    await appendNarrativeRevision(OWNER, REPO, PR, 'sha1', META, PROVIDER, mkResponse(), { cacheDir });
    await writeFile(join(revDir(), 'current.json'), '{ not json');
    expect(await getLastGoodNarrative(OWNER, REPO, PR, { cacheDir })).toBeNull();
  });

  it('tolerates a pointer to a missing revision file (returns null)', async () => {
    await appendNarrativeRevision(OWNER, REPO, PR, 'sha1', META, PROVIDER, mkResponse(), { cacheDir });
    await writeFile(join(revDir(), 'current.json'), JSON.stringify({ revision: 'deadbeef', sha: 'x' }));
    expect(await getLastGoodNarrative(OWNER, REPO, PR, { cacheDir })).toBeNull();
  });

  it('normalizes older-shaped revision payloads on read', async () => {
    await appendNarrativeRevision(OWNER, REPO, PR, 'sha1', META, PROVIDER, mkResponse(), { cacheDir });
    const pointer = JSON.parse(await readFile(join(revDir(), 'current.json'), 'utf-8'));
    await writeFile(
      join(revDir(), `${pointer.revision}.json`),
      JSON.stringify({ narrative: { title: 'Legacy', chapters: [] }, meta: pointer }),
    );
    const got = await getLastGoodNarrative(OWNER, REPO, PR, { cacheDir });
    expect(got?.narrative.title).toBe('Legacy');
    expect(got?.narrative.verdict).toBe('caution');
  });
});

describe('file lock', () => {
  it('serializes concurrent holders: one waits for the other', async () => {
    const lockPath = join(cacheDir, 'race.lock');
    const events: string[] = [];
    const run = (id: string) =>
      withLock(lockPath, async () => {
        events.push(`enter-${id}`);
        await new Promise((r) => setTimeout(r, 50));
        events.push(`exit-${id}`);
      });

    await Promise.all([run('a'), run('b')]);

    // Whoever entered first must fully exit before the other enters — no interleaving.
    expect(events).toHaveLength(4);
    expect(events[1]).toBe(events[0]?.replace('enter', 'exit'));
    expect(events[3]).toBe(events[2]?.replace('enter', 'exit'));
  });

  it('reclaims a stale lock', async () => {
    const lockPath = join(cacheDir, 'stale.lock');
    await writeFile(lockPath, JSON.stringify({ pid: 999999, ts: Date.now() - 60_000 }));
    let ran = false;
    await withLock(
      lockPath,
      async () => {
        ran = true;
      },
      { staleMs: 30_000 },
    );
    expect(ran).toBe(true);
  });

  it('times out waiting on a held, non-stale lock', async () => {
    const lockPath = join(cacheDir, 'held.lock');
    await writeFile(lockPath, JSON.stringify({ pid: process.pid, ts: Date.now() }));
    await expect(withLock(lockPath, async () => {}, { staleMs: 30_000, timeoutMs: 100 })).rejects.toThrow(/Timed out/);
  });
});
