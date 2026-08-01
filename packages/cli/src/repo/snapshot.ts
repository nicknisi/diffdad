import { mkdir, readdir, readFile, rename, rm, rmdir, stat, writeFile } from 'fs/promises';
import { join } from 'path';
import type { GitHubClient } from '../github/client';
import { repoSnapshotDir } from '../paths';
import {
  buildImportIndex,
  deserializeImportIndex,
  ImportIndexBuilder,
  MAX_INDEXED_FILE_BYTES,
  serializeImportIndex,
  shouldScanFile,
  type ImportIndex,
} from './import-index';
import { readTarEntries, TarSizeCapError } from './tar';

/**
 * A repository resolved to a local extracted tree plus its import index, or an explicit reason it
 * could not be. Everything downstream consumes this one union — the failure side carries a cause
 * because the UI renders it, and "unavailable" with no cause is dead meta-output.
 */
export type RepoContext =
  | { available: true; root: string; ref: string; fetchedAt: number; index: ImportIndex }
  | { available: false; reason: 'size-cap' | 'fetch-failed' | 'extract-failed' | 'empty-tree' };

export type SnapshotOptions = {
  /** Reject archives whose extracted size exceeds this. Default 500 MB. */
  maxBytes?: number;
  /** Refetch when the cached snapshot is older than this. Default 24h. */
  maxAgeMs?: number;
  /**
   * How long a remembered "this repository has no usable snapshot" answer is trusted before another
   * attempt. Deliberately shorter than {@link SnapshotOptions.maxAgeMs} — a repo that grew past the cap
   * or gained its first source file should recover on its own. Default 6h.
   */
  negativeMaxAgeMs?: number;
  /**
   * Where snapshots live. Defaults to {@link repoSnapshotDir}. Injectable for the same reason
   * `migrateLegacyData` takes `from`/`to`: the cache-reuse and staleness tests need a temp directory
   * and must never touch the developer's real cache.
   */
  cacheDir?: string;
};

/** Just the part of the client this module needs — lets a test pass a counting stub. */
export type TarballSource = Pick<GitHubClient, 'getTarball'>;

const DEFAULT_MAX_BYTES = 500 * 1024 * 1024;
const DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_NEGATIVE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Snapshots untouched for this long are deleted after a successful write. */
const EVICTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * GitHub's tarball wraps the whole repository in a single `{owner}-{repo}-{sha}/` directory, so the
 * first path component is always dropped and `RepoContext.root` points at the real repository root.
 */
const STRIP_COMPONENTS = 1;

/**
 * Sidecar recording what is on disk. Deliberately holds nothing derived from the tree — `filesScanned`
 * lives only in `index.json`, which is rebuilt as a unit, so there is no second copy to go stale when
 * the index is rebuilt without a refetch.
 */
type SnapshotMeta = {
  version: number;
  /** The ref this tree was fetched at. Recorded here, deliberately not part of the cache key. */
  ref: string;
  fetchedAt: number;
};

const SNAPSHOT_META_VERSION = 1;

/**
 * Unavailable reasons worth remembering on disk. Both are properties of the repository rather than of
 * one attempt — a repo over the size cap or with no indexable source file will answer the same way next
 * run — and both cost a *full tarball download* to rediscover. `fetch-failed` and `extract-failed` are
 * deliberately not sticky: a 403 from rate limiting or a truncated body must be retried, not cached.
 */
const STICKY_REASONS = ['size-cap', 'empty-tree'] as const;
type StickyReason = (typeof STICKY_REASONS)[number];

function isStickyReason(value: unknown): value is StickyReason {
  return STICKY_REASONS.includes(value as StickyReason);
}

/**
 * Sidecar remembering that this repo resolved to unavailable, so the next review does not re-download a
 * whole tree to be told the same thing. Separate from `meta.json` because it describes the absence of a
 * tree; `loadCached` must never see it and think there is something to serve.
 */
type UnavailableMarker = { version: number; reason: StickyReason; ref: string; at: number };

const UNAVAILABLE_MARKER_FILE = 'unavailable.json';

async function readUnavailableMarker(dir: string): Promise<UnavailableMarker | null> {
  try {
    const raw = JSON.parse(await readFile(join(dir, UNAVAILABLE_MARKER_FILE), 'utf-8')) as Partial<UnavailableMarker>;
    if (raw.version !== SNAPSHOT_META_VERSION) return null;
    if (!isStickyReason(raw.reason)) return null;
    if (typeof raw.ref !== 'string' || typeof raw.at !== 'number') return null;
    return { version: raw.version, reason: raw.reason, ref: raw.ref, at: raw.at };
  } catch {
    return null;
  }
}

async function writeUnavailableMarker(dir: string, ref: string, reason: StickyReason): Promise<void> {
  const marker: UnavailableMarker = { version: SNAPSHOT_META_VERSION, reason, ref, at: Date.now() };
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, UNAVAILABLE_MARKER_FILE), JSON.stringify(marker));
  } catch {
    // best-effort: failing to remember the negative costs the next run a refetch, nothing more
  }
}

async function clearUnavailableMarker(dir: string): Promise<void> {
  await rm(join(dir, UNAVAILABLE_MARKER_FILE), { force: true }).catch(() => {});
}

/** Thrown when an archive entry would write outside the destination. Rejects the whole archive. */
class ArchiveRejectedError extends Error {
  constructor(reason: string) {
    super(`unsafe archive entry: ${reason}`);
    this.name = 'ArchiveRejectedError';
  }
}

/**
 * One path segment, safe to join. `owner`/`repo` reach here from a PR reference the user typed, so
 * they are sanitized rather than trusted — a `..` owner must not walk out of the cache directory.
 */
function safeSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, '_');
  return cleaned === '' || cleaned === '.' || cleaned === '..' ? '_' : cleaned;
}

/**
 * Directory holding one repository's snapshot. Owner is its own directory rather than part of a
 * flattened `{owner}-{repo}` name, because flattening is ambiguous: `a-b/c` and `a/b-c` collide.
 */
export function snapshotDirFor(cacheDir: string, owner: string, repo: string): string {
  return join(cacheDir, safeSegment(owner), safeSegment(repo));
}

/**
 * Split an archive path into segments on either separator. A tar path is nominally `/`-delimited, but
 * `path.join` treats `\` as a separator on Windows, so `..\..\evil` would escape a destination there
 * while reading as one innocent segment to a `/`-only split. Validating over both is free.
 */
function pathSegments(path: string): string[] {
  return path.split(/[/\\]/);
}

/** Whether a path with `..`/`.` segments stays inside `root` when resolved from `fromDir`. */
function resolvesWithinRoot(fromDir: string, target: string): boolean {
  let depth = 0;
  for (const segment of [...pathSegments(fromDir), ...pathSegments(target)]) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      depth--;
      if (depth < 0) return false;
    } else {
      depth++;
    }
  }
  return true;
}

/**
 * Whether an archive entry's own path would write outside the destination. Checked against the raw
 * archive path, before any component stripping, so a `../` entry is rejected regardless of nesting.
 */
export function isUnsafeEntryPath(path: string): boolean {
  if (/^[/\\]/.test(path)) return true;
  if (/^[A-Za-z]:/.test(path)) return true; // drive-qualified absolute
  if (path.includes('\0')) return true;
  return pathSegments(path).includes('..');
}

/** Whether a symlink/hardlink target points outside the archive root. */
export function isUnsafeLinkTarget(entryPath: string, linkName: string): boolean {
  if (linkName === '') return false;
  if (/^[/\\]/.test(linkName)) return true;
  if (/^[A-Za-z]:/.test(linkName)) return true;
  const fromDir = pathSegments(entryPath).slice(0, -1).join('/');
  return !resolvesWithinRoot(fromDir, linkName);
}

function stripLeadingComponents(path: string, count: number): string {
  return path
    .split('/')
    .filter((segment) => segment !== '')
    .slice(count)
    .join('/');
}

/**
 * Extract a gzipped tarball into `destRoot`, building the import index from the same bytes.
 *
 * Every entry path and link target is validated **before** anything is written, and any violation
 * rejects the whole archive. Symlinks that pass validation are still not materialized: nothing
 * downstream reads them, and refusing to create them makes "extract a file through a symlink planted
 * earlier in the archive" structurally impossible rather than merely checked for.
 */
async function extractSnapshot(
  stream: ReadableStream<Uint8Array>,
  destRoot: string,
  maxBytes: number,
): Promise<ImportIndex> {
  const builder = new ImportIndexBuilder();
  const decoder = new TextDecoder('utf-8');
  const createdDirs = new Set<string>();

  const ensureDir = async (dir: string): Promise<void> => {
    if (dir === '' || createdDirs.has(dir)) return;
    await mkdir(join(destRoot, dir), { recursive: true });
    createdDirs.add(dir);
  };

  // `DecompressionStream.writable` is typed `WritableStream<BufferSource>`, which TypeScript's
  // invariant stream types refuse from a `ReadableStream<Uint8Array>` even though every Uint8Array
  // *is* a BufferSource. The cast restates the variance; it makes no claim about runtime behavior.
  const gunzip = new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>;
  const decompressed = stream.pipeThrough(gunzip);
  for await (const entry of readTarEntries(decompressed, maxBytes)) {
    if (isUnsafeEntryPath(entry.path)) throw new ArchiveRejectedError(`path escapes destination (${entry.path})`);
    if (entry.type === 'symlink' || entry.type === 'hardlink') {
      if (isUnsafeLinkTarget(entry.path, entry.linkName)) {
        throw new ArchiveRejectedError(`link target escapes destination (${entry.path} -> ${entry.linkName})`);
      }
      continue;
    }

    const rel = stripLeadingComponents(entry.path, STRIP_COMPONENTS);
    if (rel === '') continue;
    if (!resolvesWithinRoot('', rel)) throw new ArchiveRejectedError(`path escapes destination (${entry.path})`);

    if (entry.type === 'directory') {
      await ensureDir(rel);
      continue;
    }
    if (entry.type !== 'file') continue;

    const parent = rel.split('/').slice(0, -1).join('/');
    await ensureDir(parent);
    await writeFile(join(destRoot, rel), entry.bytes);
    if (entry.bytes.byteLength <= MAX_INDEXED_FILE_BYTES && shouldScanFile(rel)) {
      builder.addFile(rel, decoder.decode(entry.bytes));
    }
  }

  return builder.build();
}

async function dirExists(path: string): Promise<boolean> {
  try {
    await readdir(path);
    return true;
  } catch {
    return false;
  }
}

async function readMeta(dir: string): Promise<SnapshotMeta | null> {
  try {
    const raw = JSON.parse(await readFile(join(dir, 'meta.json'), 'utf-8')) as Partial<SnapshotMeta>;
    if (raw.version !== SNAPSHOT_META_VERSION) return null;
    if (typeof raw.ref !== 'string' || typeof raw.fetchedAt !== 'number') return null;
    return { version: raw.version, ref: raw.ref, fetchedAt: raw.fetchedAt };
  } catch {
    return null;
  }
}

async function readPersistedIndex(dir: string): Promise<ImportIndex | null> {
  try {
    return deserializeImportIndex(JSON.parse(await readFile(join(dir, 'index.json'), 'utf-8')));
  } catch {
    return null;
  }
}

/**
 * Load an already-extracted snapshot, rebuilding the index from the tree when the persisted JSON is
 * absent or corrupt. Returns `null` when there is nothing usable on disk.
 */
async function loadCached(dir: string): Promise<Extract<RepoContext, { available: true }> | null> {
  const meta = await readMeta(dir);
  if (!meta) return null;
  const treeDir = join(dir, 'tree');
  if (!(await dirExists(treeDir))) return null;

  let index = await readPersistedIndex(dir);
  if (!index) {
    index = await buildImportIndex(treeDir);
    if (index.filesScanned === 0) return null; // tree is gone or unreadable — force a refetch
    try {
      await writeFile(join(dir, 'index.json'), JSON.stringify(serializeImportIndex(index)));
    } catch {
      // best-effort: a failed rewrite costs the next run another walk, it must not fail this one
    }
  }
  return { available: true, root: treeDir, ref: meta.ref, fetchedAt: meta.fetchedAt, index };
}

async function removeQuietly(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch {
    // another process may be reading it; try again next write
  }
}

/** Last-modified time of `path`, or `null` if it cannot be read. */
async function mtimeOf(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * Delete snapshots nothing has refetched in a week, plus the two kinds of garbage a sidecar-driven sweep
 * would otherwise never reclaim: `.tmp-*` scratch trees orphaned by a killed or crashed extraction, and
 * repo directories with no readable `meta.json` at all (a half-written snapshot, or one whose sidecar was
 * corrupted). Both are judged on directory mtime, since neither has a `fetchedAt` to read. Skipping them
 * left disk exhaustion — the exact failure this eviction exists to prevent — reachable through a path
 * nothing cleaned up.
 *
 * Best-effort and error-swallowing on purpose: the daemon and a `dad <pr>` run can hold snapshots open
 * concurrently, and a racing delete must degrade to a stale directory rather than surface as a mystery
 * `ENOENT` in someone else's index build. The week-long bound is also what keeps this safe against a
 * concurrent extraction: a live `.tmp-*` directory is minutes old, never days.
 */
async function evictStaleSnapshots(cacheDir: string, now: number): Promise<void> {
  let owners: string[];
  try {
    owners = await readdir(cacheDir);
  } catch {
    return;
  }
  for (const owner of owners) {
    let repos: string[];
    try {
      repos = await readdir(join(cacheDir, owner));
    } catch {
      continue;
    }
    for (const repo of repos) {
      const dir = join(cacheDir, owner, repo);
      const meta = await readMeta(dir);
      if (!meta) {
        // No usable sidecar: nothing will ever serve this directory, so age it out by mtime.
        const mtime = await mtimeOf(dir);
        if (mtime !== null && now - mtime > EVICTION_MAX_AGE_MS) await removeQuietly(dir);
        continue;
      }
      if (now - meta.fetchedAt > EVICTION_MAX_AGE_MS) {
        await removeQuietly(dir);
        continue;
      }
      await evictOrphanedScratch(dir, now);
    }
  }
}

/** Delete `.tmp-*` scratch directories left behind by an extraction that never finished. */
async function evictOrphanedScratch(dir: string, now: number): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.startsWith('.tmp-')) continue;
    const scratch = join(dir, entry);
    const mtime = await mtimeOf(scratch);
    if (mtime !== null && now - mtime > EVICTION_MAX_AGE_MS) await removeQuietly(scratch);
  }
}

/** Remove `dir` if the rejected extraction left it empty, so a failure leaves no directory behind. */
async function removeIfEmpty(dir: string): Promise<void> {
  try {
    const entries = await readdir(dir);
    if (entries.length === 0) await rmdir(dir);
  } catch {
    // nothing to clean up
  }
}

/**
 * Resolve a repository to a cached extracted tree plus an import index, or to an explicit unavailable
 * reason. Never throws: a missing snapshot degrades the review, it does not break it.
 *
 * The cache is keyed on `{owner}/{repo}` — not the SHA. Caller counts answer "roughly who depends on
 * this", which tolerates a base a few commits stale, and per-SHA keying would rebuild the whole tree on
 * every push to the base branch for accuracy nothing reads. The staleness bound is a refetch trigger,
 * never a hard failure: if the refetch fails and a cached tree exists, the cached tree is served.
 *
 * A repo-shaped unavailable answer (`size-cap`, `empty-tree`) is remembered in a sidecar under its own
 * shorter bound, because rediscovering it costs a whole tarball download and the answer will not have
 * changed. Transient failures are never remembered.
 */
export async function resolveRepoContext(
  client: TarballSource,
  owner: string,
  repo: string,
  ref: string,
  opts: SnapshotOptions = {},
): Promise<RepoContext> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxAgeMs = opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const negativeMaxAgeMs = opts.negativeMaxAgeMs ?? DEFAULT_NEGATIVE_MAX_AGE_MS;
  const cacheDir = opts.cacheDir ?? repoSnapshotDir();

  try {
    const dir = snapshotDirFor(cacheDir, owner, repo);
    const treeDir = join(dir, 'tree');
    const cached = await loadCached(dir);
    // A different base branch is a different tree, so it refetches; a few commits of drift does not.
    if (cached && cached.ref === ref && Date.now() - cached.fetchedAt < maxAgeMs) return cached;

    if (!cached) {
      // Nothing to serve and a fresh negative on record: answer from the marker rather than paying for
      // the whole tarball again. Only checked when there is no tree, so a stale tree always wins.
      const marker = await readUnavailableMarker(dir);
      if (marker && marker.ref === ref && Date.now() - marker.at < negativeMaxAgeMs) {
        return { available: false, reason: marker.reason };
      }
    }

    let stream: ReadableStream<Uint8Array>;
    try {
      stream = await client.getTarball(owner, repo, ref);
    } catch {
      return cached ?? { available: false, reason: 'fetch-failed' };
    }

    // Unique per attempt: the daemon can hydrate two PRs against the same repo concurrently, and two
    // extractions sharing a scratch directory would interleave into a corrupt tree.
    const scratch = join(
      dir,
      `.tmp-${process.pid.toString(36)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    );
    try {
      await mkdir(scratch, { recursive: true });
      const index = await extractSnapshot(stream, scratch, maxBytes);
      // An index with nothing in it reads downstream as "nothing imports anything", which looks
      // exactly like "safe to collapse everything". Report it as unavailable instead.
      if (index.filesScanned === 0) {
        await rm(scratch, { recursive: true, force: true });
        await removeIfEmpty(dir);
        if (cached) return cached;
        await writeUnavailableMarker(dir, ref, 'empty-tree');
        return { available: false, reason: 'empty-tree' };
      }

      await rm(treeDir, { recursive: true, force: true });
      await rename(scratch, treeDir);
      const fetchedAt = Date.now();
      const meta: SnapshotMeta = { version: SNAPSHOT_META_VERSION, ref, fetchedAt };
      // meta.json is written last on purpose: it is what `loadCached` keys off, so a crash between the
      // two writes leaves a snapshot the next run refetches rather than one it trusts half of.
      await writeFile(join(dir, 'index.json'), JSON.stringify(serializeImportIndex(index)));
      await writeFile(join(dir, 'meta.json'), JSON.stringify(meta));
      await clearUnavailableMarker(dir);
      await evictStaleSnapshots(cacheDir, fetchedAt);
      return { available: true, root: treeDir, ref, fetchedAt, index };
    } catch (err) {
      await rm(scratch, { recursive: true, force: true }).catch(() => {});
      await removeIfEmpty(dir);
      // A stale tree beats no tree, whatever went wrong with the refresh.
      if (cached) return cached;
      if (err instanceof TarSizeCapError) {
        await writeUnavailableMarker(dir, ref, 'size-cap');
        return { available: false, reason: 'size-cap' };
      }
      return { available: false, reason: 'extract-failed' };
    }
  } catch {
    // Unwritable cache directory and anything else unforeseen: the review proceeds without context.
    return { available: false, reason: 'extract-failed' };
  }
}

const UNAVAILABLE_REASON_TEXT: Record<Extract<RepoContext, { available: false }>['reason'], string> = {
  'size-cap': 'repository exceeds the snapshot size cap',
  'fetch-failed': 'could not download the repository',
  'extract-failed': 'could not extract the repository',
  'empty-tree': 'no source files found in the repository',
};

/** One-line status for the CLI/daemon so a slow first fetch (or a degraded review) is never silent. */
export function describeRepoContext(context: RepoContext): string {
  if (!context.available) return `Repo context unavailable — ${UNAVAILABLE_REASON_TEXT[context.reason]}`;
  const ageMinutes = Math.max(0, Math.round((Date.now() - context.fetchedAt) / 60_000));
  const age =
    ageMinutes < 1 ? 'just now' : ageMinutes < 60 ? `${ageMinutes}m ago` : `${Math.round(ageMinutes / 60)}h ago`;
  return `Repo context: ${context.index.filesScanned.toLocaleString()} files indexed from ${context.ref} (${age})`;
}
