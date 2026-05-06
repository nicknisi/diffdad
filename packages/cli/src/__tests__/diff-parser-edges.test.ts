import { describe, expect, it } from 'vitest';
import { parseDiff } from '../github/diff-parser';

describe('parseDiff edge cases', () => {
  it('returns [] for empty / whitespace-only input', () => {
    expect(parseDiff('')).toEqual([]);
    expect(parseDiff('   \n\n')).toEqual([]);
  });

  it('handles "\\ No newline at end of file" markers without crashing', () => {
    const raw = [
      'diff --git a/x.txt b/x.txt',
      'index 1..2 100644',
      '--- a/x.txt',
      '+++ b/x.txt',
      '@@ -1,1 +1,1 @@',
      '-old',
      '\\ No newline at end of file',
      '+new',
      '\\ No newline at end of file',
      '',
    ].join('\n');
    const files = parseDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0]?.hunks[0]?.lines.map((l) => l.type)).toEqual(['remove', 'add']);
    expect(files[0]?.hunks[0]?.lines[0]?.content).toBe('old');
    expect(files[0]?.hunks[0]?.lines[1]?.content).toBe('new');
  });

  it('parses a hunk with default count (omitted, defaults to 1)', () => {
    const raw = [
      'diff --git a/x.ts b/x.ts',
      'index 1..2 100644',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -5 +5 @@',
      '-a',
      '+b',
      '',
    ].join('\n');
    const files = parseDiff(raw);
    const hunk = files[0]?.hunks[0];
    expect(hunk?.oldStart).toBe(5);
    expect(hunk?.oldCount).toBe(1);
    expect(hunk?.newStart).toBe(5);
    expect(hunk?.newCount).toBe(1);
  });

  it('handles multiple hunks within a single file', () => {
    const raw = [
      'diff --git a/x.ts b/x.ts',
      'index 1..2 100644',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1,1 +1,1 @@',
      '-a',
      '+b',
      '@@ -10,1 +10,1 @@',
      '-c',
      '+d',
      '',
    ].join('\n');
    const files = parseDiff(raw);
    expect(files[0]?.hunks).toHaveLength(2);
    expect(files[0]?.hunks[1]?.oldStart).toBe(10);
  });

  it('uses the new-side filename in renames', () => {
    // The b/ side is what we want to attribute changes to.
    const raw = [
      'diff --git a/old/path.ts b/new/path.ts',
      'similarity index 90%',
      'rename from old/path.ts',
      'rename to new/path.ts',
      'index 1..2 100644',
      '--- a/old/path.ts',
      '+++ b/new/path.ts',
      '@@ -1,1 +1,1 @@',
      '-x',
      '+y',
      '',
    ].join('\n');
    const files = parseDiff(raw);
    expect(files[0]?.file).toBe('new/path.ts');
  });

  it('parses mode-only / no-hunk file entries with hunks=[]', () => {
    const raw = ['diff --git a/x.sh b/x.sh', 'old mode 100644', 'new mode 100755', ''].join('\n');
    const files = parseDiff(raw);
    expect(files).toHaveLength(1);
    expect(files[0]?.file).toBe('x.sh');
    expect(files[0]?.hunks).toEqual([]);
    expect(files[0]?.isNewFile).toBe(false);
    expect(files[0]?.isDeleted).toBe(false);
  });

  it('skips a hunk header that does not match the regex', () => {
    const raw = [
      'diff --git a/x.ts b/x.ts',
      'index 1..2 100644',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ malformed @@',
      '@@ -1,1 +1,1 @@',
      '-a',
      '+b',
      '',
    ].join('\n');
    const files = parseDiff(raw);
    expect(files[0]?.hunks).toHaveLength(1);
    expect(files[0]?.hunks[0]?.oldStart).toBe(1);
  });

  it('breaks the hunk-line scan on an unrecognized prefix', () => {
    // Anything other than +/-/space/blank/\\ should terminate the hunk body.
    const raw = [
      'diff --git a/x.ts b/x.ts',
      'index 1..2 100644',
      '--- a/x.ts',
      '+++ b/x.ts',
      '@@ -1,2 +1,2 @@',
      '-a',
      '+b',
      'XJUNK', // unrecognized — parser stops adding lines here
      ' c',
      '',
    ].join('\n');
    const files = parseDiff(raw);
    expect(files[0]?.hunks).toHaveLength(1);
    expect(files[0]?.hunks[0]?.lines).toHaveLength(2);
  });
});
