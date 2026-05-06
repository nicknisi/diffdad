import { afterEach, describe, expect, it } from 'vitest';
import { homedir } from 'os';
import { join } from 'path';
import { mkdir, readdir, rm, writeFile } from 'fs/promises';
import { cacheRecap, getCachedRecap } from '../recap/cache';
import type { RecapResponse } from '../recap/types';

const CACHE_DIR = join(homedir(), '.cache', 'diffdad');

const FIXTURE_OWNER = '__diffdad_recap_test__';
const FIXTURE_REPO = 'cache';

function mkRecap(overrides: Partial<RecapResponse> = {}): RecapResponse {
  return {
    goal: 'Add feature X',
    stateOfPlay: { done: ['parser'], wip: ['UI'], notStarted: ['docs'] },
    decisions: [],
    blockers: [],
    mentalModel: { coreFiles: ['src/x.ts'], touchpoints: [], sketch: '' },
    howToHelp: [],
    ...overrides,
  };
}

async function cleanFixture() {
  try {
    const entries = await readdir(CACHE_DIR);
    for (const e of entries) {
      if (e.startsWith(`recap-${FIXTURE_OWNER}-`)) {
        await rm(join(CACHE_DIR, e), { force: true });
      }
    }
  } catch {
    // ignore
  }
}

describe('recap cache', () => {
  afterEach(async () => {
    await cleanFixture();
  });

  it('returns null when nothing cached', async () => {
    const out = await getCachedRecap(FIXTURE_OWNER, FIXTURE_REPO, 1, 'sha-missing');
    expect(out).toBeNull();
  });

  it('caches and retrieves a recap roundtrip', async () => {
    const recap = mkRecap({ goal: 'Roundtrip goal' });
    await cacheRecap(FIXTURE_OWNER, FIXTURE_REPO, 5, 'sha-recap', recap);
    const got = await getCachedRecap(FIXTURE_OWNER, FIXTURE_REPO, 5, 'sha-recap');
    expect(got?.goal).toBe('Roundtrip goal');
    expect(got?.stateOfPlay.done).toEqual(['parser']);
    expect(got?.mentalModel.coreFiles).toEqual(['src/x.ts']);
  });

  it('uses a separate keyspace from narrative cache (recap- prefix)', async () => {
    // Writing a recap and a narrative for the same owner/repo/number/sha
    // should not collide. We don't directly observe collision here, but a
    // recap read should round-trip the recap shape, not a narrative.
    const recap = mkRecap({ goal: 'separate keyspace' });
    await cacheRecap(FIXTURE_OWNER, FIXTURE_REPO, 7, 'sha-distinct', recap);
    const got = await getCachedRecap(FIXTURE_OWNER, FIXTURE_REPO, 7, 'sha-distinct');
    expect(got?.goal).toBe('separate keyspace');
  });

  it('returns null for corrupt cache file', async () => {
    await mkdir(CACHE_DIR, { recursive: true });
    const path = join(CACHE_DIR, `recap-${FIXTURE_OWNER}-${FIXTURE_REPO}-3-sha-bad.v1.json`);
    await writeFile(path, '{ invalid');
    const got = await getCachedRecap(FIXTURE_OWNER, FIXTURE_REPO, 3, 'sha-bad');
    expect(got).toBeNull();
  });

  it('normalizes legacy/missing fields on read', async () => {
    await mkdir(CACHE_DIR, { recursive: true });
    const path = join(CACHE_DIR, `recap-${FIXTURE_OWNER}-${FIXTURE_REPO}-13-sha-legacy.v1.json`);
    await writeFile(path, JSON.stringify({ goal: 'old' }));
    const got = await getCachedRecap(FIXTURE_OWNER, FIXTURE_REPO, 13, 'sha-legacy');
    expect(got?.goal).toBe('old');
    expect(got?.stateOfPlay).toEqual({ done: [], wip: [], notStarted: [] });
    expect(got?.decisions).toEqual([]);
    expect(got?.blockers).toEqual([]);
    expect(got?.mentalModel).toEqual({ coreFiles: [], touchpoints: [], sketch: '' });
    expect(got?.howToHelp).toEqual([]);
  });
});
