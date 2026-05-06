import { homedir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { readdir, readFile, rm, writeFile, mkdir } from 'fs/promises';
import { normalizeNarrative, type NarrativeResponse } from './types';

const CACHE_DIR = join(homedir(), '.cache', 'diffdad');

// Cache schema version. Bump when the NarrativeResponse shape OR the cache key
// format changes in a way that would make older cached entries unreadable. v3
// added the prompt-meta hash to the key so PR title/body/label edits regenerate.
const SCHEMA_VERSION = 3;

export type PromptRelevantMeta = {
  title: string;
  body: string;
  labels: string[];
};

// Short stable hash over the PR fields the narrative prompt actually consumes.
// If any of these change on GitHub, the cached narrative is no longer valid.
export function computePromptMetaHash(meta: PromptRelevantMeta): string {
  const canonical = JSON.stringify({
    title: meta.title,
    body: meta.body,
    labels: [...meta.labels].sort(),
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 12);
}

function cachePath(owner: string, repo: string, number: number, sha: string, metaHash: string): string {
  return join(CACHE_DIR, `${owner}-${repo}-${number}-${sha}-${metaHash}.v${SCHEMA_VERSION}.json`);
}

export async function getCachedNarrative(
  owner: string,
  repo: string,
  number: number,
  sha: string,
  metaHash: string,
): Promise<NarrativeResponse | null> {
  try {
    const path = cachePath(owner, repo, number, sha, metaHash);
    const raw = await readFile(path, 'utf-8');
    return normalizeNarrative(JSON.parse(raw));
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
  metaHash: string,
  narrative: NarrativeResponse,
): Promise<void> {
  const path = cachePath(owner, repo, number, sha, metaHash);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path, JSON.stringify(narrative));
}
