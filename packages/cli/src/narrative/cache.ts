import { homedir } from 'os';
import { join } from 'path';
import { readdir, readFile, rm, writeFile, mkdir } from 'fs/promises';
import type { NarrativeResponse } from './types';

const CACHE_DIR = join(homedir(), '.cache', 'diffdad');
const WATCH_DIR = join(CACHE_DIR, 'watch');

function cachePath(owner: string, repo: string, number: number, sha: string): string {
  return join(CACHE_DIR, `${owner}-${repo}-${number}-${sha}.json`);
}

function watchCommitPath(repoFp: string, sha: string): string {
  return join(WATCH_DIR, `${repoFp}-commit-${sha}.json`);
}

function watchUnifiedPath(repoFp: string, baseSha: string, headSha: string): string {
  return join(WATCH_DIR, `${repoFp}-unified-${baseSha}-${headSha}.json`);
}

export async function getCachedNarrative(
  owner: string,
  repo: string,
  number: number,
  sha: string,
): Promise<NarrativeResponse | null> {
  try {
    const path = cachePath(owner, repo, number, sha);
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as NarrativeResponse;
  } catch {
    return null;
  }
}

export async function clearCache(): Promise<number> {
  let count = 0;
  try {
    const entries = await readdir(CACHE_DIR);
    for (const file of entries.filter((e) => e.endsWith('.json'))) {
      await rm(join(CACHE_DIR, file));
      count += 1;
    }
  } catch {
    // ignore
  }
  try {
    const entries = await readdir(WATCH_DIR);
    for (const file of entries.filter((e) => e.endsWith('.json'))) {
      await rm(join(WATCH_DIR, file));
      count += 1;
    }
  } catch {
    // ignore
  }
  return count;
}

export async function cacheNarrative(
  owner: string,
  repo: string,
  number: number,
  sha: string,
  narrative: NarrativeResponse,
): Promise<void> {
  const path = cachePath(owner, repo, number, sha);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path, JSON.stringify(narrative));
}

export async function getCachedCommitNarrative(repoFp: string, sha: string): Promise<NarrativeResponse | null> {
  try {
    const raw = await readFile(watchCommitPath(repoFp, sha), 'utf-8');
    return JSON.parse(raw) as NarrativeResponse;
  } catch {
    return null;
  }
}

export async function cacheCommitNarrative(
  repoFp: string,
  sha: string,
  narrative: NarrativeResponse,
): Promise<void> {
  await mkdir(WATCH_DIR, { recursive: true });
  await writeFile(watchCommitPath(repoFp, sha), JSON.stringify(narrative));
}

export async function getCachedUnifiedNarrative(
  repoFp: string,
  baseSha: string,
  headSha: string,
): Promise<NarrativeResponse | null> {
  try {
    const raw = await readFile(watchUnifiedPath(repoFp, baseSha, headSha), 'utf-8');
    return JSON.parse(raw) as NarrativeResponse;
  } catch {
    return null;
  }
}

export async function cacheUnifiedNarrative(
  repoFp: string,
  baseSha: string,
  headSha: string,
  narrative: NarrativeResponse,
): Promise<void> {
  await mkdir(WATCH_DIR, { recursive: true });
  await writeFile(watchUnifiedPath(repoFp, baseSha, headSha), JSON.stringify(narrative));
}
