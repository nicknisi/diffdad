import { afterEach, describe, expect, it } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';
import { mkdir, rm, writeFile } from 'fs/promises';
import {
  cacheNarrative,
  cachePlan,
  computePromptMetaHash,
  getCachedNarrative,
  getCachedPlan,
  narrativeCachePath,
  planCachePath,
} from '../narrative/cache';
import { NARRATIVE_PROMPT_REVISION, PLANNER_PROMPT_REVISION } from '../narrative/prompt';
import type { Plan } from '../narrative/plan-types';
import type { NarrativeResponse } from '../narrative/types';

const CACHE_DIR = join(homedir(), '.cache', 'diffdad');

/**
 * Rewrite one revision segment of a production cache path into an older revision, guarding
 * that the segment actually matched — so a filename-format change breaks these tests loudly
 * instead of letting them pass on ENOENT against a path production never reads.
 */
function withOlderRevision(path: string, currentSegment: string, olderSegment: string): string {
  const older = path.replace(currentSegment, olderSegment);
  expect(older).not.toBe(path);
  return older;
}

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
const FIXTURE_PROVIDER = 'claude-haiku';

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
    const out = await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 1, 'sha-not-cached', META, FIXTURE_PROVIDER);
    expect(out).toBeNull();
  });

  it('caches and retrieves a narrative roundtrip', async () => {
    const narrative = mkResponse({ title: 'Roundtrip' });
    await cacheNarrative(FIXTURE_OWNER, FIXTURE_REPO, 42, 'sha-roundtrip', META, FIXTURE_PROVIDER, narrative);
    const got = await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 42, 'sha-roundtrip', META, FIXTURE_PROVIDER);
    expect(got).not.toBeNull();
    expect(got?.title).toBe('Roundtrip');
    expect(got?.chapters).toHaveLength(1);
  });

  it('keys cache by owner/repo/number/sha — different sha returns null', async () => {
    await cacheNarrative(FIXTURE_OWNER, FIXTURE_REPO, 7, 'sha-A', META, FIXTURE_PROVIDER, mkResponse({ title: 'A' }));
    const got = await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 7, 'sha-B', META, FIXTURE_PROVIDER);
    expect(got).toBeNull();
  });

  it('keys cache by prompt-relevant metadata — title/body/label edits return null', async () => {
    const sha = 'sha-meta';
    const original = computePromptMetaHash({ title: 'Original', body: 'desc', labels: ['a'] });
    const titleEdit = computePromptMetaHash({ title: 'Edited', body: 'desc', labels: ['a'] });
    const bodyEdit = computePromptMetaHash({ title: 'Original', body: 'new desc', labels: ['a'] });
    const labelEdit = computePromptMetaHash({ title: 'Original', body: 'desc', labels: ['a', 'b'] });
    await cacheNarrative(
      FIXTURE_OWNER,
      FIXTURE_REPO,
      13,
      sha,
      original,
      FIXTURE_PROVIDER,
      mkResponse({ title: 'orig' }),
    );
    expect(await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 13, sha, original, FIXTURE_PROVIDER)).not.toBeNull();
    expect(await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 13, sha, titleEdit, FIXTURE_PROVIDER)).toBeNull();
    expect(await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 13, sha, bodyEdit, FIXTURE_PROVIDER)).toBeNull();
    expect(await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 13, sha, labelEdit, FIXTURE_PROVIDER)).toBeNull();
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
    await cacheNarrative(FIXTURE_OWNER, FIXTURE_REPO, 17, sha, v1, FIXTURE_PROVIDER, mkResponse({ title: 'narr-v1' }));
    await cacheNarrative(FIXTURE_OWNER, FIXTURE_REPO, 17, sha, v2, FIXTURE_PROVIDER, mkResponse({ title: 'narr-v2' }));

    expect((await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 17, sha, v1, FIXTURE_PROVIDER))?.title).toBe(
      'narr-v1',
    );
    expect((await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 17, sha, v2, FIXTURE_PROVIDER))?.title).toBe(
      'narr-v2',
    );
  });

  it('keys cache by providerKey — different provider returns null', async () => {
    const sha = 'sha-provider';
    await cacheNarrative(FIXTURE_OWNER, FIXTURE_REPO, 13, sha, META, 'claude-sonnet', mkResponse({ title: 'sonnet' }));
    const sameProvider = await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 13, sha, META, 'claude-sonnet');
    expect(sameProvider?.title).toBe('sonnet');
    const otherProvider = await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 13, sha, META, 'claude-haiku');
    expect(otherProvider).toBeNull();
  });

  it('normalizes cached narrative on read (tolerant of older shapes)', async () => {
    // Write an "old shape" payload bypassing the type — simulate a legacy cache.
    const sha = 'sha-legacy';
    await cacheNarrative(FIXTURE_OWNER, FIXTURE_REPO, 9, sha, META, FIXTURE_PROVIDER, {
      title: 'Legacy',
      // missing tldr, verdict, readingPlan, concerns
      chapters: [{ title: 'X', summary: 's', risk: 'low', sections: [] }],
    } as unknown as NarrativeResponse);
    const got = await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 9, sha, META, FIXTURE_PROVIDER);
    expect(got).not.toBeNull();
    expect(got?.title).toBe('Legacy');
    expect(got?.tldr).toBe('');
    expect(got?.verdict).toBe('caution');
    expect(got?.readingPlan).toEqual([]);
    expect(got?.chapters[0]?.whyMatters).toBe('');
  });

  it('overwrites a previous cache entry for the same key', async () => {
    const sha = 'sha-overwrite';
    await cacheNarrative(FIXTURE_OWNER, FIXTURE_REPO, 11, sha, META, FIXTURE_PROVIDER, mkResponse({ title: 'first' }));
    await cacheNarrative(FIXTURE_OWNER, FIXTURE_REPO, 11, sha, META, FIXTURE_PROVIDER, mkResponse({ title: 'second' }));
    const got = await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 11, sha, META, FIXTURE_PROVIDER);
    expect(got?.title).toBe('second');
  });

  it('does not reuse prose from an older narrative prompt revision', async () => {
    const sha = 'sha-old-prompt';
    const currentPath = narrativeCachePath(FIXTURE_OWNER, FIXTURE_REPO, 98, sha, META, FIXTURE_PROVIDER);
    const oldPath = withOlderRevision(
      currentPath,
      `.p${PLANNER_PROMPT_REVISION}-${NARRATIVE_PROMPT_REVISION}.`,
      `.p${PLANNER_PROMPT_REVISION}-${NARRATIVE_PROMPT_REVISION - 1}.`,
    );
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(oldPath, JSON.stringify(mkResponse({ title: 'Old prompt prose' })));

    expect(await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 98, sha, META, FIXTURE_PROVIDER)).toBeNull();

    // Positive control: the same payload at the current path IS returned, proving the
    // miss above was the revision segment and nothing else.
    await writeFile(currentPath, JSON.stringify(mkResponse({ title: 'Current prose' })));
    expect((await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 98, sha, META, FIXTURE_PROVIDER))?.title).toBe(
      'Current prose',
    );
  });

  it('does not reuse prose from an older planner prompt revision', async () => {
    const sha = 'sha-old-planner';
    const currentPath = narrativeCachePath(FIXTURE_OWNER, FIXTURE_REPO, 97, sha, META, FIXTURE_PROVIDER);
    const oldPath = withOlderRevision(
      currentPath,
      `.p${PLANNER_PROMPT_REVISION}-`,
      `.p${PLANNER_PROMPT_REVISION - 1}-`,
    );
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(oldPath, JSON.stringify(mkResponse({ title: 'Old planner prose' })));

    expect(await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 97, sha, META, FIXTURE_PROVIDER)).toBeNull();
  });

  it('returns null when the cached file is corrupt JSON at the current filename', async () => {
    const sha = 'sha-corrupt';
    const path = narrativeCachePath(FIXTURE_OWNER, FIXTURE_REPO, 99, sha, META, FIXTURE_PROVIDER);
    await mkdir(CACHE_DIR, { recursive: true });

    // Prove the path is the one production reads — a valid payload roundtrips…
    await writeFile(path, JSON.stringify(mkResponse({ title: 'valid' })));
    expect((await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 99, sha, META, FIXTURE_PROVIDER))?.title).toBe(
      'valid',
    );

    // …then corrupt JSON at the same path must fail on parsing, not filename mismatch.
    await writeFile(path, '{ not valid json');
    expect(await getCachedNarrative(FIXTURE_OWNER, FIXTURE_REPO, 99, sha, META, FIXTURE_PROVIDER)).toBeNull();
  });
});

function mkPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    schemaVersion: 1,
    prTitle: 'A PR',
    prTldr: 'Adds X.',
    prVerdict: 'safe',
    themes: [
      { id: 'theme-0', title: 'Theme', riskLevel: 'low', rationale: 'r', hunkRefs: [{ file: 'a.ts', hunkIndex: 0 }] },
    ],
    readingPlan: [],
    concerns: [],
    ...overrides,
  };
}

describe('plan cache', () => {
  afterEach(async () => {
    await cleanFixture();
  });

  it('roundtrips a plan under owner/repo/number/sha/metaHash/provider', async () => {
    const sha = 'sha-plan-roundtrip';
    await cachePlan(FIXTURE_OWNER, FIXTURE_REPO, 21, sha, META, FIXTURE_PROVIDER, mkPlan({ prTitle: 'planned' }));
    const got = await getCachedPlan(FIXTURE_OWNER, FIXTURE_REPO, 21, sha, META, FIXTURE_PROVIDER);
    expect(got?.prTitle).toBe('planned');
    expect(got?.themes).toHaveLength(1);
  });

  it('misses the cached plan when prompt-relevant metadata changes on the same SHA', async () => {
    const sha = 'sha-plan-meta';
    const original = computePromptMetaHash({ title: 'Original', body: 'desc', labels: [] });
    const edited = computePromptMetaHash({ title: 'Edited', body: 'desc', labels: [] });
    await cachePlan(FIXTURE_OWNER, FIXTURE_REPO, 22, sha, original, FIXTURE_PROVIDER, mkPlan());

    expect(await getCachedPlan(FIXTURE_OWNER, FIXTURE_REPO, 22, sha, original, FIXTURE_PROVIDER)).not.toBeNull();
    expect(await getCachedPlan(FIXTURE_OWNER, FIXTURE_REPO, 22, sha, edited, FIXTURE_PROVIDER)).toBeNull();
  });

  it('misses the cached plan when the provider changes', async () => {
    const sha = 'sha-plan-provider';
    await cachePlan(FIXTURE_OWNER, FIXTURE_REPO, 23, sha, META, 'claude-sonnet', mkPlan());

    expect(await getCachedPlan(FIXTURE_OWNER, FIXTURE_REPO, 23, sha, META, 'claude-sonnet')).not.toBeNull();
    expect(await getCachedPlan(FIXTURE_OWNER, FIXTURE_REPO, 23, sha, META, 'claude-haiku')).toBeNull();
  });

  it('does not reuse a plan from an older planner prompt revision', async () => {
    const sha = 'sha-plan-old-rev';
    const currentPath = planCachePath(FIXTURE_OWNER, FIXTURE_REPO, 24, sha, META, FIXTURE_PROVIDER);
    const oldPath = withOlderRevision(
      currentPath,
      `.p${PLANNER_PROMPT_REVISION}.`,
      `.p${PLANNER_PROMPT_REVISION - 1}.`,
    );
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(oldPath, JSON.stringify(mkPlan({ prTitle: 'stale plan' })));

    expect(await getCachedPlan(FIXTURE_OWNER, FIXTURE_REPO, 24, sha, META, FIXTURE_PROVIDER)).toBeNull();

    // Positive control: the same payload at the current path IS returned.
    await writeFile(currentPath, JSON.stringify(mkPlan({ prTitle: 'current plan' })));
    expect((await getCachedPlan(FIXTURE_OWNER, FIXTURE_REPO, 24, sha, META, FIXTURE_PROVIDER))?.prTitle).toBe(
      'current plan',
    );
  });

  it('returns null for corrupt or non-plan JSON at the current filename', async () => {
    const sha = 'sha-plan-corrupt';
    const path = planCachePath(FIXTURE_OWNER, FIXTURE_REPO, 25, sha, META, FIXTURE_PROVIDER);
    await mkdir(CACHE_DIR, { recursive: true });

    await writeFile(path, '{ not valid json');
    expect(await getCachedPlan(FIXTURE_OWNER, FIXTURE_REPO, 25, sha, META, FIXTURE_PROVIDER)).toBeNull();

    // Valid JSON that fails the isPlan guard is also rejected.
    await writeFile(path, JSON.stringify({ schemaVersion: 999 }));
    expect(await getCachedPlan(FIXTURE_OWNER, FIXTURE_REPO, 25, sha, META, FIXTURE_PROVIDER)).toBeNull();
  });
});
