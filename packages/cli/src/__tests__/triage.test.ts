import { describe, expect, it } from 'bun:test';
import type { DiffFile } from '../github/types';
import { parseTriageFlags } from '../triage/triage';

const files: DiffFile[] = [
  { file: 'src/auth.ts', isNewFile: false, isDeleted: false, hunks: [] },
  { file: 'src/auth.test.ts', isNewFile: false, isDeleted: false, hunks: [] },
];

describe('parseTriageFlags', () => {
  it('parses a JSON array and sorts by severity (risk first)', () => {
    const text = JSON.stringify([
      { file: 'src/auth.ts', severity: 'info', kind: 'sprawl', message: 'large change' },
      { file: 'src/auth.test.ts', line: 12, severity: 'risk', kind: 'rewritten-tests', message: 'assertion changed' },
    ]);
    const flags = parseTriageFlags(text, files);
    expect(flags).toHaveLength(2);
    expect(flags[0]?.severity).toBe('risk');
    expect(flags[0]?.line).toBe(12);
    expect(flags[1]?.severity).toBe('info');
  });

  it('tolerates markdown fences and surrounding prose', () => {
    const text =
      'Here you go:\n```json\n[{"file":"src/auth.ts","severity":"warn","kind":"duplication","message":"dupes existing helper"}]\n```';
    const flags = parseTriageFlags(text, files);
    expect(flags).toHaveLength(1);
    expect(flags[0]?.kind).toBe('duplication');
  });

  it('returns [] on non-JSON, empty input, or an empty array', () => {
    expect(parseTriageFlags('no json here', files)).toEqual([]);
    expect(parseTriageFlags('', files)).toEqual([]);
    expect(parseTriageFlags('[]', files)).toEqual([]);
  });

  it('drops hallucinated paths, empty messages, and non-objects', () => {
    const text = JSON.stringify([
      { file: 'does/not/exist.ts', severity: 'risk', kind: 'x', message: 'nope' },
      { file: 'src/auth.ts', severity: 'warn', kind: 'x', message: '' },
      { file: 'src/auth.ts', severity: 'warn', kind: 'untrusted-input', message: 'real' },
      'garbage',
    ]);
    const flags = parseTriageFlags(text, files);
    expect(flags).toHaveLength(1);
    expect(flags[0]?.message).toBe('real');
  });

  it('resolves minor path drift by suffix', () => {
    const text = JSON.stringify([{ file: 'auth.ts', severity: 'warn', kind: 'x', message: 'm' }]);
    expect(parseTriageFlags(text, files)[0]?.file).toBe('src/auth.ts');
  });

  it('defaults an unknown severity to warn', () => {
    const text = JSON.stringify([{ file: 'src/auth.ts', severity: 'nonsense', kind: 'x', message: 'm' }]);
    expect(parseTriageFlags(text, files)[0]?.severity).toBe('warn');
  });

  it('caps at 8 flags', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      file: 'src/auth.ts',
      severity: 'warn',
      kind: 'x',
      message: `m${i}`,
    }));
    expect(parseTriageFlags(JSON.stringify(many), files)).toHaveLength(8);
  });
});
