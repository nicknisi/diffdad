import type { DiffFile } from '../github/types';
// The import-matching primitives live with the repo-wide index that is now their main consumer;
// `computeRisk`'s diff-only fallback below shares them so the two paths can never disagree about what
// counts as an import.
import { callersOf, extractImportsFromText, importTargetsFile, moduleNameFromPath } from '../repo/import-index';
// Type-only on purpose. `snapshot.ts` imports `import-index.ts`, which this file imports for real, so a
// value import of `RepoContext` would close a runtime cycle. `import type` erases at compile time.
import type { RepoContext } from '../repo/snapshot';

export type FileRisk = {
  file: string;
  /** Total of added + removed lines. */
  churn: number;
  /**
   * Count of inbound imports/requires for this file's module. Repo-wide when a snapshot was available,
   * otherwise limited to the kept diff — read {@link FileRisk.inboundScope} to know which.
   */
  inboundRefs: number;
  /** Which universe {@link FileRisk.inboundRefs} was counted over. */
  inboundScope: InboundScope;
  /** Whether the file path matches sensitive-area keywords. */
  criticality: CriticalityTag[];
  /** True if a non-test source file was added/changed but no test file in the same area was touched. */
  testGap: boolean;
  /** Combined risk score, higher = riskier. */
  score: number;
};

/**
 * Which universe an inbound-reference count was taken over. `'repo'` means every file in the base
 * branch was eligible; `'diff'` means only the files in this PR were, which is a floor, not a total.
 */
export type InboundScope = 'repo' | 'diff';

export type CriticalityTag =
  | 'auth'
  | 'security'
  | 'crypto'
  | 'payment'
  | 'migration'
  | 'permission'
  | 'token'
  | 'session'
  | 'database'
  | 'config'
  | 'infra';

const CRITICALITY_KEYWORDS: { tag: CriticalityTag; patterns: RegExp[] }[] = [
  { tag: 'auth', patterns: [/(^|\W)auth(\W|$)/i, /\blogin\b/i, /\bsignin\b/i, /\bsignup\b/i] },
  { tag: 'security', patterns: [/\bsecurity\b/i, /\bsanitize/i, /\bxss\b/i, /\bcsrf\b/i] },
  { tag: 'crypto', patterns: [/\bcrypto\b/i, /\bencrypt/i, /\bdecrypt/i, /\bhash\b/i, /\bsignature\b/i] },
  { tag: 'payment', patterns: [/\bpayment/i, /\bbilling\b/i, /\binvoice\b/i, /\bcharge\b/i, /\bstripe\b/i] },
  { tag: 'migration', patterns: [/\bmigration/i, /\bschema\b/i, /\bdb\/migrate/i] },
  { tag: 'permission', patterns: [/\bpermission/i, /\bauthorization/i, /\baccess[-_ ]control/i, /\brbac\b/i] },
  { tag: 'token', patterns: [/\btoken/i, /\bjwt\b/i, /\bbearer\b/i, /\bapi[-_ ]?key/i] },
  { tag: 'session', patterns: [/\bsession/i, /\bcookie\b/i] },
  { tag: 'database', patterns: [/\bdatabase\b/i, /\.sql$/i, /\bquery\b/i, /\borm\b/i] },
  { tag: 'config', patterns: [/\bconfig\b/i, /\benvironment\b/i, /\.env\b/i] },
  { tag: 'infra', patterns: [/\bdockerfile\b/i, /docker-compose/i, /\.github\/workflows/i, /terraform/i, /\bk8s\b/i] },
];

const TEST_PATTERNS = [/\.test\.[a-z]+$/i, /\.spec\.[a-z]+$/i, /\/__tests__\//, /\/tests?\//];

function isTestPath(path: string): boolean {
  return TEST_PATTERNS.some((re) => re.test(path));
}

function classifyCriticality(path: string): CriticalityTag[] {
  const tags: CriticalityTag[] = [];
  for (const entry of CRITICALITY_KEYWORDS) {
    if (entry.patterns.some((re) => re.test(path))) tags.push(entry.tag);
  }
  return tags;
}

function fileChurn(file: DiffFile): number {
  let churn = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add' || line.type === 'remove') churn++;
    }
  }
  return churn;
}

function extractImports(file: DiffFile): string[] {
  const imports: string[] = [];
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'remove') continue;
      imports.push(...extractImportsFromText(line.content));
    }
  }
  return imports;
}

/**
 * Detect "test gap": a non-test file is added or changed in the same area as
 * no test file in the diff. This is a coarse proxy for the oracle gap; it
 * doesn't actually run tests, just notices when production code moved without
 * test code following.
 */
function detectTestGap(file: DiffFile, allFiles: DiffFile[]): boolean {
  if (isTestPath(file.file)) return false;
  if (file.isDeleted) return false;

  // What "area" does this file live in? Take the parent directory. For
  // root-level files (no slash) only count tests that are also at the root,
  // otherwise any test anywhere would suppress the gap signal.
  const segments = file.file.split('/');
  const dir = segments.slice(0, -1).join('/');
  const adjacentTests = allFiles.some((f) => {
    if (f === file || !isTestPath(f.file)) return false;
    if (dir === '') return !f.file.includes('/');
    return f.file.startsWith(dir + '/');
  });
  if (adjacentTests) return false;

  // No tests in the same dir. Check broader: any test file mentions this module by import.
  const moduleName = moduleNameFromPath(file.file);
  const mentioned = allFiles.some((f) => {
    if (f === file || !isTestPath(f.file)) return false;
    return extractImports(f).some((imp) => imp.includes(moduleName));
  });
  if (mentioned) return false;

  // Only flag as a gap if the file actually has substantive added code.
  return fileChurn(file) >= 4;
}

const CENTRALITY_WEIGHT = 20;

function computeScore(input: {
  churn: number;
  inboundRefs: number;
  criticality: CriticalityTag[];
  testGap: boolean;
  isNewFile: boolean;
  isDeleted: boolean;
}): number {
  let score = 0;
  // Churn: log-scaled so a 1000-line file isn't 100x scarier than a 10-line file.
  score += Math.log10(Math.max(input.churn, 1)) * 10;
  // Centrality: more inbound refs = wider blast radius. Log-scaled for the same reason churn is, and
  // it has to be: this used to be `Math.min(inboundRefs, 10) * 4`, calibrated for diff-internal counts
  // that never got far past 10. Repo-wide counts saturate that cap for every non-leaf file, which
  // turns centrality into a constant 40 and erases the discrimination it exists to provide.
  // CENTRALITY_WEIGHT is set so ~100 repo-wide callers scores where 10 diff-internal callers used to
  // (log10(100) * 20 === 40), keeping centrality's weight against churn and criticality unchanged.
  score += Math.log10(Math.max(input.inboundRefs, 1)) * CENTRALITY_WEIGHT;
  // Criticality keywords each add 8 points.
  score += input.criticality.length * 8;
  // Test gap is a strong signal.
  if (input.testGap) score += 15;
  // Deletions are usually less risky than additions, but still have impact.
  if (input.isDeleted) score *= 0.6;
  return Math.round(score);
}

/** Count inbound refs among the diff's own files — the only universe available with no snapshot. */
function diffInternalInboundCounts(files: DiffFile[]): Map<string, number> {
  const inboundCounts = new Map<string, number>();
  for (const candidate of files) {
    inboundCounts.set(candidate.file, 0);
  }
  for (const file of files) {
    const imports = extractImports(file);
    for (const target of imports) {
      for (const candidate of files) {
        if (candidate === file) continue;
        if (importTargetsFile(target, candidate.file)) {
          inboundCounts.set(candidate.file, (inboundCounts.get(candidate.file) ?? 0) + 1);
        }
      }
    }
  }
  return inboundCounts;
}

/**
 * Per-file risk signals for a diff, ordered riskiest first.
 *
 * With a `repo` snapshot available, `inboundRefs` counts every file in the base branch that imports
 * each changed file — the actual blast radius. Without one it falls back to counting only among the
 * diff's own files, which systematically reads a widely-imported file as a leaf. `inboundScope` on
 * each result records which of the two produced the number, so a consumer (and the model) never has
 * to guess, and a call site that forgets to pass context shows up in the hints instead of vanishing.
 */
export function computeRisk(files: DiffFile[], repo?: RepoContext): FileRisk[] {
  const inboundScope: InboundScope = repo?.available ? 'repo' : 'diff';
  let inboundCounts: Map<string, number>;
  if (repo?.available) {
    // Total centrality, so the queried file's own callers all count even when they are also in the
    // diff. (Phase 2's "unchanged callers" number is what `callersOf`'s exclude set is for.)
    inboundCounts = new Map(files.map((f) => [f.file, callersOf(repo.index, f.file, new Set()).length]));
  } else {
    inboundCounts = diffInternalInboundCounts(files);
  }

  return files
    .map((file) => {
      const churn = fileChurn(file);
      const criticality = classifyCriticality(file.file);
      const inboundRefs = inboundCounts.get(file.file) ?? 0;
      const testGap = detectTestGap(file, files);
      const score = computeScore({
        churn,
        inboundRefs,
        criticality,
        testGap,
        isNewFile: file.isNewFile,
        isDeleted: file.isDeleted,
      });
      return { file: file.file, churn, inboundRefs, inboundScope, criticality, testGap, score };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Render a per-file risk hint block for inclusion in the prompt. The LLM uses
 * this to order chapters by risk and weight the reading plan.
 *
 * Inbound counts carry their scope. `inbound=N(repo)` was counted across the whole base branch and is
 * a real blast-radius number; `inbound=N(diff)` only saw the files in this PR and is a floor. A repo
 * count of zero is printed rather than suppressed — with the whole repository in scope, "nothing known
 * imports this" is a finding, and the import index undercounts (dynamic imports, re-export barrels),
 * so it is stated as *known* callers rather than as an absence of callers.
 */
export function formatRiskHints(risks: FileRisk[]): string {
  if (risks.length === 0) return '';
  const lines = risks.slice(0, 30).map((r) => {
    const tags = r.criticality.length > 0 ? ` [${r.criticality.join(',')}]` : '';
    const gap = r.testGap ? ' [test-gap]' : '';
    const showRefs = r.inboundScope === 'repo' || r.inboundRefs > 0;
    const refs = showRefs ? ` inbound=${r.inboundRefs}(${r.inboundScope})` : '';
    return `- ${r.file} | risk=${r.score} churn=${r.churn}${refs}${tags}${gap}`;
  });
  return [
    'Per-file risk signals (higher score = riskier; ordered by score):',
    ...lines,
    'inbound=N(repo) is known importers across the whole base branch (an undercount — dynamic imports and',
    're-export barrels are invisible to it, so treat 0 as "no known callers", not "no callers").',
    'inbound=N(diff) means no repository snapshot was available and only files in this PR were counted.',
  ].join('\n');
}
