import { access, mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { gzipSync } from 'zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitHubClient } from '../github/client';
import {
  buildImportIndex,
  callersOf,
  deserializeImportIndex,
  serializeImportIndex,
  shouldScanFile,
} from '../repo/import-index';
import { isUnsafeEntryPath, isUnsafeLinkTarget, resolveRepoContext, snapshotDirFor } from '../repo/snapshot';
import { readTarEntries, type TarEntry } from '../repo/tar';

// `new URL(...).pathname` percent-encodes, so a checkout under a path with a space resolves to a
// directory that does not exist. `fileURLToPath` is the decoding form.
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/**
 * Fetch stub in the shape `github-client.test.ts` already uses: a call log plus a swappable responder.
 * `calls.length` is what the "no second fetch" assertion reads, and driving a real `GitHubClient`
 * (rather than a hand-rolled stub) also exercises the tarball URL the client builds.
 */
type FetchCall = { url: string };
const calls: FetchCall[] = [];
let responder: (call: FetchCall) => Promise<Response> = async () => new Response('not configured', { status: 500 });
const realFetch = globalThis.fetch;

async function tarballResponse(fixture: string): Promise<Response> {
  return new Response(await readFile(join(FIXTURES, fixture)));
}

function serveFixture(fixture: string): void {
  responder = () => tarballResponse(fixture);
}

let cacheDir: string;
let client: GitHubClient;

beforeEach(async () => {
  calls.length = 0;
  cacheDir = await mkdtemp(join(tmpdir(), 'diffdad-repos-'));
  client = new GitHubClient('test-token');
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const call: FetchCall = { url };
    calls.push(call);
    return responder(call);
  }) as typeof fetch;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  responder = async () => new Response('not configured', { status: 500 });
  await rm(cacheDir, { recursive: true, force: true });
});

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe('resolveRepoContext extraction', () => {
  it('extracts a tarball and reports available', async () => {
    serveFixture('mini-repo.tar.gz');
    const context = await resolveRepoContext(client, 'acme', 'mini-repo', 'main', { cacheDir });

    expect(context.available).toBe(true);
    if (!context.available) return;
    expect(context.ref).toBe('main');
    expect(context.index.filesScanned).toBeGreaterThan(0);
    // GitHub wraps the tree in `{owner}-{repo}-{sha}/`; root must point past that wrapper.
    expect(await exists(join(context.root, 'src', 'util.ts'))).toBe(true);
    expect(await exists(join(context.root, 'mini-repo-abc1234'))).toBe(false);
  });

  it('requests the tarball endpoint with the ref path-encoded', async () => {
    serveFixture('mini-repo.tar.gz');
    await resolveRepoContext(client, 'acme', 'mini-repo', 'release/1.2', { cacheDir });
    expect(calls[0]?.url).toBe('https://api.github.com/repos/acme/mini-repo/tarball/release/1.2');
  });

  it('rejects an archive with escaping entries and leaves no tree behind', async () => {
    serveFixture('evil-paths.tar.gz');
    const context = await resolveRepoContext(client, 'acme', 'evil', 'main', { cacheDir });

    expect(context).toEqual({ available: false, reason: 'extract-failed' });
    expect(await exists(join(snapshotDirFor(cacheDir, 'acme', 'evil'), 'tree'))).toBe(false);
    expect(await exists(join(cacheDir, 'diffdad-archive-escape.txt'))).toBe(false);
    expect(await exists(join(cacheDir, 'acme', 'diffdad-archive-escape.txt'))).toBe(false);
  });

  it('rejects both classes of escape independently', () => {
    expect(isUnsafeEntryPath('wrapper/../../../etc/passwd')).toBe(true);
    expect(isUnsafeEntryPath('/etc/passwd')).toBe(true);
    expect(isUnsafeEntryPath('wrapper/src/ok.ts')).toBe(false);

    expect(isUnsafeLinkTarget('wrapper/link', '/etc/passwd')).toBe(true);
    expect(isUnsafeLinkTarget('wrapper/link', '../../../../etc/passwd')).toBe(true);
    expect(isUnsafeLinkTarget('wrapper/src/link', '../util.ts')).toBe(false);
  });

  it('treats a backslash as a separator when validating, not as an innocent character', () => {
    // `path.join` splits on `\` under Windows, so a `/`-only split would read this as one safe segment.
    expect(isUnsafeEntryPath('wrapper\\..\\..\\evil')).toBe(true);
    expect(isUnsafeEntryPath('\\etc\\passwd')).toBe(true);
    expect(isUnsafeLinkTarget('wrapper/link', '..\\..\\etc\\passwd')).toBe(true);
  });

  it('returns size-cap when the decompressed archive exceeds maxBytes', async () => {
    serveFixture('mini-repo.tar.gz');
    const context = await resolveRepoContext(client, 'acme', 'mini-repo', 'main', { cacheDir, maxBytes: 1 });

    expect(context).toEqual({ available: false, reason: 'size-cap' });
    expect(await exists(join(snapshotDirFor(cacheDir, 'acme', 'mini-repo'), 'tree'))).toBe(false);
  });

  it('returns fetch-failed when the tarball request errors and nothing is cached', async () => {
    responder = async () => new Response('nope', { status: 404 });
    const context = await resolveRepoContext(client, 'acme', 'mini-repo', 'main', { cacheDir });
    expect(context).toEqual({ available: false, reason: 'fetch-failed' });
  });

  it('returns extract-failed when the body is not a gzipped tarball', async () => {
    responder = async () => new Response('this is not a tarball');
    const context = await resolveRepoContext(client, 'acme', 'mini-repo', 'main', { cacheDir });
    expect(context).toEqual({ available: false, reason: 'extract-failed' });
  });
});

describe('resolveRepoContext caching', () => {
  it('performs no second fetch inside the staleness window', async () => {
    serveFixture('mini-repo.tar.gz');
    const first = await resolveRepoContext(client, 'acme', 'mini-repo', 'main', { cacheDir });
    expect(first.available).toBe(true);
    expect(calls.length).toBe(1);

    const second = await resolveRepoContext(client, 'acme', 'mini-repo', 'main', { cacheDir });
    expect(second.available).toBe(true);
    expect(calls.length).toBe(1); // served entirely from the cached tree
    if (!second.available) return;
    expect(second.index.filesScanned).toBe(6);
  });

  it('refetches once the snapshot is older than maxAgeMs', async () => {
    serveFixture('mini-repo.tar.gz');
    await resolveRepoContext(client, 'acme', 'mini-repo', 'main', { cacheDir });
    expect(calls.length).toBe(1);

    await resolveRepoContext(client, 'acme', 'mini-repo', 'main', { cacheDir, maxAgeMs: 0 });
    expect(calls.length).toBe(2);
  });

  it('serves the cached tree when a refetch fails', async () => {
    serveFixture('mini-repo.tar.gz');
    const fresh = await resolveRepoContext(client, 'acme', 'mini-repo', 'main', { cacheDir });
    expect(fresh.available).toBe(true);

    responder = async () => new Response('rate limited', { status: 403 });
    const stale = await resolveRepoContext(client, 'acme', 'mini-repo', 'main', { cacheDir, maxAgeMs: 0 });

    expect(stale.available).toBe(true);
    if (!stale.available) return;
    expect(stale.index.filesScanned).toBe(6);
    expect(callersOf(stale.index, 'src/util.ts', new Set())).toHaveLength(3);
  });

  it('rebuilds the index from the tree when the persisted JSON is corrupt', async () => {
    serveFixture('mini-repo.tar.gz');
    await resolveRepoContext(client, 'acme', 'mini-repo', 'main', { cacheDir });
    await writeFile(join(snapshotDirFor(cacheDir, 'acme', 'mini-repo'), 'index.json'), '{ not json');

    const context = await resolveRepoContext(client, 'acme', 'mini-repo', 'main', { cacheDir });

    expect(calls.length).toBe(1); // rebuilt from disk, not refetched
    expect(context.available).toBe(true);
    if (!context.available) return;
    expect(callersOf(context.index, 'src/util.ts', new Set())).toHaveLength(3);
  });

  it('refetches when the requested ref differs from the cached one', async () => {
    serveFixture('mini-repo.tar.gz');
    await resolveRepoContext(client, 'acme', 'mini-repo', 'main', { cacheDir });
    await resolveRepoContext(client, 'acme', 'mini-repo', 'develop', { cacheDir });
    expect(calls.length).toBe(2);
  });

  it('reclaims orphaned scratch trees and sidecar-less directories on write', async () => {
    const ancientSeconds = (Date.now() - 8 * 24 * 60 * 60 * 1000) / 1000;
    // A repo directory whose meta.json never landed: nothing will ever serve it, and a sidecar-driven
    // sweep would skip it forever.
    const abandoned = snapshotDirFor(cacheDir, 'acme', 'abandoned');
    await mkdir(join(abandoned, 'tree'), { recursive: true });
    await utimes(abandoned, ancientSeconds, ancientSeconds);
    // A scratch tree left behind by a killed extraction.
    const scratch = join(snapshotDirFor(cacheDir, 'acme', 'mini-repo'), '.tmp-killed-run');
    await mkdir(scratch, { recursive: true });
    await utimes(scratch, ancientSeconds, ancientSeconds);

    serveFixture('mini-repo.tar.gz');
    await resolveRepoContext(client, 'acme', 'mini-repo', 'main', { cacheDir });

    expect(await exists(abandoned)).toBe(false);
    expect(await exists(scratch)).toBe(false);
    expect(await exists(join(snapshotDirFor(cacheDir, 'acme', 'mini-repo'), 'tree'))).toBe(true);
  });

  it('keeps owner and repo in separate path segments so names cannot collide', () => {
    expect(snapshotDirFor('/c', 'a-b', 'c')).not.toBe(snapshotDirFor('/c', 'a', 'b-c'));
    expect(snapshotDirFor('/c', '..', '..')).toBe(join('/c', '_', '_'));
  });
});

describe('import index', () => {
  async function miniIndex() {
    serveFixture('mini-repo.tar.gz');
    const context = await resolveRepoContext(client, 'acme', 'mini-repo', 'main', { cacheDir });
    if (!context.available) throw new Error(`expected an available snapshot, got ${context.reason}`);
    return context;
  }

  it('counts exactly the repository files that import a module', async () => {
    const { index } = await miniIndex();
    expect(callersOf(index, 'src/util.ts', new Set()).sort()).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('honours the exclude set so only unchanged callers are counted', async () => {
    const { index } = await miniIndex();
    expect(callersOf(index, 'src/util.ts', new Set(['src/a.ts']))).toHaveLength(2);
    expect(callersOf(index, 'src/util.ts', new Set(['src/a.ts', 'src/b.ts', 'src/c.ts']))).toHaveLength(0);
  });

  it('reports an unimported module as zero callers while filesScanned stays positive', async () => {
    const { index } = await miniIndex();
    expect(callersOf(index, 'src/orphan.ts', new Set())).toEqual([]);
    expect(index.filesScanned).toBeGreaterThan(0);
  });

  it('skips vendored and generated directories', async () => {
    const { index } = await miniIndex();
    const allCallers = [...index.callers.values()].flat();
    expect(allCallers.some((p) => p.startsWith('node_modules/'))).toBe(false);
    expect(allCallers.some((p) => p.startsWith('dist/'))).toBe(false);
  });

  it('scans only source-like files', () => {
    expect(shouldScanFile('src/a.ts')).toBe(true);
    expect(shouldScanFile('src/a.tsx')).toBe(true);
    expect(shouldScanFile('assets/logo.png')).toBe(false);
    expect(shouldScanFile('README.md')).toBe(false);
    expect(shouldScanFile('node_modules/pkg/index.js')).toBe(false);
    expect(shouldScanFile('packages/web/dist/bundle.js')).toBe(false);
  });

  it('rebuilds the same index by walking the extracted tree', async () => {
    const context = await miniIndex();
    const walked = await buildImportIndex(context.root);
    expect(walked.filesScanned).toBe(context.index.filesScanned);
    expect(callersOf(walked, 'src/util.ts', new Set()).sort()).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('round-trips through JSON without losing the Map', async () => {
    const { index } = await miniIndex();
    const revived = deserializeImportIndex(JSON.parse(JSON.stringify(serializeImportIndex(index))));
    expect(revived).not.toBeNull();
    expect(revived?.filesScanned).toBe(index.filesScanned);
    expect(callersOf(revived!, 'src/util.ts', new Set())).toHaveLength(3);
  });

  it('rejects a corrupt or version-mismatched persisted index', () => {
    expect(deserializeImportIndex(null)).toBeNull();
    expect(deserializeImportIndex({ version: 999, callers: {}, filesScanned: 1 })).toBeNull();
    expect(deserializeImportIndex({ version: 1, callers: { util: ['a', 2] }, filesScanned: 1 })).toBeNull();
  });
});

/**
 * Tar synthesis for the header shapes the committed fixtures cannot carry.
 *
 * `git archive` — which is what GitHub's tarball endpoint runs — emits a pax extended header for any
 * path over 100 bytes, so the pax and GNU long-name branches are the ones real repositories exercise on
 * every request. Both fixtures hold only short ustar names, and a defect in those branches surfaces
 * solely as `reason: 'extract-failed'`: an invisible, permanent degrade. These entries are built here
 * rather than committed as a binary so the bytes under test are readable in the diff.
 */
const BLOCK = 512;
const encoder = new TextEncoder();

type SynthEntry = {
  name: string;
  typeflag?: string;
  body?: Uint8Array | string;
  linkName?: string;
  /** Off-by-one the stored checksum, i.e. "this is not a tar header". */
  corruptChecksum?: boolean;
};

function writeAscii(block: Uint8Array, offset: number, value: string, length: number): void {
  block.set(encoder.encode(value).subarray(0, length), offset);
}

/** Octal field: zero-padded digits with a trailing NUL, the ustar convention. */
function octalField(value: number, length: number): string {
  return `${value.toString(8).padStart(length - 1, '0')}\0`;
}

function tarBlocks(entry: SynthEntry): Uint8Array {
  const body = typeof entry.body === 'string' ? encoder.encode(entry.body) : (entry.body ?? new Uint8Array(0));
  const header = new Uint8Array(BLOCK);
  writeAscii(header, 0, entry.name, 100);
  writeAscii(header, 100, octalField(0o644, 8), 8);
  writeAscii(header, 108, octalField(0, 8), 8);
  writeAscii(header, 116, octalField(0, 8), 8);
  writeAscii(header, 124, octalField(body.byteLength, 12), 12);
  writeAscii(header, 136, octalField(0, 12), 12);
  header.fill(0x20, 148, 156); // the checksum is summed with its own field read as spaces
  writeAscii(header, 156, entry.typeflag ?? '0', 1);
  writeAscii(header, 157, entry.linkName ?? '', 100);
  writeAscii(header, 257, 'ustar\0', 6);
  writeAscii(header, 263, '00', 2);
  let sum = 0;
  for (const byte of header) sum += byte;
  if (entry.corruptChecksum) sum += 1;
  writeAscii(header, 148, `${sum.toString(8).padStart(6, '0')}\0 `, 8);

  const padded = Math.ceil(body.byteLength / BLOCK) * BLOCK;
  const out = new Uint8Array(BLOCK + padded);
  out.set(header, 0);
  out.set(body, BLOCK);
  return out;
}

function tarArchive(entries: SynthEntry[]): Uint8Array {
  const blocks = entries.map(tarBlocks);
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.byteLength, 0) + BLOCK * 2);
  let offset = 0;
  for (const block of blocks) {
    out.set(block, offset);
    offset += block.byteLength;
  }
  return out; // trailing zero blocks are the end-of-archive marker
}

/** One pax record, `"<byteLength> key=value\n"`, where the length counts its own digits. */
function paxRecord(key: string, value: string): Uint8Array {
  const tail = encoder.encode(`${key}=${value}\n`);
  for (let length = tail.byteLength + 2; ; length++) {
    const prefix = encoder.encode(`${length} `);
    if (prefix.byteLength + tail.byteLength !== length) continue;
    const out = new Uint8Array(length);
    out.set(prefix, 0);
    out.set(tail, prefix.byteLength);
    return out;
  }
}

function paxPayload(records: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(records.reduce((n, r) => n + r.byteLength, 0));
  let offset = 0;
  for (const record of records) {
    out.set(record, offset);
    offset += record.byteLength;
  }
  return out;
}

function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function entriesOf(bytes: Uint8Array): Promise<TarEntry[]> {
  const entries: TarEntry[] = [];
  for await (const entry of readTarEntries(streamOf(bytes), 10_000_000)) entries.push(entry);
  return entries;
}

const WRAPPER = 'synth-repo-abc1234';
const PAX_REL = 'src/deeply/nested/generated/modules/with/a/name/long/enough/to/need/a/pax/header/consumer.ts';
const GNU_REL = 'src/deeply/nested/generated/modules/with/a/name/long/enough/for/gnu/longlink/consumer.ts';

function longNameArchive(): SynthEntry[] {
  const paxPath = `${WRAPPER}/${PAX_REL}`;
  const gnuPath = `${WRAPPER}/${GNU_REL}`;
  return [
    { name: `${WRAPPER}/src/util.ts`, body: 'export const util = 1;\n' },
    {
      name: 'PaxHeader/consumer.ts',
      typeflag: 'x',
      // A non-ASCII record ahead of `path` is the case that catches byte-versus-character offsets: with
      // char-counted offsets every following record desynchronizes and `path` comes out truncated.
      body: paxPayload([paxRecord('comment', 'café — ünïcode'), paxRecord('path', paxPath)]),
    },
    { name: paxPath.slice(0, 100), body: "import { util } from '../util';\n" },
    { name: '././@LongLink', typeflag: 'L', body: `${gnuPath}\0` },
    { name: gnuPath.slice(0, 100), body: "import { util } from '../util';\n" },
  ];
}

describe('tar reader long names and corrupt headers', () => {
  it('recovers a pax long path even when an earlier record holds non-ASCII bytes', async () => {
    const entries = await entriesOf(tarArchive(longNameArchive()));
    const paths = entries.map((e) => e.path);
    expect(encoder.encode(`${WRAPPER}/${PAX_REL}`).byteLength).toBeGreaterThan(100);
    expect(paths).toContain(`${WRAPPER}/${PAX_REL}`);
  });

  it('recovers a GNU LongLink path', async () => {
    const entries = await entriesOf(tarArchive(longNameArchive()));
    expect(entries.map((e) => e.path)).toContain(`${WRAPPER}/${GNU_REL}`);
    // The override applies to exactly one entry and is not carried into the next.
    expect(entries.filter((e) => e.path === `${WRAPPER}/${GNU_REL}`)).toHaveLength(1);
  });

  it('rejects a stream whose header checksum does not verify', async () => {
    const archive = tarArchive([{ name: `${WRAPPER}/src/util.ts`, body: 'x\n', corruptChecksum: true }]);
    await expect(entriesOf(archive)).rejects.toThrow(/checksum/);
  });

  it('indexes long-named files at their full paths and writes them there on disk', async () => {
    responder = async () => new Response(gzipSync(tarArchive(longNameArchive())));
    const context = await resolveRepoContext(client, 'acme', 'synth', 'main', { cacheDir });

    expect(context.available).toBe(true);
    if (!context.available) return;
    expect(context.index.filesScanned).toBe(3);
    expect(callersOf(context.index, 'src/util.ts', new Set()).sort()).toEqual([GNU_REL, PAX_REL].sort());
    expect(await exists(join(context.root, PAX_REL))).toBe(true);
    expect(await exists(join(context.root, GNU_REL))).toBe(true);
  });

  it('reports extract-failed and leaves no tree when a header checksum is corrupt', async () => {
    const archive = tarArchive([{ name: `${WRAPPER}/src/util.ts`, body: 'x\n', corruptChecksum: true }]);
    responder = async () => new Response(gzipSync(archive));
    const context = await resolveRepoContext(client, 'acme', 'synth', 'main', { cacheDir });

    expect(context).toEqual({ available: false, reason: 'extract-failed' });
    expect(await exists(join(snapshotDirFor(cacheDir, 'acme', 'synth'), 'tree'))).toBe(false);
  });
});

describe('unavailable markers', () => {
  it('remembers a size-cap verdict instead of re-downloading the tarball', async () => {
    serveFixture('mini-repo.tar.gz');
    const first = await resolveRepoContext(client, 'acme', 'mini-repo', 'main', { cacheDir, maxBytes: 1 });
    expect(first).toEqual({ available: false, reason: 'size-cap' });
    expect(calls.length).toBe(1);

    const second = await resolveRepoContext(client, 'acme', 'mini-repo', 'main', { cacheDir, maxBytes: 1 });
    expect(second).toEqual({ available: false, reason: 'size-cap' });
    expect(calls.length).toBe(1); // answered from the marker, no second full download
  });

  it('remembers an empty-tree verdict', async () => {
    // Nothing scannable in the archive: a README and a PNG.
    const archive = tarArchive([
      { name: `${WRAPPER}/README.md`, body: '# nothing to index\n' },
      { name: `${WRAPPER}/assets/logo.png`, body: 'not-a-png' },
    ]);
    responder = async () => new Response(gzipSync(archive));

    expect(await resolveRepoContext(client, 'acme', 'docs-only', 'main', { cacheDir })).toEqual({
      available: false,
      reason: 'empty-tree',
    });
    expect(await resolveRepoContext(client, 'acme', 'docs-only', 'main', { cacheDir })).toEqual({
      available: false,
      reason: 'empty-tree',
    });
    expect(calls.length).toBe(1);
  });

  it('retries once the marker ages out, and forgets it after a good fetch', async () => {
    serveFixture('mini-repo.tar.gz');
    await resolveRepoContext(client, 'acme', 'mini-repo', 'main', { cacheDir, maxBytes: 1 });
    expect(calls.length).toBe(1);

    const retried = await resolveRepoContext(client, 'acme', 'mini-repo', 'main', {
      cacheDir,
      negativeMaxAgeMs: 0,
    });
    expect(retried.available).toBe(true);
    expect(calls.length).toBe(2);
    expect(await exists(join(snapshotDirFor(cacheDir, 'acme', 'mini-repo'), 'unavailable.json'))).toBe(false);
  });

  it('does not remember a transient fetch failure', async () => {
    responder = async () => new Response('rate limited', { status: 403 });
    await resolveRepoContext(client, 'acme', 'mini-repo', 'main', { cacheDir });
    serveFixture('mini-repo.tar.gz');
    const second = await resolveRepoContext(client, 'acme', 'mini-repo', 'main', { cacheDir });

    expect(second.available).toBe(true);
    expect(calls.length).toBe(2);
  });
});

describe('callers outside the diff', () => {
  it('reports a nonzero count for a module whose only importers are absent from the diff', async () => {
    serveFixture('mini-repo.tar.gz');
    const context = await resolveRepoContext(client, 'acme', 'mini-repo', 'main', { cacheDir });
    if (!context.available) throw new Error(`expected an available snapshot, got ${context.reason}`);

    // The "diff" touches only util.ts itself — every one of its callers is unchanged, and this is the
    // count the old diff-internal index reported as zero.
    const diffPaths = new Set(['src/util.ts']);
    expect(callersOf(context.index, 'src/util.ts', diffPaths)).toHaveLength(3);
  });
});
