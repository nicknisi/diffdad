import { describe, expect, it } from 'bun:test';
import { classifyPath } from '../narrative/diff-filter';
import type { PrFileSummary } from '../github/types';
import { isMechanicalKind, triageFiles, triageKind } from '../narrative/triage';

const file = (path: string, additions = 1, deletions = 0): PrFileSummary => ({
  path,
  status: 'modified',
  additions,
  deletions,
});

describe('triageKind — criticality source and classification', () => {
  it('carries every classifyPath reason through verbatim, never reinterpreting one', () => {
    // The composition rule: classifyPath answers first and its answer wins. If this drifts, the prompt
    // filter and collapse evidence are seeing something different from what triage reports.
    for (const path of ['bun.lock', 'dist/app.min.js', 'vendor/lib.js', 'logo.png', '__snapshots__/a.snap']) {
      const mechanical = classifyPath(path);
      expect(mechanical).not.toBeNull();
      expect(triageKind(path)).toBe(mechanical!);
    }
  });

  it('classifies manifests, which classifyPath deliberately does not know about', () => {
    for (const path of ['package.json', 'go.mod', 'Cargo.toml', 'pyproject.toml', 'packages/web/package.json']) {
      expect(classifyPath(path)).toBeNull(); // precondition: classifyPath is not doing this
      expect(triageKind(path)).toBe('manifest');
    }
  });

  it('classifies requirements.txt as a manifest, not docs', () => {
    // A naive \.txt$ docs rule calls this documentation. It is a dependency manifest — the exact
    // "paths encode what a file is named, not what it does" failure the manifest kind exists to prevent.
    expect(triageKind('requirements.txt')).toBe('manifest');
    expect(triageKind('services/api/requirements.txt')).toBe('manifest');
  });

  it('classifies tests and docs', () => {
    expect(triageKind('src/a.test.ts')).toBe('test-only');
    expect(triageKind('src/__tests__/a.ts')).toBe('test-only');
    expect(triageKind('src/b.spec.tsx')).toBe('test-only');
    expect(triageKind('README.md')).toBe('docs');
    expect(triageKind('docs/guide.mdx')).toBe('docs');
    expect(triageKind('docs/ideation/x/spec.md')).toBe('docs');
  });

  it('does NOT treat .txt as docs', () => {
    expect(triageKind('NOTES.txt')).toBe('source');
  });

  it('calls ordinary code source — the kind that blocks the low-attention lane', () => {
    expect(triageKind('src/auth/session.ts')).toBe('source');
    expect(triageKind('packages/web/src/components/UnitRow.tsx')).toBe('source');
  });

  it('separates mechanical kinds from source', () => {
    expect(isMechanicalKind('lockfile')).toBe(true);
    expect(isMechanicalKind('manifest')).toBe(true);
    expect(isMechanicalKind('test-only')).toBe(true);
    expect(isMechanicalKind('docs')).toBe(true);
    expect(isMechanicalKind('source')).toBe(false);
  });
});

describe('triageFiles — criticality source', () => {
  it('sources criticality tags from risk.ts rather than a second keyword table', () => {
    const summary = triageFiles([file('src/auth/session.ts'), file('src/billing/invoice.ts')], 'sha1', false);
    // Tags come from risk.ts's CRITICALITY_KEYWORDS. Asserting the actual tags (not just "non-empty")
    // is what would catch a duplicated table drifting from the original.
    expect(summary.criticality).toContain('auth');
    expect(summary.criticality).toContain('session');
    expect(summary.criticality).toContain('payment');
    expect(summary.files[0]!.criticality).toContain('auth');
  });

  it('deduplicates tags across files while preserving first-appearance order', () => {
    const summary = triageFiles([file('src/auth/a.ts'), file('src/auth/b.ts')], 'sha1', false);
    expect(summary.criticality.filter((t) => t === 'auth')).toHaveLength(1);
  });

  it('reports no criticality for a purely mechanical PR', () => {
    const summary = triageFiles([file('bun.lock'), file('package.json')], 'sha1', false);
    expect(summary.criticality).toEqual([]);
    expect(summary.files.map((f) => f.kind)).toEqual(['lockfile', 'manifest']);
  });

  it('sums line counts and carries sha + truncated through', () => {
    const summary = triageFiles([file('a.md', 10, 2), file('b.md', 5, 3)], 'deadbeef', true);
    expect(summary.additions).toBe(15);
    expect(summary.deletions).toBe(5);
    expect(summary.sha).toBe('deadbeef');
    expect(summary.truncated).toBe(true);
  });

  it('handles an empty file list without inventing anything', () => {
    const summary = triageFiles([], 'sha1', false);
    expect(summary.files).toEqual([]);
    expect(summary.criticality).toEqual([]);
    expect(summary.additions).toBe(0);
  });
});
