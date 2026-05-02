import { homedir } from 'os';
import { join } from 'path';
import { readdir, readFile, rm, writeFile, mkdir } from 'fs/promises';
import type { NarrativeResponse } from './types';

const CACHE_DIR = join(homedir(), '.cache', 'diffdad');

function cachePath(owner: string, repo: string, number: number, sha: string): string {
  return join(CACHE_DIR, `${owner}-${repo}-${number}-${sha}.json`);
}

function commitCachePath(owner: string, repo: string, sha: string): string {
  return join(CACHE_DIR, `${owner}-${repo}-commit-${sha}.json`);
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
  try {
    const entries = await readdir(CACHE_DIR);
    const jsonFiles = entries.filter((e) => e.endsWith('.json'));
    for (const file of jsonFiles) {
      await rm(join(CACHE_DIR, file));
    }
    return jsonFiles.length;
  } catch {
    return 0;
  }
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

export async function getCachedCommitNarrative(
  owner: string,
  repo: string,
  sha: string,
): Promise<NarrativeResponse | null> {
  try {
    const path = commitCachePath(owner, repo, sha);
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as NarrativeResponse;
  } catch {
    return null;
  }
}

export async function cacheCommitNarrative(
  owner: string,
  repo: string,
  sha: string,
  narrative: NarrativeResponse,
): Promise<void> {
  const path = commitCachePath(owner, repo, sha);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path, JSON.stringify(narrative));
}
