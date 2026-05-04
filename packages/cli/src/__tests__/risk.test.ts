import { describe, expect, it } from 'vitest';
import { computeRisk, formatRiskHints } from '../narrative/risk';
import type { DiffFile } from '../github/types';

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

  it('counts inbound refs across the diff', () => {
    const utils = makeFile('src/utils.ts', { add: 1 });
    const consumer = makeFile('src/handler.ts', {
      add: 3,
      bodyAdd: ["import { foo } from './utils';", 'export function handle() {}', '// done'],
    });
    const risks = computeRisk([utils, consumer]);
    const utilsRisk = risks.find((r) => r.file === 'src/utils.ts');
    expect(utilsRisk?.inboundRefs).toBeGreaterThanOrEqual(1);
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
        criticality: ['auth', 'token'],
        testGap: true,
        score: 50,
      },
    ]);
    expect(hints).toContain('src/auth/x.ts');
    expect(hints).toContain('[auth,token]');
    expect(hints).toContain('[test-gap]');
    expect(hints).toContain('inbound=2');
  });
});
