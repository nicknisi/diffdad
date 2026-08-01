import { describe, expect, it } from 'vitest';
import { computeRisk, formatRiskHints, type CriticalityTag } from '../narrative/risk';
import type { DiffFile } from '../github/types';
import type { ImportIndex } from '../repo/import-index';
import type { RepoContext } from '../repo/snapshot';

/**
 * A snapshot whose index says `callers` files import each named module. The paths are synthetic — only
 * the count matters to `computeRisk`, and inventing real ones would just pad the fixture.
 */
function fakeRepoContext(callerCounts: Record<string, number>): RepoContext {
  const callers = new Map<string, string[]>();
  for (const [moduleName, count] of Object.entries(callerCounts)) {
    callers.set(
      moduleName,
      Array.from({ length: count }, (_, i) => `repo/consumer-${moduleName}-${i}.ts`),
    );
  }
  const index: ImportIndex = { callers, filesScanned: 500 };
  return { available: true, root: '/tmp/snapshot', ref: 'main', fetchedAt: Date.now(), index };
}

function makeFile(path: string, lines: { add?: number; remove?: number; bodyAdd?: string[] } = {}): DiffFile {
  const addCount = lines.add ?? 0;
  const removeCount = lines.remove ?? 0;
  const addLines = (lines.bodyAdd ?? Array.from({ length: addCount }, (_, i) => `+${i}`)).map((content, i) => ({
    type: 'add' as const,
    content,
    lineNumber: { new: i + 1 },
  }));
  const removeLines = Array.from({ length: removeCount }, (_, i) => ({
    type: 'remove' as const,
    content: `removed-${i}`,
    lineNumber: { old: i + 1 },
  }));
  return {
    file: path,
    isNewFile: false,
    isDeleted: false,
    hunks: [
      {
        header: '@@ -1 +1 @@',
        oldStart: 1,
        oldCount: removeCount,
        newStart: 1,
        newCount: addCount,
        lines: [...addLines, ...removeLines],
      },
    ],
  };
}

describe('computeRisk', () => {
  it('flags criticality keywords in path', () => {
    const files = [makeFile('src/auth/middleware.ts', { add: 10 })];
    const risks = computeRisk(files);
    expect(risks[0]?.criticality).toContain('auth');
    expect(risks[0]?.score).toBeGreaterThan(0);
  });

  it('detects test gaps when source code changes have no nearby test', () => {
    const files = [makeFile('src/handlers/checkout.ts', { add: 12 }), makeFile('src/utils/format.ts', { add: 3 })];
    const risks = computeRisk(files);
    const checkoutRisk = risks.find((r) => r.file === 'src/handlers/checkout.ts');
    expect(checkoutRisk?.testGap).toBe(true);
  });

  it('does not flag test-gap when adjacent test file is in the diff', () => {
    const files = [
      makeFile('src/handlers/checkout.ts', { add: 12 }),
      makeFile('src/handlers/checkout.test.ts', { add: 8 }),
    ];
    const risks = computeRisk(files);
    const checkoutRisk = risks.find((r) => r.file === 'src/handlers/checkout.ts');
    expect(checkoutRisk?.testGap).toBe(false);
  });

  it('falls back to diff-internal inbound counts with no repo snapshot', () => {
    const utils = makeFile('src/utils.ts', { add: 1 });
    const consumer = makeFile('src/handler.ts', {
      add: 3,
      bodyAdd: ["import { foo } from './utils';", 'export function handle() {}', '// done'],
    });
    const risks = computeRisk([utils, consumer]);
    const utilsRisk = risks.find((r) => r.file === 'src/utils.ts');
    expect(utilsRisk?.inboundRefs).toBeGreaterThanOrEqual(1);
    expect(utilsRisk?.inboundScope).toBe('diff');
  });

  it('counts inbound refs repo-wide when a snapshot is available', () => {
    // The diff touches utils.ts alone, so the diff-internal count is 0 — this is the case the whole
    // phase exists for: 40 files in the base branch import it and none of them are in the diff.
    const files = [makeFile('src/utils.ts', { add: 5 })];
    const risks = computeRisk(files, fakeRepoContext({ utils: 40 }));
    expect(risks[0]?.inboundRefs).toBe(40);
    expect(risks[0]?.inboundScope).toBe('repo');
    expect(computeRisk(files)[0]?.inboundRefs).toBe(0);
  });

  it('reports an unavailable snapshot as diff scope rather than pretending to repo scope', () => {
    const files = [makeFile('src/utils.ts', { add: 5 })];
    const risks = computeRisk(files, { available: false, reason: 'fetch-failed' });
    expect(risks[0]?.inboundScope).toBe('diff');
  });

  it('centrality still discriminates well above ten inbound refs', () => {
    // Under the old `Math.min(inboundRefs, 10) * 4` cap both of these scored an identical 40 for
    // centrality; the log-scaled term has to keep them apart, and in the right order.
    const busy = makeFile('src/busy.ts', { add: 20 });
    const hub = makeFile('src/hub.ts', { add: 20 });
    const risks = computeRisk([busy, hub], fakeRepoContext({ busy: 12, hub: 240 }));
    const busyScore = risks.find((r) => r.file === 'src/busy.ts')?.score ?? 0;
    const hubScore = risks.find((r) => r.file === 'src/hub.ts')?.score ?? 0;

    expect(busyScore).toBeGreaterThan(0);
    expect(hubScore).toBeGreaterThan(busyScore);
    expect(risks[0]?.file).toBe('src/hub.ts');
  });

  it('orders risks by score descending', () => {
    const files = [
      makeFile('docs/readme.md', { add: 2 }),
      makeFile('src/auth/sso.ts', { add: 80 }),
      makeFile('src/utils/format.ts', { add: 10 }),
    ];
    const risks = computeRisk(files);
    expect(risks[0]?.file).toBe('src/auth/sso.ts');
  });

  it('produces the same ordering with no repo argument as it does today', () => {
    const files = [
      makeFile('docs/readme.md', { add: 2 }),
      makeFile('src/auth/sso.ts', { add: 80 }),
      makeFile('src/utils/format.ts', { add: 10 }),
      makeFile('src/payments/charge.ts', { add: 40 }),
    ];
    // Every file here has zero inbound refs, where the rescaled centrality term contributes exactly
    // what the old capped one did (both are 0), so this ordering must be byte-identical to pre-change.
    expect(computeRisk(files).map((r) => r.file)).toEqual([
      'src/auth/sso.ts',
      'src/payments/charge.ts',
      'src/utils/format.ts',
      'docs/readme.md',
    ]);
    expect(computeRisk(files).every((r) => r.inboundRefs === 0 && r.inboundScope === 'diff')).toBe(true);
  });

  it('pins the diff-only ordering where the rescale genuinely changes it', () => {
    // The zero-inbound case above cannot see the rescale at all. With nonzero diff-internal counts it
    // bites, and the change is intentional: 3 diff-internal refs used to pay `min(3,10) * 4 = 12` and
    // now pay `log10(3) * 20 ≈ 9.5`. That is enough to hand the top slot to churn.
    //   core.ts   churn 4,  3 inbound -> old 6.0 + 12.0 + 15 = 33 | new 6.0 + 9.5 + 15 = 31
    //   widget.ts churn 50, 0 inbound -> old 17.0 +  0.0 + 15 = 32 | new unchanged        = 32
    // Small counts losing a little weight is the price of the term discriminating at all above ten; the
    // repo-wide path is where the numbers this ordering exists to serve come from.
    const importsCore = (label: string, filler: number) =>
      makeFile(`src/consumer-${label}.ts`, {
        bodyAdd: ["import { core } from './core';", ...Array.from({ length: filler }, () => '// filler')],
      });
    const files = [
      makeFile('src/core.ts', { add: 4 }),
      makeFile('src/widget.ts', { add: 50 }),
      importsCore('a', 3),
      importsCore('b', 5),
      importsCore('c', 7),
    ];

    const risks = computeRisk(files);
    expect(risks.find((r) => r.file === 'src/core.ts')?.inboundRefs).toBe(3);
    expect(risks.every((r) => r.inboundScope === 'diff')).toBe(true);
    expect(risks.map((r) => r.file)).toEqual([
      'src/widget.ts',
      'src/core.ts',
      'src/consumer-c.ts',
      'src/consumer-b.ts',
      'src/consumer-a.ts',
    ]);
  });
});

describe('formatRiskHints', () => {
  it('produces an empty string for empty input', () => {
    expect(formatRiskHints([])).toBe('');
  });

  it('renders criticality and test-gap tags', () => {
    const hints = formatRiskHints([
      {
        file: 'src/auth/x.ts',
        churn: 20,
        inboundRefs: 2,
        inboundScope: 'diff',
        criticality: ['auth', 'token'],
        testGap: true,
        score: 50,
      },
    ]);
    expect(hints).toContain('src/auth/x.ts');
    expect(hints).toContain('[auth,token]');
    expect(hints).toContain('[test-gap]');
    expect(hints).toContain('inbound=2(diff)');
  });

  it('labels the scope so the model knows which universe the count came from', () => {
    const base = { churn: 20, criticality: [] as CriticalityTag[], testGap: false, score: 10 };
    const repoHints = formatRiskHints([{ ...base, file: 'a.ts', inboundRefs: 87, inboundScope: 'repo' }]);
    expect(repoHints).toContain('inbound=87(repo)');

    const diffHints = formatRiskHints([{ ...base, file: 'a.ts', inboundRefs: 87, inboundScope: 'diff' }]);
    expect(diffHints).toContain('inbound=87(diff)');
  });

  it('keeps a repo-wide zero visible but still suppresses an uninformative diff-only zero', () => {
    const base = { churn: 20, criticality: [] as CriticalityTag[], testGap: false, score: 10, inboundRefs: 0 };
    expect(formatRiskHints([{ ...base, file: 'a.ts', inboundScope: 'repo' }])).toContain('inbound=0(repo)');
    expect(formatRiskHints([{ ...base, file: 'a.ts', inboundScope: 'diff' }])).not.toContain('inbound=0');
  });
});
