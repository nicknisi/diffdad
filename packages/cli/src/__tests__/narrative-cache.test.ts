import { afterEach, describe, expect, it } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';
import { rm } from 'fs/promises';
import { cacheNarrative, getCachedNarrative } from '../narrative/cache';
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
    const out = await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 1, 'sha-not-cached');
    expect(out).toBeNull();
  });

  it('caches and retrieves a narrative roundtrip', async () => {
    const narrative = mkResponse({ title: 'Roundtrip' });
    await cacheNarrative(FIXTURE_OWNER, FIXTURE_REPO, 42, 'sha-roundtrip', narrative);
    const got = await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 42, 'sha-roundtrip');
    expect(got).not.toBeNull();
    expect(got?.title).toBe('Roundtrip');
    expect(got?.chapters).toHaveLength(1);
  });

  it('keys cache by owner/repo/number/sha — different sha returns null', async () => {
    await cacheNarrative(FIXTURE_OWNER, FIXTURE_REPO, 7, 'sha-A', mkResponse({ title: 'A' }));
    const got = await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 7, 'sha-B');
    expect(got).toBeNull();
  });

  it('normalizes cached narrative on read (tolerant of older shapes)', async () => {
    // Write an "old shape" payload bypassing the type — simulate a legacy cache.
    const sha = 'sha-legacy';
    await cacheNarrative(FIXTURE_OWNER, FIXTURE_REPO, 9, sha, {
      title: 'Legacy',
      // missing tldr, verdict, readingPlan, concerns
      chapters: [{ title: 'X', summary: 's', risk: 'low', sections: [] }],
    } as unknown as NarrativeResponse);
    const got = await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 9, sha);
    expect(got).not.toBeNull();
    expect(got?.title).toBe('Legacy');
    expect(got?.tldr).toBe('');
    expect(got?.verdict).toBe('caution');
    expect(got?.readingPlan).toEqual([]);
    expect(got?.chapters[0]?.whyMatters).toBe('');
  });

  it('overwrites a previous cache entry for the same key', async () => {
    const sha = 'sha-overwrite';
    await cacheNarrative(FIXTURE_OWNER, FIXTURE_REPO, 11, sha, mkResponse({ title: 'first' }));
    await cacheNarrative(FIXTURE_OWNER, FIXTURE_REPO, 11, sha, mkResponse({ title: 'second' }));
    const got = await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 11, sha);
    expect(got?.title).toBe('second');
  });

  it('returns null when the cached file is corrupt JSON', async () => {
    const { mkdir, writeFile } = await import('fs/promises');
    await mkdir(CACHE_DIR, { recursive: true });
    // Write a junk file at a key we control. The cache uses schema version v2
    // — match the format so it's actually picked up.
    const path = join(CACHE_DIR, `${FIXTURE_OWNER}-${FIXTURE_REPO}-99-sha-corrupt.v2.json`);
    await writeFile(path, '{ not valid json');
    const got = await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 99, 'sha-corrupt');
    expect(got).toBeNull();
  });
});
