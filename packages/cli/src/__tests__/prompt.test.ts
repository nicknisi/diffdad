import { describe, expect, it } from 'vitest';
import { buildNarrativePrompt, isMechanicalFile, partitionMechanicalFiles } from '../narrative/prompt';
import type { DiffFile } from '../github/types';

function fakeFile(file: string): DiffFile {
  return { file, isNewFile: false, isDeleted: false, hunks: [] };
}

describe('buildNarrativePrompt', () => {
  it('includes PR metadata and diff content', () => {
    const files: DiffFile[] = [
      {
        file: 'src/constants.ts',
        isNewFile: false,
        isDeleted: false,
        hunks: [
          {
            header: '@@ -1,2 +1,3 @@',
            oldStart: 1,
            oldCount: 2,
            newStart: 1,
            newCount: 3,
            lines: [
              {
                type: 'context',
                content: 'export const x = 1;',
                lineNumber: { old: 1, new: 1 },
              },
              {
                type: 'add',
                content: 'export const y = 2;',
                lineNumber: { new: 2 },
              },
            ],
          },
        ],
      },
    ];

    const { system, user } = buildNarrativePrompt({
      title: 'Add y constant',
      description: 'Adds a new y constant for downstream math.',
      labels: ['enhancement'],
      files,
      fileTree: ['src/constants.ts', 'src/index.ts'],
    });

    expect(system).toContain('semantic');
    expect(system).toContain('chapters');

    expect(user).toContain('Add y constant');
    expect(user).toContain('src/constants.ts');
    expect(user).toContain('export const y = 2;');
  });

  it('truncates the file tree to 200 entries', () => {
    const fileTree = Array.from({ length: 250 }, (_, i) => `src/file${i}.ts`);

    const { user } = buildNarrativePrompt({
      title: 'Big PR',
      description: '',
      labels: [],
      files: [],
      fileTree,
    });

    expect(user).toContain('src/file0.ts');
    expect(user).toContain('src/file199.ts');
    expect(user).not.toContain('src/file200.ts');
  });

  it('lists skipped mechanical files in the prompt without their diffs', () => {
    const files: DiffFile[] = [
      {
        file: 'src/main.ts',
        isNewFile: false,
        isDeleted: false,
        hunks: [
          {
            header: '@@ -1 +1 @@',
            oldStart: 1,
            oldCount: 1,
            newStart: 1,
            newCount: 1,
            lines: [{ type: 'add', content: 'console.log(1)', lineNumber: { new: 1 } }],
          },
        ],
      },
    ];

    const { user } = buildNarrativePrompt({
      title: 't',
      description: '',
      labels: [],
      files,
      fileTree: [],
      skippedFiles: ['bun.lock', 'dist/index.js'],
    });

    expect(user).toContain('Mechanical files omitted');
    expect(user).toContain('bun.lock');
    expect(user).toContain('dist/index.js');
  });
});

describe('isMechanicalFile', () => {
  it('flags lockfiles by basename', () => {
    expect(isMechanicalFile('bun.lock')).toBe(true);
    expect(isMechanicalFile('package-lock.json')).toBe(true);
    expect(isMechanicalFile('packages/web/yarn.lock')).toBe(true);
    expect(isMechanicalFile('apps/api/Gemfile.lock')).toBe(true);
    expect(isMechanicalFile('go.sum')).toBe(true);
  });

  it('flags minified, sourcemap, and generated dirs', () => {
    expect(isMechanicalFile('public/app.min.js')).toBe(true);
    expect(isMechanicalFile('public/app.min.css')).toBe(true);
    expect(isMechanicalFile('dist/index.js')).toBe(true);
    expect(isMechanicalFile('packages/web/dist/index.js')).toBe(true);
    expect(isMechanicalFile('build/output.txt')).toBe(true);
    expect(isMechanicalFile('node_modules/foo/index.js')).toBe(true);
    expect(isMechanicalFile('app.js.map')).toBe(true);
  });

  it('does not flag normal source files', () => {
    expect(isMechanicalFile('src/main.ts')).toBe(false);
    expect(isMechanicalFile('packages/cli/src/narrative/engine.ts')).toBe(false);
    expect(isMechanicalFile('README.md')).toBe(false);
    expect(isMechanicalFile('package.json')).toBe(false);
    expect(isMechanicalFile('LICENSE')).toBe(false);
  });
});

function bigFile(file: string, hunkCount: number, linesPerHunk: number): DiffFile {
  return {
    file,
    isNewFile: false,
    isDeleted: false,
    hunks: Array.from({ length: hunkCount }, (_, h) => ({
      header: `@@ -${h * 100} +${h * 100} @@`,
      oldStart: h * 100,
      oldCount: linesPerHunk,
      newStart: h * 100,
      newCount: linesPerHunk,
      lines: Array.from({ length: linesPerHunk }, (_, i) => ({
        type: 'add' as const,
        content: `line ${h}-${i}`,
        lineNumber: { new: h * 100 + i },
      })),
    })),
  };
}

describe('diff size caps', () => {
  it('truncates a file that exceeds the per-file line cap and notes it', () => {
    const huge = bigFile('src/huge.ts', 10, 200);
    const { user } = buildNarrativePrompt({
      title: 't',
      description: '',
      labels: [],
      files: [huge],
      fileTree: [],
    });

    expect(user).toContain('[FILE TRUNCATED:');
    expect(user).toContain('Files truncated to fit prompt budget');
    expect(user).toContain('src/huge.ts');
    expect(user).not.toContain('line 9-0');
  });

  it('drops files entirely when the global line budget is exhausted', () => {
    // Per-file cap is 800; global budget is 12000. 16 files * 800 = 12800 → last file dropped.
    const files = Array.from({ length: 16 }, (_, i) => bigFile(`src/file${i}.ts`, 5, 200));
    const { user } = buildNarrativePrompt({
      title: 't',
      description: '',
      labels: [],
      files,
      fileTree: [],
    });

    expect(user).toContain('Files entirely omitted because the prompt budget was exhausted');
    expect(user).toContain('src/file15.ts');
  });
});

describe('partitionMechanicalFiles', () => {
  it('splits files into narrate vs skipped', () => {
    const files = [
      fakeFile('src/main.ts'),
      fakeFile('bun.lock'),
      fakeFile('packages/web/dist/bundle.js'),
      fakeFile('docs/README.md'),
    ];

    const { narrate, skipped } = partitionMechanicalFiles(files);

    expect(narrate.map((f) => f.file)).toEqual(['src/main.ts', 'docs/README.md']);
    expect(skipped.map((f) => f.file)).toEqual(['bun.lock', 'packages/web/dist/bundle.js']);
  });
});
