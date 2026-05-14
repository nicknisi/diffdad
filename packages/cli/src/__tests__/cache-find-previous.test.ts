import { afterEach, describe, expect, it } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';
import { mkdir, rm, writeFile, utimes } from 'fs/promises';
import { cacheNarrative, computePromptMetaHash, findPreviousNarrative } from '../narrative/cache';
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

const FIXTURE_OWNER = '__diffdad_test_prev__';
const FIXTURE_REPO = 'find-prev';
const META = computePromptMetaHash({ title: 't', body: 'b', labels: [] });
const PROVIDER = 'claude-haiku';

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

describe('findPreviousNarrative', () => {
  afterEach(async () => {
    await cleanFixture();
  });

  it('returns null when no previous narrative exists', async () => {
    const result = await findPreviousNarrative(FIXTURE_OWNER, FIXTURE_REPO, 1, 'sha-current');
    expect(result).toBeNull();
  });

  it('finds a previous narrative at a different SHA', async () => {
    await cacheNarrative(FIXTURE_OWNER, FIXTURE_REPO, 5, 'sha-old', META, PROVIDER, mkResponse({ title: 'Previous' }));
    const result = await findPreviousNarrative(FIXTURE_OWNER, FIXTURE_REPO, 5, 'sha-current');
    expect(result).not.toBeNull();
    expect(result?.title).toBe('Previous');
  });

  it('excludes the current SHA', async () => {
    await cacheNarrative(FIXTURE_OWNER, FIXTURE_REPO, 6, 'sha-only', META, PROVIDER, mkResponse({ title: 'Only One' }));
    const result = await findPreviousNarrative(FIXTURE_OWNER, FIXTURE_REPO, 6, 'sha-only');
    expect(result).toBeNull();
  });

  it('returns the most recent match by mtime when multiple SHAs exist', async () => {
    await mkdir(CACHE_DIR, { recursive: true });

    await cacheNarrative(FIXTURE_OWNER, FIXTURE_REPO, 7, 'sha-old', META, PROVIDER, mkResponse({ title: 'Older' }));
    const olderPath = join(CACHE_DIR, `${FIXTURE_OWNER}-${FIXTURE_REPO}-7-sha-old-${META}.v3.${PROVIDER}.json`);
    const pastTime = new Date(Date.now() - 60_000);
    await utimes(olderPath, pastTime, pastTime);

    await cacheNarrative(FIXTURE_OWNER, FIXTURE_REPO, 7, 'sha-new', META, PROVIDER, mkResponse({ title: 'Newer' }));
    const newerPath = join(CACHE_DIR, `${FIXTURE_OWNER}-${FIXTURE_REPO}-7-sha-new-${META}.v3.${PROVIDER}.json`);
    const futureTime = new Date(Date.now() + 60_000);
    await utimes(newerPath, futureTime, futureTime);

    const result = await findPreviousNarrative(FIXTURE_OWNER, FIXTURE_REPO, 7, 'sha-current');
    expect(result?.title).toBe('Newer');
  });

  it('skips files with a different schema version', async () => {
    await mkdir(CACHE_DIR, { recursive: true });
    const oldVersionPath = join(CACHE_DIR, `${FIXTURE_OWNER}-${FIXTURE_REPO}-8-sha-old-${META}.v2.${PROVIDER}.json`);
    await writeFile(oldVersionPath, JSON.stringify(mkResponse({ title: 'Old Schema' })));

    const result = await findPreviousNarrative(FIXTURE_OWNER, FIXTURE_REPO, 8, 'sha-current');
    expect(result).toBeNull();
  });

  it('skips corrupt JSON and falls through to the next candidate', async () => {
    await mkdir(CACHE_DIR, { recursive: true });

    const corruptPath = join(CACHE_DIR, `${FIXTURE_OWNER}-${FIXTURE_REPO}-9-sha-corrupt-${META}.v3.${PROVIDER}.json`);
    await writeFile(corruptPath, '{ not valid json');
    const corruptTime = new Date(Date.now() + 1000);
    await utimes(corruptPath, corruptTime, corruptTime);

    await cacheNarrative(
      FIXTURE_OWNER,
      FIXTURE_REPO,
      9,
      'sha-valid',
      META,
      PROVIDER,
      mkResponse({ title: 'Fallback' }),
    );

    const result = await findPreviousNarrative(FIXTURE_OWNER, FIXTURE_REPO, 9, 'sha-current');
    expect(result?.title).toBe('Fallback');
  });

  it('matches regardless of provider key', async () => {
    await cacheNarrative(
      FIXTURE_OWNER,
      FIXTURE_REPO,
      10,
      'sha-claude',
      META,
      'claude-sonnet',
      mkResponse({ title: 'Sonnet Review' }),
    );
    const result = await findPreviousNarrative(FIXTURE_OWNER, FIXTURE_REPO, 10, 'sha-current');
    expect(result?.title).toBe('Sonnet Review');
  });

  it('matches regardless of metaHash', async () => {
    const differentMeta = computePromptMetaHash({ title: 'Different Title', body: 'b', labels: [] });
    await cacheNarrative(
      FIXTURE_OWNER,
      FIXTURE_REPO,
      11,
      'sha-prev',
      differentMeta,
      PROVIDER,
      mkResponse({ title: 'Different Meta' }),
    );
    const result = await findPreviousNarrative(FIXTURE_OWNER, FIXTURE_REPO, 11, 'sha-current');
    expect(result?.title).toBe('Different Meta');
  });

  it('returns null when cache directory does not exist', async () => {
    const result = await findPreviousNarrative('nonexistent-owner', 'nonexistent-repo', 999, 'sha');
    expect(result).toBeNull();
  });
});
