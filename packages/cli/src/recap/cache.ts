import { homedir } from 'os';
import { join } from 'path';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { normalizeRecap, type RecapResponse } from './types';

const CACHE_DIR = join(homedir(), '.cache', 'diffdad');
const SCHEMA_VERSION = 1;

function cachePath(owner: string, repo: string, number: number, sha: string): string {
  return join(CACHE_DIR, `recap-${owner}-${repo}-${number}-${sha}.v${SCHEMA_VERSION}.json`);
}

export async function getCachedRecap(
  owner: string,
  repo: string,
  number: number,
  sha: string,
): Promise<RecapResponse | null> {
  try {
    const raw = await readFile(cachePath(owner, repo, number, sha), 'utf-8');
    return normalizeRecap(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function cacheRecap(
  owner: string,
  repo: string,
  number: number,
  sha: string,
  recap: RecapResponse,
): Promise<void> {
  const path = cachePath(owner, repo, number, sha);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path, JSON.stringify(recap));
}
