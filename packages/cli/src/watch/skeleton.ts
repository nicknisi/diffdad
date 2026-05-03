import type { DiffFile } from '../github/types';

export type FileCategory = 'test' | 'config' | 'schema' | 'migration' | 'docs' | 'public-api' | 'source';

export type SkeletonFile = {
  path: string;
  category: FileCategory;
  additions: number;
  deletions: number;
  isNewFile: boolean;
  isDeleted: boolean;
};

export type BranchSkeleton = {
  totals: { additions: number; deletions: number; changedFiles: number };
  byCategory: Record<FileCategory, number>;
  touchedDirs: { dir: string; count: number }[];
  notable: SkeletonFile[];
  files: SkeletonFile[];
};

const TEST_RE = /(^|\/)(__tests__|tests?)\//i;
const TEST_SUFFIX_RE = /\.(test|spec)\.[a-z0-9]+$/i;
const MIGRATION_RE = /(^|\/)migrations?\//i;
const SCHEMA_RE = /(^|\/)(schema)\.(ts|js|prisma|sql)$/i;
const SCHEMA_PRISMA_RE = /(^|\/)prisma\/schema\.prisma$/i;
const DOCS_RE = /(^|\/)docs?\//i;
const MARKDOWN_RE = /\.(md|mdx)$/i;
const PUBLIC_API_RE = /(^|\/)(src\/index|index)\.(ts|tsx|js)$/i;
const DTS_RE = /\.d\.ts$/i;
const CONFIG_FILES = new Set([
  'package.json',
  'bun.lock',
  'package-lock.json',
  'yarn.lock',
  'tsconfig.json',
  '.oxlintrc.json',
  '.oxfmtrc.json',
  '.gitignore',
  '.npmrc',
]);
const CONFIG_PATTERNS = [
  /\.config\.(ts|js|mjs|cjs|json)$/i,
  /(^|\/)(vite|vitest|tailwind|eslint|prettier|postcss|babel|rollup|webpack)\.config\./i,
  /(^|\/)\.[a-z0-9-]+rc(\.[a-z]+)?$/i, // .eslintrc, .prettierrc, .oxlintrc.json (also caught above)
];

export function classifyFile(path: string): FileCategory {
  if (TEST_RE.test(path) || TEST_SUFFIX_RE.test(path)) return 'test';
  if (MIGRATION_RE.test(path)) return 'migration';
  if (SCHEMA_PRISMA_RE.test(path) || SCHEMA_RE.test(path)) return 'schema';
  const basename = path.split('/').pop() ?? path;
  if (CONFIG_FILES.has(basename)) return 'config';
  if (CONFIG_PATTERNS.some((re) => re.test(path))) return 'config';
  if (MARKDOWN_RE.test(path) || DOCS_RE.test(path)) return 'docs';
  if (PUBLIC_API_RE.test(path) || DTS_RE.test(path)) return 'public-api';
  return 'source';
}

function countLines(file: DiffFile): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const h of file.hunks) {
    for (const l of h.lines) {
      if (l.type === 'add') additions += 1;
      else if (l.type === 'remove') deletions += 1;
    }
  }
  return { additions, deletions };
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

export function buildBranchSkeleton(files: DiffFile[]): BranchSkeleton {
  const skeletonFiles: SkeletonFile[] = files.map((f) => {
    const { additions, deletions } = countLines(f);
    return {
      path: f.file,
      category: classifyFile(f.file),
      additions,
      deletions,
      isNewFile: f.isNewFile,
      isDeleted: f.isDeleted,
    };
  });

  const totals = skeletonFiles.reduce(
    (acc, f) => ({
      additions: acc.additions + f.additions,
      deletions: acc.deletions + f.deletions,
      changedFiles: acc.changedFiles + 1,
    }),
    { additions: 0, deletions: 0, changedFiles: 0 },
  );

  const byCategory: Record<FileCategory, number> = {
    test: 0,
    config: 0,
    schema: 0,
    migration: 0,
    docs: 0,
    'public-api': 0,
    source: 0,
  };
  for (const f of skeletonFiles) byCategory[f.category] += 1;

  const dirCounts = new Map<string, number>();
  for (const f of skeletonFiles) {
    const d = dirOf(f.path) || '.';
    dirCounts.set(d, (dirCounts.get(d) ?? 0) + 1);
  }
  const touchedDirs = [...dirCounts.entries()]
    .map(([dir, count]) => ({ dir, count }))
    .sort((a, b) => b.count - a.count || a.dir.localeCompare(b.dir))
    .slice(0, 8);

  const notable = [...skeletonFiles]
    .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
    .slice(0, 5);

  return { totals, byCategory, touchedDirs, notable, files: skeletonFiles };
}
