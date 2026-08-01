import { describe, expect, it } from 'bun:test';
import type { PrFileSummary } from '../github/types';
import { triageFiles } from '../narrative/triage';
import { isDismissed, laneOf, laneSplit, needsYouReason } from '../units/lane';

const f = (path: string): PrFileSummary => ({ path, status: 'modified', additions: 1, deletions: 0 });
const summary = (paths: string[], opts: { truncated?: boolean } = {}) =>
  triageFiles(paths.map(f), 'sha1', opts.truncated ?? false);

const queued = (paths: string[], opts: { truncated?: boolean } = {}) => ({
  status: 'queued' as const,
  triage: summary(paths, opts),
});

// The five fixture PRs from the contract, as literal path lists.
const FIXTURES = {
  lockfileBump: ['package.json', 'bun.lock'],
  docsOnly: ['README.md', 'docs/guide.md', 'docs/outline.md'],
  testOnly: ['src/__tests__/a.test.ts', 'src/__tests__/b.test.ts'],
  adversarial: [...Array.from({ length: 39 }, (_, i) => `src/generated/pb/msg${i}.ts`), 'src/auth/expiry.ts'],
  hugePr: Array.from({ length: 100 }, (_, i) => `docs/page${i}.md`),
};

describe('lane assignment — fixture lane', () => {
  it('puts a lockfile + manifest bump in probably-not', () => {
    expect(laneOf(queued(FIXTURES.lockfileBump))).toBe('probably-not');
  });

  it('puts a docs-only PR in probably-not', () => {
    expect(laneOf(queued(FIXTURES.docsOnly))).toBe('probably-not');
  });

  it('puts a test-only PR in probably-not', () => {
    expect(laneOf(queued(FIXTURES.testOnly))).toBe('probably-not');
  });

  it('forces needs-you when 39 generated files hide one auth constant', () => {
    // The dilution attack. Bulk mechanical content must never outvote a criticality tag.
    const lane = laneOf(queued(FIXTURES.adversarial));
    expect(lane).toBe('needs-you');
    const reason = needsYouReason(summary(FIXTURES.adversarial));
    expect(reason?.kind).toBe('criticality');
  });

  it('forces needs-you for a PR too large for one file-list page, whatever its kinds', () => {
    // Every file here is docs — the truncation veto is the only thing stopping it, and it must be
    // enough, because the files we cannot see are precisely the ones that could change the answer.
    const lane = laneOf({ status: 'queued', triage: summary(FIXTURES.hugePr, { truncated: true }) });
    expect(lane).toBe('needs-you');
    expect(needsYouReason(summary(FIXTURES.hugePr, { truncated: true }))?.kind).toBe('truncated');
  });
});

describe('lane discrimination — both directions', () => {
  it('leaves probably-not non-empty on a realistic mixed queue', () => {
    // Guards against the degenerate implementation that routes everything to needs-you: it would
    // satisfy every "this must be needs-you" assertion above while recreating the status quo.
    const queue = [
      queued(FIXTURES.lockfileBump),
      queued(FIXTURES.docsOnly),
      queued(FIXTURES.testOnly),
      queued(FIXTURES.adversarial),
      queued(['src/search/paginate.ts']),
    ];
    const lanes = queue.map(laneOf);
    expect(lanes.filter((l) => l === 'probably-not').length).toBeGreaterThan(0);
    expect(lanes.filter((l) => l === 'needs-you').length).toBeGreaterThan(0);
  });

  it('one ordinary source file is enough to block probably-not', () => {
    expect(laneOf(queued(['README.md', 'bun.lock', 'src/pay/charge.ts']))).toBe('needs-you');
    const reason = needsYouReason(summary(['README.md', 'src/search/paginate.ts']));
    expect(reason?.kind).toBe('source-files');
    expect(reason).toMatchObject({ paths: ['src/search/paginate.ts'] });
  });
});

describe('lane assignment — total over missing evidence', () => {
  it('resolves a legacy unit with no triage summary to needs-you, never a neutral state', () => {
    expect(laneOf({ status: 'queued' })).toBe('needs-you');
    expect(needsYouReason(undefined)).toEqual({ kind: 'no-evidence' });
  });

  it('treats a zero-file summary as no evidence rather than vacuously safe', () => {
    // files.every(...) is true for an empty array. Without this guard a PR reporting zero files would
    // land in probably-not on a vacuous truth.
    expect(laneOf({ status: 'queued', triage: summary([]) })).toBe('needs-you');
    expect(needsYouReason(summary([]))).toEqual({ kind: 'no-evidence' });
  });
});

describe('lane assignment — status precedence', () => {
  it('routes changes_requested to in-flight regardless of triage', () => {
    expect(laneOf({ status: 'changes_requested', triage: summary(FIXTURES.docsOnly) })).toBe('in-flight');
  });

  it('routes approved and done to cleared regardless of triage', () => {
    expect(laneOf({ status: 'approved', triage: summary(FIXTURES.adversarial) })).toBe('cleared');
    expect(laneOf({ status: 'done' })).toBe('cleared');
  });
});

describe('lane log', () => {
  it('counts each lane and excludes dismissed units', () => {
    const split = laneSplit([
      queued(FIXTURES.docsOnly),
      queued(FIXTURES.adversarial),
      { ...queued(FIXTURES.lockfileBump), dismissedAtSha: 'abc123' },
      { status: 'changes_requested' },
      { status: 'approved' },
    ]);
    expect(split).toEqual({ 'needs-you': 1, 'probably-not': 1, 'in-flight': 1, cleared: 1 });
  });

  it('identifies a dismissed unit', () => {
    expect(isDismissed({ dismissedAtSha: 'abc' })).toBe(true);
    expect(isDismissed({})).toBe(false);
    expect(isDismissed({ dismissedAtSha: '' })).toBe(false);
  });
});
