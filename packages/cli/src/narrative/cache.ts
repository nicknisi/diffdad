import { homedir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { readdir, readFile, rm, writeFile, mkdir } from 'fs/promises';
import { normalizeNarrative, type NarrativeResponse } from './types';
import { isPlan, type Plan } from './plan-types';
import { NARRATIVE_PROMPT_REVISION, PLANNER_PROMPT_REVISION } from './prompt';

const CACHE_DIR = join(homedir(), '.cache', 'diffdad');

// Cache schema version tracks serialized compatibility. Prompt revisions are keyed
// separately so prose-contract changes regenerate without pretending the shape changed.
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

/**
 * Exact on-disk path for a completed narrative. Keyed on both prompt revisions: two-pass
 * output depends on the plan (planner revision) and the prose contract (narrative revision).
 * Exported so tests construct fixture paths the same way production reads them.
 */
export function narrativeCachePath(
  owner: string,
  repo: string,
  number: number,
  sha: string,
  metaHash: string,
  providerKey: string,
): string {
  return join(
    CACHE_DIR,
    `${owner}-${repo}-${number}-${sha}-${metaHash}.v${SCHEMA_VERSION}.p${PLANNER_PROMPT_REVISION}-${NARRATIVE_PROMPT_REVISION}.${providerKey}.json`,
  );
}

/**
 * Exact on-disk path for a cached plan. A plan is a function of the diff (sha), the PR
 * metadata fed to the planner prompt (metaHash), the model that produced it (providerKey),
 * and the planner prompt contract (planner revision) — all of them key the filename so a
 * same-SHA title/body/label edit or provider switch regenerates instead of replaying a
 * stale plan. Writer-only prompt changes deliberately do NOT invalidate plans.
 */
export function planCachePath(
  owner: string,
  repo: string,
  number: number,
  sha: string,
  metaHash: string,
  providerKey: string,
): string {
  return join(
    CACHE_DIR,
    `${owner}-${repo}-${number}-${sha}-${metaHash}.plan.v${SCHEMA_VERSION}.p${PLANNER_PROMPT_REVISION}.${providerKey}.json`,
  );
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
    const path = narrativeCachePath(owner, repo, number, sha, metaHash, providerKey);
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
  const path = narrativeCachePath(owner, repo, number, sha, metaHash, providerKey);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path, JSON.stringify(narrative));
}

export async function getCachedPlan(
  owner: string,
  repo: string,
  number: number,
  sha: string,
  metaHash: string,
  providerKey: string,
): Promise<Plan | null> {
  try {
    const path = planCachePath(owner, repo, number, sha, metaHash, providerKey);
    const raw = await readFile(path, 'utf-8');
    const parsed = JSON.parse(raw);
    return isPlan(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function cachePlan(
  owner: string,
  repo: string,
  number: number,
  sha: string,
  metaHash: string,
  providerKey: string,
  plan: Plan,
): Promise<void> {
  const path = planCachePath(owner, repo, number, sha, metaHash, providerKey);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path, JSON.stringify(plan));
}
