import { describe, expect, it } from 'vitest';
import type { DiffFile } from '../github/types';
import { buildBranchSkeleton, classifyFile } from '../watch/skeleton';

function file(path: string, opts: Partial<{ additions: number; deletions: number; isNewFile: boolean; isDeleted: boolean }> = {}): DiffFile {
  const adds = opts.additions ?? 1;
  const dels = opts.deletions ?? 0;
  return {
    file: path,
    isNewFile: opts.isNewFile ?? false,
    isDeleted: opts.isDeleted ?? false,
    hunks: [
      {
        header: '@@ -1,1 +1,1 @@',
        oldStart: 1,
        oldCount: dels,
        newStart: 1,
        newCount: adds,
        lines: [
          ...Array.from({ length: adds }, (_, i) => ({ type: 'add' as const, content: `a${i}`, lineNumber: { new: i + 1 } })),
          ...Array.from({ length: dels }, (_, i) => ({ type: 'remove' as const, content: `d${i}`, lineNumber: { old: i + 1 } })),
        ],
      },
    ],
  };
}

describe('classifyFile', () => {
  it('detects tests by directory', () => {
    expect(classifyFile('packages/cli/src/__tests__/foo.test.ts')).toBe('test');
    expect(classifyFile('src/foo.spec.ts')).toBe('test');
    expect(classifyFile('tests/integration/api.ts')).toBe('test');
  });

  it('detects migrations', () => {
    expect(classifyFile('db/migrations/0001_init.sql')).toBe('migration');
    expect(classifyFile('prisma/migrations/20240101_x/migration.sql')).toBe('migration');
  });

  it('detects schemas', () => {
    expect(classifyFile('prisma/schema.prisma')).toBe('schema');
    expect(classifyFile('src/db/schema.ts')).toBe('schema');
    expect(classifyFile('src/types/schema.ts')).toBe('schema');
  });

  it('detects config', () => {
    expect(classifyFile('vite.config.ts')).toBe('config');
    expect(classifyFile('tailwind.config.js')).toBe('config');
    expect(classifyFile('tsconfig.json')).toBe('config');
    expect(classifyFile('.oxlintrc.json')).toBe('config');
    expect(classifyFile('package.json')).toBe('config');
    expect(classifyFile('bun.lock')).toBe('config');
  });

  it('detects docs', () => {
    expect(classifyFile('README.md')).toBe('docs');
    expect(classifyFile('docs/dad-watch.md')).toBe('docs');
    expect(classifyFile('CHANGELOG.md')).toBe('docs');
  });

  it('detects public api', () => {
    expect(classifyFile('packages/cli/src/index.ts')).toBe('public-api');
    expect(classifyFile('src/types/public.d.ts')).toBe('public-api');
  });

  it('falls back to source', () => {
    expect(classifyFile('src/lib/foo.ts')).toBe('source');
    expect(classifyFile('packages/web/src/components/Hunk.tsx')).toBe('source');
  });
});

describe('buildBranchSkeleton', () => {
  const files: DiffFile[] = [
    file('packages/cli/src/watch-server.ts', { additions: 80, deletions: 10 }),
    file('packages/cli/src/__tests__/watch.test.ts', { additions: 40, deletions: 0, isNewFile: true }),
    file('packages/web/src/components/Foo.tsx', { additions: 20, deletions: 5 }),
    file('packages/web/src/components/Bar.tsx', { additions: 5, deletions: 1 }),
    file('docs/dad-watch.md', { additions: 200, deletions: 0 }),
    file('vite.config.ts', { additions: 2, deletions: 1 }),
  ];

  it('counts totals and category buckets', () => {
    const s = buildBranchSkeleton(files);
    expect(s.totals.changedFiles).toBe(6);
    expect(s.totals.additions).toBe(347);
    expect(s.totals.deletions).toBe(17);
    expect(s.byCategory.test).toBe(1);
    expect(s.byCategory.docs).toBe(1);
    expect(s.byCategory.config).toBe(1);
    expect(s.byCategory.source).toBe(3);
  });

  it('aggregates touched directories sorted by count', () => {
    const s = buildBranchSkeleton(files);
    const top = s.touchedDirs[0];
    expect(top.dir).toBe('packages/web/src/components');
    expect(top.count).toBe(2);
  });

  it('flags notable files by total change size', () => {
    const s = buildBranchSkeleton(files);
    expect(s.notable[0].path).toBe('docs/dad-watch.md');
    expect(s.notable.length).toBeLessThanOrEqual(5);
  });

  it('records every file in files[] preserving order', () => {
    const s = buildBranchSkeleton(files);
    expect(s.files.map((f) => f.path)).toEqual(files.map((f) => f.file));
  });
});
