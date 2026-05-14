import { homedir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { readdir, readFile, rm, writeFile, mkdir, stat } from 'fs/promises';
import { normalizeNarrative, type NarrativeResponse } from './types';
import { isPlan, type Plan } from './plan-types';

const CACHE_DIR = join(homedir(), '.cache', 'diffdad');

// Cache schema version. Bump when the NarrativeResponse shape OR cache key
// format changes in a way that would make older cached entries unreadable. v3
// adds: prompt-meta hash in the key so PR title/body/label edits regenerate;
// optional themeId on chapters; a sibling .plan.v3.json for planner output.
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

function cachePath(
  owner: string,
  repo: string,
  number: number,
  sha: string,
  metaHash: string,
  providerKey: string,
): string {
  return join(CACHE_DIR, `${owner}-${repo}-${number}-${sha}-${metaHash}.v${SCHEMA_VERSION}.${providerKey}.json`);
}

function planCachePath(owner: string, repo: string, number: number, sha: string): string {
  return join(CACHE_DIR, `${owner}-${repo}-${number}-${sha}.plan.v${SCHEMA_VERSION}.json`);
}

export async function getCachedNarrative(
  owner: string,
  repo: string,
  number: number,
  sha: string,
  metaHash: string,
  providerKey: string,
): Promise<NarrativeResponse | null> {
  try {
    const path = cachePath(owner, repo, number, sha, metaHash, providerKey);
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
  providerKey: string,
  narrative: NarrativeResponse,
): Promise<void> {
  const path = cachePath(owner, repo, number, sha, metaHash, providerKey);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path, JSON.stringify(narrative));
}

export async function getCachedPlan(owner: string, repo: string, number: number, sha: string): Promise<Plan | null> {
  try {
    const path = planCachePath(owner, repo, number, sha);
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw);
    return isPlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function cachePlan(owner: string, repo: string, number: number, sha: string, plan: Plan): Promise<void> {
  const path = planCachePath(owner, repo, number, sha);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path, JSON.stringify(plan));
}

export async function findPreviousNarrative(
  owner: string,
  repo: string,
  number: number,
  currentSha: string,
): Promise<NarrativeResponse | null> {
  try {
    const entries = await readdir(CACHE_DIR);
    const prefix = `${owner}-${repo}-${number}-`;
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `^${escapedPrefix}(.+)-[a-f0-9]{12}\\.v${SCHEMA_VERSION}\\..+\\.json$`,
    );

    const candidates: { file: string; sha: string; mtimeMs: number }[] = [];
    for (const entry of entries) {
      const match = entry.match(pattern);
      if (!match) continue;
      const sha = match[1]!;
      if (sha === currentSha) continue;
      try {
        const info = await stat(join(CACHE_DIR, entry));
        candidates.push({ file: entry, sha, mtimeMs: info.mtimeMs });
      } catch {
        continue;
      }
    }

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

    for (const candidate of candidates) {
      try {
        const raw = await readFile(join(CACHE_DIR, candidate.file), 'utf-8');
        return normalizeNarrative(JSON.parse(raw));
      } catch {
        continue;
      }
    }

    return null;
  } catch {
    return null;
  }
}
