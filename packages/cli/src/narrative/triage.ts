import type { PrFileSummary } from '../github/types';
import { classifyPath } from './diff-filter';
import { type CriticalityTag, classifyCriticality } from './risk';

/**
 * Path-derived triage inputs for the command center's queue — the answer to "does this PR need a
 * human?" computed without a narrative, so a lane exists before anything is opened.
 *
 * Everything here is a pure function of a file path. Nothing reads file contents, the repo snapshot,
 * or a generated narrative, which is what keeps this cheap enough to run at mint for one REST call and
 * zero model tokens.
 *
 * The composition rule is load-bearing: {@link classifyPath} is *called*, never modified. It feeds
 * `partitionMechanicalFiles` (which drops files from the LLM prompt) and the `generated` collapse
 * evidence, so widening it to know about manifests would silently change what the model sees and what
 * chapters collapse — neither of which triage has any business touching.
 */

/**
 * What a path is, for triage purposes only. A superset of `classifyPath`'s reasons: its whole union is
 * carried through verbatim, plus the three kinds only triage cares about.
 *
 * `source` is the important member — it means "classifies as nothing mechanical", and one of them is
 * enough to keep a PR out of the low-attention lane. It is deliberately not called `unknown`: the file
 * is not unclassified, it is classified as ordinary code.
 */
export type TriageKind =
  // carried straight from classifyPath
  | 'lockfile'
  | 'generated'
  | 'snapshot'
  | 'vendored'
  | 'minified'
  | 'binary'
  | 'oversized'
  // triage-only
  | 'manifest'
  | 'test-only'
  | 'docs'
  | 'source';

export type TriagedFile = {
  path: string;
  kind: TriageKind;
  criticality: CriticalityTag[];
};

export type TriageSummary = {
  files: TriagedFile[];
  /** Distinct tags across every file, first-appearance order. Non-empty forces the high-attention lane. */
  criticality: CriticalityTag[];
  additions: number;
  deletions: number;
  /**
   * The PR had more files than one page of `/pulls/:n/files`. Forces the high-attention lane: a PR too
   * large to see in one request is not a low-stakes one under any reading, and the alternative —
   * paginating — would let a diluted PR hide a critical file on page two.
   */
  truncated: boolean;
  /** Head SHA these inputs were gathered at, so staleness is detectable without re-fetching. */
  sha: string;
};

/**
 * Dependency manifests. Distinct from lockfiles because they are edited by hand and by bots alike, and
 * because `classifyPath` deliberately does not know about them — a manifest carries real intent, so
 * dropping it from an LLM prompt (which is what teaching `classifyPath` this would do) would be wrong.
 *
 * `requirements.txt` lives here rather than under `docs` for a reason worth stating: a naive `\.txt$`
 * docs rule classifies it as documentation, which is exactly the "paths encode what a file is named,
 * not what it does" failure this kind exists to prevent.
 */
const MANIFEST_BASENAMES = new Set([
  'package.json',
  'requirements.txt',
  'gemfile',
  'go.mod',
  'cargo.toml',
  'pyproject.toml',
  'composer.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'pipfile',
  'mix.exs',
]);

// Fourth module-private copy, matching risk.ts:62, collapse.ts:44, and hints.ts. House style here is a
// local copy over an export the pure modules would then share by accident (see the note at collapse.ts:43).
const TEST_PATTERNS = [/\.test\.[a-z]+$/i, /\.spec\.[a-z]+$/i, /\/__tests__\//, /\/tests?\//];

const DOC_EXTENSIONS = new Set(['md', 'mdx']);

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

function extension(path: string): string {
  const base = basename(path);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

function isTestPath(path: string): boolean {
  return TEST_PATTERNS.some((re) => re.test(path));
}

/**
 * Documentation, narrowly. Extension-based plus a `docs/` prefix, and pointedly NOT `.txt` — see the
 * `requirements.txt` note on {@link MANIFEST_BASENAMES}.
 */
function isDocsPath(path: string): boolean {
  if (DOC_EXTENSIONS.has(extension(path))) return true;
  return path === 'docs' || path.startsWith('docs/');
}

/**
 * One path's kind. `classifyPath` is consulted **first** and its answer wins outright — that ordering is
 * what makes this composition additive rather than a reinterpretation, so the prompt filter and collapse
 * evidence keep seeing exactly what they saw before.
 */
export function triageKind(path: string): TriageKind {
  const mechanical = classifyPath(path);
  if (mechanical) return mechanical;
  if (MANIFEST_BASENAMES.has(basename(path).toLowerCase())) return 'manifest';
  if (isTestPath(path)) return 'test-only';
  if (isDocsPath(path)) return 'docs';
  return 'source';
}

/** Kinds that carry no ordinary source change — the ones a low-attention lane may be built from. */
const MECHANICAL_KINDS: ReadonlySet<TriageKind> = new Set<TriageKind>([
  'lockfile',
  'generated',
  'snapshot',
  'vendored',
  'minified',
  'binary',
  'oversized',
  'manifest',
  'test-only',
  'docs',
]);

export function isMechanicalKind(kind: TriageKind): boolean {
  return MECHANICAL_KINDS.has(kind);
}

/** Classify a PR's file list into the summary the lane function reads. */
export function triageFiles(files: PrFileSummary[], sha: string, truncated: boolean): TriageSummary {
  const triaged: TriagedFile[] = [];
  const seenTags = new Set<CriticalityTag>();
  const criticality: CriticalityTag[] = [];
  let additions = 0;
  let deletions = 0;

  for (const file of files) {
    const tags = classifyCriticality(file.path);
    for (const tag of tags) {
      if (seenTags.has(tag)) continue;
      seenTags.add(tag);
      criticality.push(tag);
    }
    triaged.push({ path: file.path, kind: triageKind(file.path), criticality: tags });
    additions += file.additions;
    deletions += file.deletions;
  }

  return { files: triaged, criticality, additions, deletions, truncated, sha };
}
