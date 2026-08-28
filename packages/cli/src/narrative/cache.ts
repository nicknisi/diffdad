import { homedir } from 'os';
import { join } from 'path';
import { createHash } from 'crypto';
import { readdir, readFile, rename, rm, stat, writeFile, mkdir } from 'fs/promises';
import { normalizeNarrative, type NarrativeResponse } from './types';
import { isPlan, type Plan } from './plan-types';
import { NARRATIVE_PROMPT_REVISION, PLANNER_PROMPT_REVISION } from './prompt';
import { withLock } from './file-lock';

const CACHE_DIR = join(homedir(), '.cache', 'diffdad');

// At most this many sealed revisions are retained per PR; older ones are pruned by mtime.
const MAX_REVISIONS_PER_PR = 5;

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
  return join(CACHE_DIR, narrativeCacheFileName(owner, repo, number, sha, metaHash, providerKey));
}

// Just the filename portion of {@link narrativeCachePath}, so an injected cache dir (tests) can
// reuse the exact key scheme without duplicating it.
function narrativeCacheFileName(
  owner: string,
  repo: string,
  number: number,
  sha: string,
  metaHash: string,
  providerKey: string,
): string {
  return `${owner}-${repo}-${number}-${sha}-${metaHash}.v${SCHEMA_VERSION}.p${PLANNER_PROMPT_REVISION}-${NARRATIVE_PROMPT_REVISION}.${providerKey}.json`;
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
  opts: { cacheDir?: string } = {},
): Promise<void> {
  const cacheDir = opts.cacheDir ?? CACHE_DIR;
  const path = join(cacheDir, narrativeCacheFileName(owner, repo, number, sha, metaHash, providerKey));
  await mkdir(cacheDir, { recursive: true });
  await writeFile(path, JSON.stringify(narrative));
  // The revision log is a best-effort safety net layered on top of the primary cache. A failure to
  // seal a revision must never fail the narrative write the rest of the app depends on.
  try {
    await appendNarrativeRevision(owner, repo, number, sha, metaHash, providerKey, narrative, { cacheDir });
  } catch {
    // swallow — the primary cache write already succeeded.
  }
}

export type RevisionMeta = {
  sha: string;
  metaHash: string;
  providerKey: string;
  savedAt: number;
};

type RevisionRecord = {
  narrative: NarrativeResponse;
  meta: RevisionMeta;
};

type RevisionPointer = {
  revision: string;
} & RevisionMeta;

function revisionsDir(cacheDir: string, owner: string, repo: string, number: number): string {
  return join(cacheDir, 'revisions', `${owner}-${repo}-${number}`);
}

// Stable-key canonical JSON so identical narrative content seals to the same content hash regardless
// of key insertion order.
function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }
    return val;
  });
}

async function writeAtomic(path: string, data: string): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

/**
 * Seal a successful narrative as an immutable, content-addressed revision and advance the PR's
 * last-good pointer. The revision file is named by the sha256 of its canonical content (excluding
 * the savedAt timestamp so re-sealing the same state dedupes). The pointer update and prune run
 * under a per-PR file lock so the concurrent server/daemon writers never corrupt current.json.
 */
export async function appendNarrativeRevision(
  owner: string,
  repo: string,
  number: number,
  sha: string,
  metaHash: string,
  providerKey: string,
  narrative: NarrativeResponse,
  opts: { cacheDir?: string } = {},
): Promise<void> {
  const cacheDir = opts.cacheDir ?? CACHE_DIR;
  const dir = revisionsDir(cacheDir, owner, repo, number);
  await mkdir(dir, { recursive: true });

  const revision = createHash('sha256')
    .update(canonicalJson({ narrative, sha, metaHash, providerKey }))
    .digest('hex')
    .slice(0, 12);
  const record: RevisionRecord = { narrative, meta: { sha, metaHash, providerKey, savedAt: Date.now() } };
  await writeAtomic(join(dir, `${revision}.json`), JSON.stringify(record));

  await withLock(join(dir, '.lock'), async () => {
    const pointer: RevisionPointer = { revision, sha, metaHash, providerKey, savedAt: record.meta.savedAt };
    await writeAtomic(join(dir, 'current.json'), JSON.stringify(pointer));
    await pruneRevisions(dir, pointer.revision);
  });
}

// Keep at most MAX_REVISIONS_PER_PR sealed revisions, dropping the oldest by mtime. The pointer's
// current revision is always preserved even if it is the oldest.
async function pruneRevisions(dir: string, keepRevision: string): Promise<void> {
  const entries = (await readdir(dir)).filter((e) => e.endsWith('.json') && e !== 'current.json');
  if (entries.length <= MAX_REVISIONS_PER_PR) return;
  const keepName = `${keepRevision}.json`;
  const withMtime = await Promise.all(
    entries.map(async (name) => ({ name, mtime: (await stat(join(dir, name))).mtimeMs })),
  );
  withMtime.sort((a, b) => b.mtime - a.mtime); // newest first
  // The pointer's revision is always kept, so it reserves one of the MAX slots. Everything else is
  // trimmed oldest-first until the total (kept + pointer) is within budget.
  const deletable = withMtime.filter((e) => e.name !== keepName);
  const budget = entries.includes(keepName) ? MAX_REVISIONS_PER_PR - 1 : MAX_REVISIONS_PER_PR;
  for (const { name } of deletable.slice(budget)) {
    await rm(join(dir, name), { force: true }).catch(() => {});
  }
}

/**
 * Read the PR's last successfully sealed narrative via its pointer. Returns null on any
 * missing/corrupt pointer or revision file so callers can treat "no last-good" uniformly.
 */
export async function getLastGoodNarrative(
  owner: string,
  repo: string,
  number: number,
  opts: { cacheDir?: string } = {},
): Promise<{ narrative: NarrativeResponse; meta: RevisionMeta } | null> {
  const dir = revisionsDir(opts.cacheDir ?? CACHE_DIR, owner, repo, number);
  try {
    const pointer = JSON.parse(await readFile(join(dir, 'current.json'), 'utf-8')) as RevisionPointer;
    if (!pointer || typeof pointer.revision !== 'string') return null;
    const record = JSON.parse(await readFile(join(dir, `${pointer.revision}.json`), 'utf-8')) as RevisionRecord;
    return { narrative: normalizeNarrative(record.narrative), meta: record.meta };
  } catch {
    return null;
  }
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
