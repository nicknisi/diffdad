import { afterEach, describe, expect, it } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';
import { rm } from 'fs/promises';
import { cacheNarrative, computePromptMetaHash, getCachedNarrative } from '../narrative/cache';
import type { NarrativeResponse } from '../narrative/types';

const CACHE_DIR = join(homedir(), '.cache', 'diffdad');

function mkResponse(overrides: Partial<NarrativeResponse> = {}): NarrativeResponse {
  return {
    title: 'A PR',
    tldr: 'Adds X.',
    verdict: 'safe',
    readingPlan: [],
    concerns: [],
    chapters: [
      {
        title: 'Chapter 1',
        summary: 's',
        whyMatters: 'w',
        risk: 'low',
        sections: [],
      },
    ],
    ...overrides,
  };
}

const FIXTURE_OWNER = '__diffdad_test__';
const FIXTURE_REPO = 'cache';
const META = computePromptMetaHash({ title: 't', body: 'b', labels: [] });

async function cleanFixture() {
  try {
    const { readdir } = await import('fs/promises');
    const entries = await readdir(CACHE_DIR);
    for (const e of entries) {
      if (e.startsWith(`${FIXTURE_OWNER}-`)) {
        await rm(join(CACHE_DIR, e), { force: true });
      }
    }
  } catch {
    // dir might not exist
  }
}

describe('narrative cache', () => {
  afterEach(async () => {
    await cleanFixture();
  });

  it('returns null when nothing cached', async () => {
    const out = await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 1, 'sha-not-cached', META);
    expect(out).toBeNull();
  });

  it('caches and retrieves a narrative roundtrip', async () => {
    const narrative = mkResponse({ title: 'Roundtrip' });
    await cacheNarrative(FIXTURE_OWNER, FIXTURE_REPO, 42, 'sha-roundtrip', META, narrative);
    const got = await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 42, 'sha-roundtrip', META);
    expect(got).not.toBeNull();
    expect(got?.title).toBe('Roundtrip');
    expect(got?.chapters).toHaveLength(1);
  });

  it('keys cache by owner/repo/number/sha — different sha returns null', async () => {
    await cacheNarrative(FIXTURE_OWNER, FIXTURE_REPO, 7, 'sha-A', META, mkResponse({ title: 'A' }));
    const got = await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 7, 'sha-B', META);
    expect(got).toBeNull();
  });

  it('keys cache by prompt-relevant metadata — title/body/label edits return null', async () => {
    const sha = 'sha-meta';
    const original = computePromptMetaHash({ title: 'Original', body: 'desc', labels: ['a'] });
    const titleEdit = computePromptMetaHash({ title: 'Edited', body: 'desc', labels: ['a'] });
    const bodyEdit = computePromptMetaHash({ title: 'Original', body: 'new desc', labels: ['a'] });
    const labelEdit = computePromptMetaHash({ title: 'Original', body: 'desc', labels: ['a', 'b'] });
    await cacheNarrative(FIXTURE_OWNER, FIXTURE_REPO, 13, sha, original, mkResponse({ title: 'orig' }));
    expect(await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 13, sha, original)).not.toBeNull();
    expect(await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 13, sha, titleEdit)).toBeNull();
    expect(await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 13, sha, bodyEdit)).toBeNull();
    expect(await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 13, sha, labelEdit)).toBeNull();
  });

  it('label order does not affect the meta hash', async () => {
    const a = computePromptMetaHash({ title: 't', body: 'b', labels: ['x', 'y'] });
    const b = computePromptMetaHash({ title: 't', body: 'b', labels: ['y', 'x'] });
    expect(a).toBe(b);
  });

  it('reverting a metadata edit re-hits the prior cache entry', async () => {
    // The whole point of putting the meta hash in the key (rather than
    // invalidating on write) is that flipping back to a prior version of the
    // PR description finds the original narrative instead of regenerating.
    const sha = 'sha-revert';
    const v1 = computePromptMetaHash({ title: 'V1', body: 'first', labels: [] });
    const v2 = computePromptMetaHash({ title: 'V2', body: 'second', labels: [] });
    await cacheNarrative(FIXTURE_OWNER, FIXTURE_REPO, 17, sha, v1, mkResponse({ title: 'narr-v1' }));
    await cacheNarrative(FIXTURE_OWNER, FIXTURE_REPO, 17, sha, v2, mkResponse({ title: 'narr-v2' }));

    expect((await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 17, sha, v1))?.title).toBe('narr-v1');
    expect((await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 17, sha, v2))?.title).toBe('narr-v2');
  });

  it('normalizes cached narrative on read (tolerant of older shapes)', async () => {
    // Write an "old shape" payload bypassing the type — simulate a legacy cache.
    const sha = 'sha-legacy';
    await cacheNarrative(FIXTURE_OWNER, FIXTURE_REPO, 9, sha, META, {
      title: 'Legacy',
      // missing tldr, verdict, readingPlan, concerns
      chapters: [{ title: 'X', summary: 's', risk: 'low', sections: [] }],
    } as unknown as NarrativeResponse);
    const got = await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 9, sha, META);
    expect(got).not.toBeNull();
    expect(got?.title).toBe('Legacy');
    expect(got?.tldr).toBe('');
    expect(got?.verdict).toBe('caution');
    expect(got?.readingPlan).toEqual([]);
    expect(got?.chapters[0]?.whyMatters).toBe('');
  });

  it('overwrites a previous cache entry for the same key', async () => {
    const sha = 'sha-overwrite';
    await cacheNarrative(FIXTURE_OWNER, FIXTURE_REPO, 11, sha, META, mkResponse({ title: 'first' }));
    await cacheNarrative(FIXTURE_OWNER, FIXTURE_REPO, 11, sha, META, mkResponse({ title: 'second' }));
    const got = await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 11, sha, META);
    expect(got?.title).toBe('second');
  });

  it('returns null when the cached file is corrupt JSON', async () => {
    const { mkdir, writeFile } = await import('fs/promises');
    await mkdir(CACHE_DIR, { recursive: true });
    const path = join(CACHE_DIR, `${FIXTURE_OWNER}-${FIXTURE_REPO}-99-sha-corrupt-${META}.v3.json`);
    await writeFile(path, '{ not valid json');
    const got = await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 99, 'sha-corrupt', META);
    expect(got).toBeNull();
  });
});
