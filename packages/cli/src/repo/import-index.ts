import { readdir, readFile, stat } from 'fs/promises';
import { join, relative } from 'path';

const IMPORT_RE_SOURCE = /(?:from\s+['"]|require\(\s*['"]|import\s+['"])([^'"]+)['"]/;

/**
 * Every import/require specifier in a blob of source text.
 *
 * Shared by the two paths that need it: this index, which sees whole files, and `computeRisk`'s
 * diff-only fallback, which sees hunk lines. A fresh `RegExp` is minted per call deliberately — a
 * module-level `/g` regex carries `lastIndex` between calls, and the index walk interleaves `await`s
 * between files, which would corrupt the match position.
 */
export function extractImportsFromText(text: string): string[] {
  const re = new RegExp(IMPORT_RE_SOURCE.source, 'g');
  const imports: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match[1]) imports.push(match[1]);
  }
  return imports;
}

/**
 * Cheap "module name" derivation: strip extension and dirs to a basename.
 * e.g. `packages/cli/src/server.ts` -> `server`
 */
export function moduleNameFromPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.indexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/** Whether an import specifier plausibly resolves to `filePath`. Coarse by design; see `callersOf`. */
export function importTargetsFile(target: string, filePath: string): boolean {
  if (target.startsWith('.')) {
    // Relative path — too noisy to resolve precisely. Match on basename.
    const targetBase = target.split('/').pop() ?? target;
    const fileBase = moduleNameFromPath(filePath);
    return targetBase === fileBase;
  }
  // Bare specifier — only matches if the target path includes it.
  return filePath.toLowerCase().includes(target.toLowerCase());
}

/**
 * Repo-wide "who imports what", keyed by the same cheap module name `computeRisk` already uses for
 * diff-internal counting (`moduleNameFromPath`). Built once per snapshot and persisted beside it, so a
 * warm cache answers "who calls this file" with a map read instead of a scan.
 */
export type ImportIndex = {
  /** module name (basename without extension) -> repo-relative paths that import it */
  callers: Map<string, string[]>;
  /**
   * Total source files whose text was scanned. Exists so a consumer can distinguish "genuinely
   * nothing imports this" from "the index never got built" — those two must never render alike.
   */
  filesScanned: number;
};

/** JSON-safe shape of an {@link ImportIndex}. `JSON.stringify` turns a `Map` into `{}`, so the
 * round-trip has to be explicit — a silently empty index would make every warm-cache review report
 * zero callers, which is exactly the failure this index exists to remove. */
export type SerializedImportIndex = {
  version: number;
  callers: Record<string, string[]>;
  filesScanned: number;
};

/** Bump when the key derivation or serialized shape changes, so stale persisted indexes are rebuilt. */
export const IMPORT_INDEX_VERSION = 1;

/**
 * Directory fragments the index walk skips. Same set `narrative/diff-filter.ts` already treats as
 * noise: nothing under these is repository source, and counting `node_modules` as a caller would
 * inflate every popular module's centrality into meaninglessness.
 */
const SKIP_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  'vendor',
  'third_party',
  '__generated__',
  '__snapshots__',
  '.next',
  '.svelte-kit',
  '.git',
]);

/**
 * Extensions whose text can plausibly contain an import/require specifier. Everything else (images,
 * archives, fonts, compiled objects) is skipped — running the import regex over a PNG is wasted work.
 *
 * Deliberately generous about languages this regex will rarely match anything in (C/C++ headers, SQL,
 * Terraform). `filesScanned` is what separates "nothing imports this" from "no index", and a repo whose
 * whole source tree sits in an unlisted extension scans zero files, resolves to `empty-tree`, and pays a
 * full tarball download on every single review. A file scanned for nothing costs one regex pass; a
 * language left off this list costs the whole feature for that repository.
 */
const SOURCE_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'mts',
  'cts',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'vue',
  'svelte',
  'astro',
  'py',
  'rb',
  'go',
  'rs',
  'java',
  'kt',
  'kts',
  'swift',
  'php',
  'cs',
  'scala',
  'dart',
  'lua',
  'sh',
  'bash',
  'zsh',
  'fish',
  'ps1',
  // C family, including headers — a C or C++ repository is otherwise invisible to the index.
  'c',
  'cc',
  'cpp',
  'cxx',
  'h',
  'hh',
  'hpp',
  'hxx',
  'm',
  'mm',
  // BEAM languages
  'ex',
  'exs',
  'erl',
  'hrl',
  // Lisps
  'clj',
  'cljs',
  'cljc',
  'edn',
  // Functional and scientific
  'hs',
  'ml',
  'mli',
  'jl',
  'r',
  'nim',
  'zig',
  'elm',
  'v',
  // JVM extras
  'groovy',
  'gradle',
  // Perl
  'pl',
  'pm',
  // Data/infra source that still counts as a scanned file even when nothing matches
  'sql',
  'tf',
  'tfvars',
  'hcl',
  'proto',
]);

/**
 * Per-file read ceiling. A single generated-but-not-in-a-generated-directory file can be tens of
 * megabytes; the import regex over it buys nothing and the read cost is real.
 */
export const MAX_INDEXED_FILE_BYTES = 1_000_000;

function extensionOf(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

/** Whether a repo-relative path is a source file the index should read. Exported so the extraction
 * pass and the disk-walk rebuild agree on exactly one definition of "scannable". */
export function shouldScanFile(relPath: string): boolean {
  if (relPath === '') return false;
  const segments = relPath.split('/');
  // Every segment except the last is a directory — reject on any noise dir anywhere in the path.
  for (const segment of segments.slice(0, -1)) {
    if (SKIP_DIR_NAMES.has(segment)) return false;
  }
  return SOURCE_EXTENSIONS.has(extensionOf(relPath));
}

/**
 * Accumulates the index one file at a time. Two producers share it: the snapshot extractor (which
 * already holds each file's bytes in memory, so indexing costs no second read) and
 * {@link buildImportIndex} (which re-walks an already-extracted tree when the persisted JSON is
 * missing or corrupt).
 */
export class ImportIndexBuilder {
  private readonly callers = new Map<string, string[]>();
  private scanned = 0;

  /** Record every import in `text` as an inbound edge pointing at the imported module. */
  addFile(relPath: string, text: string): void {
    this.scanned++;
    const seen = new Set<string>();
    for (const target of extractImportsFromText(text)) {
      // Both relative (`./util`) and bare (`@scope/pkg`) specifiers collapse to a module name, which
      // is the granularity `computeRisk` reads. Bare specifiers naming npm packages simply key
      // entries no repo file ever looks up.
      const moduleName = moduleNameFromPath(target);
      if (moduleName === '' || moduleName === '.' || moduleName === '..') continue;
      if (seen.has(moduleName)) continue; // one file importing a module twice is one caller
      seen.add(moduleName);
      const list = this.callers.get(moduleName);
      if (list) list.push(relPath);
      else this.callers.set(moduleName, [relPath]);
    }
  }

  build(): ImportIndex {
    return { callers: this.callers, filesScanned: this.scanned };
  }
}

/**
 * Build the index by walking an already-extracted tree. The extraction path builds the index inline
 * instead (no second read); this exists for the rebuild case — a snapshot whose persisted index JSON
 * is absent or corrupt but whose tree is still on disk.
 */
export async function buildImportIndex(root: string): Promise<ImportIndex> {
  const builder = new ImportIndexBuilder();
  await walk(root, root, builder);
  return builder.build();
}

async function walk(root: string, dir: string, builder: ImportIndexBuilder): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // unreadable directory — index what we can rather than failing the review
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) continue; // never follow links out of the tree
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      await walk(root, full, builder);
      continue;
    }
    if (!entry.isFile()) continue;
    const rel = relative(root, full).split('\\').join('/');
    if (!shouldScanFile(rel)) continue;
    try {
      const info = await stat(full);
      if (info.size > MAX_INDEXED_FILE_BYTES) continue;
      builder.addFile(rel, await readFile(full, 'utf-8'));
    } catch {
      // unreadable file — skip it, an undercount is preferable to a failed review
    }
  }
}

/**
 * Repository files that import `filePath`'s module, minus anything in `exclude` (and the file itself).
 *
 * `exclude` is how a caller asks for *unchanged* callers: pass the diff's file paths and the result is
 * the set of dependents this PR does not touch, which is the number a "safe to skim" claim rests on.
 * Pass an empty set for total repo-wide centrality.
 */
export function callersOf(index: ImportIndex, filePath: string, exclude: Set<string>): string[] {
  const moduleName = moduleNameFromPath(filePath);
  const callers = index.callers.get(moduleName);
  if (!callers) return [];
  return callers.filter((caller) => caller !== filePath && !exclude.has(caller));
}

export function serializeImportIndex(index: ImportIndex): SerializedImportIndex {
  return {
    version: IMPORT_INDEX_VERSION,
    callers: Object.fromEntries(index.callers),
    filesScanned: index.filesScanned,
  };
}

/** Rehydrate a persisted index, or `null` if it is corrupt or from an older key derivation. */
export function deserializeImportIndex(raw: unknown): ImportIndex | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Partial<SerializedImportIndex>;
  if (obj.version !== IMPORT_INDEX_VERSION) return null;
  if (typeof obj.filesScanned !== 'number' || !Number.isFinite(obj.filesScanned)) return null;
  if (typeof obj.callers !== 'object' || obj.callers === null) return null;
  const callers = new Map<string, string[]>();
  for (const [moduleName, list] of Object.entries(obj.callers)) {
    if (!Array.isArray(list) || list.some((p) => typeof p !== 'string')) return null;
    callers.set(moduleName, list as string[]);
  }
  return { callers, filesScanned: obj.filesScanned };
}
