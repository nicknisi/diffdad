import type { DiffFile } from '../github/types';

export type FileRisk = {
  file: string;
  /** Total of added + removed lines. */
  churn: number;
  /** Count of inbound imports/requires for this file's module across the kept diff. */
  inboundRefs: number;
  /** Whether the file path matches sensitive-area keywords. */
  criticality: CriticalityTag[];
  /** True if a non-test source file was added/changed but no test file in the same area was touched. */
  testGap: boolean;
  /** Combined risk score, higher = riskier. */
  score: number;
};

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

const IMPORT_RE = /(?:from\s+['"]|require\(\s*['"]|import\s+['"])([^'"]+)['"]/g;

function extractImports(file: DiffFile): string[] {
  const imports: string[] = [];
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'remove') continue;
      let match: RegExpExecArray | null;
      const text = line.content;
      while ((match = IMPORT_RE.exec(text)) !== null) {
        if (match[1]) imports.push(match[1]);
      }
      // Reset state across iterations
      IMPORT_RE.lastIndex = 0;
    }
  }
  return imports;
}

/**
 * Cheap "module name" derivation: strip extension and dirs to a basename.
 * e.g. `packages/cli/src/server.ts` -> `server`
 */
function moduleNameFromPath(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.indexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

function importTargetsFile(target: string, filePath: string): boolean {
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
 * Detect "test gap": a non-test file is added or changed in the same area as
 * no test file in the diff. This is a coarse proxy for the oracle gap; it
 * doesn't actually run tests, just notices when production code moved without
 * test code following.
 */
function detectTestGap(file: DiffFile, allFiles: DiffFile[]): boolean {
  if (isTestPath(file.file)) return false;
  if (file.isDeleted) return false;

  // What "area" does this file live in? Take the parent directory.
  const dir = file.file.split('/').slice(0, -1).join('/');
  const adjacentTests = allFiles.some((f) => f !== file && isTestPath(f.file) && f.file.startsWith(dir));
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
  // Centrality: more inbound refs = wider blast radius.
  score += Math.min(input.inboundRefs, 10) * 4;
  // Criticality keywords each add 8 points.
  score += input.criticality.length * 8;
  // Test gap is a strong signal.
  if (input.testGap) score += 15;
  // Deletions are usually less risky than additions, but still have impact.
  if (input.isDeleted) score *= 0.6;
  return Math.round(score);
}

export function computeRisk(files: DiffFile[]): FileRisk[] {
  // Build inbound-ref index: for each file, count how many other files in the diff import it.
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
      return { file: file.file, churn, inboundRefs, criticality, testGap, score };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Render a per-file risk hint block for inclusion in the prompt. The LLM uses
 * this to order chapters by risk and weight the reading plan.
 */
export function formatRiskHints(risks: FileRisk[]): string {
  if (risks.length === 0) return '';
  const lines = risks.slice(0, 30).map((r) => {
    const tags = r.criticality.length > 0 ? ` [${r.criticality.join(',')}]` : '';
    const gap = r.testGap ? ' [test-gap]' : '';
    const refs = r.inboundRefs > 0 ? ` inbound=${r.inboundRefs}` : '';
    return `- ${r.file} | risk=${r.score} churn=${r.churn}${refs}${tags}${gap}`;
  });
  return `Per-file risk signals (higher score = riskier; ordered by score):\n${lines.join('\n')}`;
}
