import { readFile } from 'fs/promises';
import { describe, expect, it } from 'vitest';
import { FIXTURES } from '../eval/fixtures';
import type { EvalFixture } from '../eval/types';
import { narratedDiffLines, selectCollapsible } from '../narrative/collapse';
import { computeRisk, type FileRisk } from '../narrative/risk';
import {
  normalizeNarrative,
  type NarrativeChapter,
  type NarrativeResponse,
  type NarrativeSection,
} from '../narrative/types';
import type { ImportIndex } from '../repo/import-index';
import type { RepoContext } from '../repo/snapshot';

/**
 * A snapshot whose index says `count` files import each named module. Same helper `risk.test.ts` uses,
 * and the keys are the same thing `callersOf` looks up: a **module basename**, not a file path.
 */
function fakeRepoContext(callerCounts: Record<string, number>, filesScanned = 500): RepoContext {
  const callers = new Map<string, string[]>();
  for (const [moduleName, count] of Object.entries(callerCounts)) {
    callers.set(
      moduleName,
      Array.from({ length: count }, (_, i) => `repo/consumer-${moduleName}-${i}.ts`),
    );
  }
  const index: ImportIndex = { callers, filesScanned };
  return { available: true, root: '/tmp/snapshot', ref: 'main', fetchedAt: Date.now(), index };
}

/**
 * The synthetic base-branch import index for each fixture, and the most load-bearing authored artifact
 * in this file: `selectCollapsible` needs `risks` and a `RepoContext`, and neither a recording nor an
 * `EvalFixture` carries either. Production gets these from a real snapshot; here they are declared, so
 * whether the safety and compression tests do any work is decided right here.
 *
 * Keys are module basenames. Deliberate omissions:
 *
 * - `profile-cache` (cache-race-condition's hotspot) has **no** entry, because it is a brand-new module
 *   and zero known callers is the honest answer. Nothing but the risk-signal veto keeps it open, which
 *   is exactly the property under test.
 * - `retry-policy` (one of large-refactor's hotspots) has an entry and nothing else about it looks
 *   risky, so its unchanged callers are the only thing holding that chapter open.
 * - The renamed leaf components have no entries, which is what makes the mechanical tail collapsible.
 */
const REPO_CALLERS: Record<string, Record<string, number>> = {
  'auth-token-validation': { middleware: 9, jwks: 3 },
  'cache-race-condition': { client: 12 },
  'large-refactor': { 'invoice-calculator': 14, 'tax-rules': 6, 'retry-policy': 31, money: 44 },
  'migration-without-rollback': { users: 5 },
  'safe-rename': { Layout: 4 },
};

async function loadRecording(fixture: EvalFixture): Promise<NarrativeResponse> {
  const path = fixture.recordedNarrativePath;
  if (!path) throw new Error(`fixture ${fixture.id} has no recordedNarrativePath`);
  // Read + parse + normalize, which is the same route the production cache path takes. A static JSON
  // import would typecheck but infer a wide structural literal whose `sections` is not NarrativeSection[].
  return normalizeNarrative(JSON.parse(await readFile(path, 'utf-8')));
}

function diffSectionsOf(chapter: NarrativeChapter): Extract<NarrativeSection, { type: 'diff' }>[] {
  return chapter.sections.filter((s): s is Extract<NarrativeSection, { type: 'diff' }> => s.type === 'diff');
}

/** A chapter over the given files, one diff section each, spanning `lines` new-side lines from line 1. */
function chapterOf(files: string[], lines = 10): NarrativeChapter {
  return {
    title: 'chapter',
    summary: '',
    whyMatters: '',
    risk: 'low',
    sections: files.map((file, hunkIndex) => ({ type: 'diff', file, startLine: 1, endLine: lines, hunkIndex })),
  };
}

/** A quiet risk entry: no criticality keywords, no test gap. Override to make it shout. */
function riskOf(file: string, over: Partial<FileRisk> = {}): FileRisk {
  return {
    file,
    churn: 4,
    inboundRefs: 0,
    inboundScope: 'repo',
    criticality: [],
    testGap: false,
    score: 10,
    ...over,
  };
}

describe('selectCollapsible', () => {
  it('returns no decisions and no divider for an empty chapter list', () => {
    const result = selectCollapsible([], [], fakeRepoContext({}));
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.decisions).toEqual([]);
    expect(result.dividerBefore).toBeNull();
  });

  it('returns the unavailable variant with its reason even when the chapters would collapse', () => {
    const chapters = [chapterOf(['src/utils/leaf.ts'])];
    const risks = [riskOf('src/utils/leaf.ts')];
    // Sanity: with a warm context this exact input does collapse, so the short-circuit is doing the work.
    const warm = selectCollapsible(chapters, risks, fakeRepoContext({}));
    expect(warm.available && warm.decisions.length).toBe(1);

    const result = selectCollapsible(chapters, risks, { available: false, reason: 'size-cap' });
    expect(result).toEqual({ available: false, reason: 'size-cap' });
  });

  it('produces no decisions when the index scanned zero files, rather than reading an empty map as certainty', () => {
    const chapters = [chapterOf(['src/utils/leaf.ts']), chapterOf(['src/utils/leaf.test.ts'])];
    const risks = [riskOf('src/utils/leaf.ts'), riskOf('src/utils/leaf.test.ts')];
    const result = selectCollapsible(chapters, risks, fakeRepoContext({}, 0));
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.decisions).toEqual([]);
    expect(result.dividerBefore).toBeNull();
  });

  it('finds no evidence, and draws no divider, when every file still has callers outside the PR', () => {
    const chapters = [chapterOf(['src/api/orders.ts']), chapterOf(['src/api/refunds.ts'])];
    const risks = [riskOf('src/api/orders.ts'), riskOf('src/api/refunds.ts')];
    const result = selectCollapsible(chapters, risks, fakeRepoContext({ orders: 12, refunds: 3 }));
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.decisions).toEqual([]);
    expect(result.dividerBefore).toBeNull();
  });

  it('does not collapse a mixed chapter holding one test file and one live source file', () => {
    const chapters = [chapterOf(['src/api/orders.test.ts', 'src/api/orders.ts'])];
    const risks = [riskOf('src/api/orders.test.ts'), riskOf('src/api/orders.ts')];
    // `orders` has callers, so the caller check fails; the chapter is not all tests either.
    const result = selectCollapsible(chapters, risks, fakeRepoContext({ orders: 12 }));
    expect(result.available && result.decisions).toEqual([]);
  });

  it('does not collapse a chapter with no diff sections', () => {
    const chapters: NarrativeChapter[] = [
      {
        title: 'prose only',
        summary: '',
        whyMatters: '',
        risk: 'low',
        sections: [{ type: 'narrative', content: 'x' }],
      },
      { title: 'placeholder', summary: '', whyMatters: '', risk: 'low', sections: [] },
    ];
    const result = selectCollapsible(chapters, [], fakeRepoContext({}));
    expect(result.available && result.decisions).toEqual([]);
  });

  it('keeps a chapter open when any of its files carries a criticality keyword', () => {
    const chapters = [chapterOf(['src/auth/session-store.ts', 'src/utils/leaf.ts'])];
    const risks = [
      riskOf('src/auth/session-store.ts', { criticality: ['auth', 'session'] }),
      riskOf('src/utils/leaf.ts'),
    ];
    const result = selectCollapsible(chapters, risks, fakeRepoContext({}));
    expect(result.available && result.decisions).toEqual([]);
  });

  it('keeps a chapter open when any of its files has a test gap', () => {
    const chapters = [chapterOf(['src/domain/pricing.ts'])];
    const risks = [riskOf('src/domain/pricing.ts', { testGap: true, churn: 40 })];
    const result = selectCollapsible(chapters, risks, fakeRepoContext({}));
    expect(result.available && result.decisions).toEqual([]);
  });

  it('keeps a chapter open when a file it references has no risk entry at all', () => {
    const chapters = [chapterOf(['src/utils/leaf.ts', 'src/utils/unknown.ts'])];
    const risks = [riskOf('src/utils/leaf.ts')];
    const result = selectCollapsible(chapters, risks, fakeRepoContext({}));
    expect(result.available && result.decisions).toEqual([]);
  });

  it('collapses a test-only chapter and states the count rather than a judgment', () => {
    const files = ['src/api/__tests__/orders.test.ts', 'src/api/refunds.spec.ts'];
    const chapters = [chapterOf(files)];
    const result = selectCollapsible(
      chapters,
      files.map((f) => riskOf(f)),
      fakeRepoContext({ orders: 9, refunds: 4 }),
    );
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]?.evidence).toEqual({ kind: 'test-only', files });
    expect(result.decisions[0]?.reason).toBe('2 test files, no source files');
    expect(result.dividerBefore).toBe(0);
  });

  it('collapses a chapter whose files are all generated or vendored by path', () => {
    const files = ['src/__generated__/schema-types.ts', 'vendor/highlight-theme.css'];
    const chapters = [chapterOf(files)];
    const result = selectCollapsible(
      chapters,
      files.map((f) => riskOf(f)),
      fakeRepoContext({}),
    );
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.decisions[0]?.evidence.kind).toBe('generated');
  });

  it('counts known callers with the PR own files excluded, so an internal importer is not a reprieve', () => {
    const chapters = [chapterOf(['src/utils/leaf.ts'])];
    const risks = [riskOf('src/utils/leaf.ts'), riskOf('src/api/consumer-leaf-0.ts')];
    // The index says one file imports `leaf`, and that file is `repo/consumer-leaf-0.ts` — not in the
    // diff, so it counts and the chapter stays open.
    const withOutsideCaller = selectCollapsible(chapters, risks, fakeRepoContext({ leaf: 1 }));
    expect(withOutsideCaller.available && withOutsideCaller.decisions).toEqual([]);

    // Same shape, but the only importer is a file this PR already changes, so it is excluded and the
    // chapter has zero *unchanged* callers.
    const insideOnly = fakeRepoContext({});
    if (insideOnly.available) insideOnly.index.callers.set('leaf', ['src/api/consumer-leaf-0.ts']);
    const result = selectCollapsible(chapters, risks, insideOnly);
    expect(result.available && result.decisions).toHaveLength(1);
    expect(result.available && result.decisions[0]?.evidence).toEqual({
      kind: 'no-external-callers',
      files: ['src/utils/leaf.ts'],
      knownCallers: 0,
    });
  });

  it('withholds the divider when the collapsed chapters are not a contiguous suffix', () => {
    const chapters = [
      chapterOf(['src/api/orders.ts']), // has callers -> open
      chapterOf(['src/api/__tests__/leaf.test.ts']), // collapses
      chapterOf(['src/api/refunds.ts']), // has callers -> open
    ];
    const risks = [riskOf('src/api/orders.ts'), riskOf('src/api/__tests__/leaf.test.ts'), riskOf('src/api/refunds.ts')];
    const result = selectCollapsible(chapters, risks, fakeRepoContext({ orders: 8, refunds: 8 }));
    expect(result.available).toBe(true);
    if (!result.available) return;
    expect(result.decisions.map((d) => d.chapterIndex)).toEqual([1]);
    // The decision stands; the single divider does not, because drawing it at index 1 would render an
    // expanded chapter below the collapsed boundary.
    expect(result.dividerBefore).toBeNull();
  });

  it('normalizes a/ and b/ prefixes before matching sections against risks', () => {
    const chapters = [chapterOf(['b/src/utils/leaf.ts'])];
    const risks = [riskOf('a/src/utils/leaf.ts')];
    const result = selectCollapsible(chapters, risks, fakeRepoContext({}));
    expect(result.available && result.decisions).toHaveLength(1);
  });
});

describe('narratedDiffLines', () => {
  it('sums inclusive diff-section ranges and ignores prose sections', () => {
    const chapters: NarrativeChapter[] = [
      {
        title: '',
        summary: '',
        whyMatters: '',
        risk: 'low',
        sections: [
          { type: 'narrative', content: 'ignored' },
          { type: 'diff', file: 'a.ts', startLine: 1, endLine: 10, hunkIndex: 0 },
          { type: 'diff', file: 'b.ts', startLine: 5, endLine: 5, hunkIndex: 0 },
        ],
      },
    ];
    expect(narratedDiffLines(chapters)).toBe(11);
  });

  it('clamps a reversed range at zero rather than subtracting from the total', () => {
    const chapters: NarrativeChapter[] = [
      {
        title: '',
        summary: '',
        whyMatters: '',
        risk: 'low',
        sections: [
          { type: 'diff', file: 'a.ts', startLine: 20, endLine: 4, hunkIndex: 0 },
          { type: 'diff', file: 'b.ts', startLine: 1, endLine: 3, hunkIndex: 0 },
        ],
      },
    ];
    expect(narratedDiffLines(chapters)).toBe(3);
  });
});

describe('recorded narratives', () => {
  it('resolves a recorded narrative for every fixture, parseable and referencing only that fixture files', async () => {
    expect(FIXTURES.length).toBe(5);
    for (const fixture of FIXTURES) {
      expect(fixture.recordedNarrativePath, `${fixture.id} has no recording`).toBeTruthy();
      const narrative = await loadRecording(fixture);
      expect(narrative.chapters.length, `${fixture.id} recorded no chapters`).toBeGreaterThan(0);

      const known = new Set(fixture.files.map((f) => f.file));
      for (const chapter of narrative.chapters) {
        for (const section of diffSectionsOf(chapter)) {
          expect(known.has(section.file), `${fixture.id}: ${section.file} is not in the fixture`).toBe(true);
          const file = fixture.files.find((f) => f.file === section.file);
          expect(section.hunkIndex, `${fixture.id}: ${section.file} hunkIndex out of range`).toBeLessThan(
            file?.hunks.length ?? 0,
          );
          expect(section.endLine).toBeGreaterThanOrEqual(section.startLine);
        }
      }
    }
  });
});

describe('collapse gate', () => {
  it('safety: no collapsed chapter touches a ground-truth hotspot, across every recorded narrative', async () => {
    const collapsedCounts: Record<string, number> = {};

    for (const fixture of FIXTURES) {
      const narrative = await loadRecording(fixture);
      const repo = fakeRepoContext(REPO_CALLERS[fixture.id] ?? {});
      const risks = computeRisk(fixture.files, repo);
      const result = selectCollapsible(narrative.chapters, risks, repo);
      expect(result.available, `${fixture.id} should have a warm context`).toBe(true);
      if (!result.available) continue;
      collapsedCounts[fixture.id] = result.decisions.length;

      const hotspots = new Set(fixture.groundTruth.expectedHotspots ?? []);
      for (const decision of result.decisions) {
        const chapter = narrative.chapters[decision.chapterIndex];
        expect(chapter, `${fixture.id}: decision points at a missing chapter`).toBeTruthy();
        for (const section of diffSectionsOf(chapter!)) {
          expect(
            hotspots.has(section.file),
            `${fixture.id}: collapsed chapter ${decision.chapterIndex} hides hotspot ${section.file}`,
          ).toBe(false);
        }
      }
    }

    // A build where evidence never matches would satisfy every assertion above. These two fixtures are
    // the guard: `safe-rename` is the case where collapse is correct, and `large-refactor` is the case
    // the project exists for.
    expect(collapsedCounts['safe-rename'] ?? 0).toBeGreaterThan(0);
    expect(collapsedCounts['large-refactor'] ?? 0).toBeGreaterThan(0);
  });

  it('compression: collapsed chapters cover at least 40% of narrated diff lines in large-refactor', async () => {
    const fixture = FIXTURES.find((f) => f.id === 'large-refactor');
    expect(fixture, 'large-refactor must be registered in FIXTURES').toBeTruthy();
    const narrative = await loadRecording(fixture!);
    const repo = fakeRepoContext(REPO_CALLERS['large-refactor']!);
    const risks = computeRisk(fixture!.files, repo);
    const result = selectCollapsible(narrative.chapters, risks, repo);
    expect(result.available).toBe(true);
    if (!result.available) return;

    const collapsedChapters = result.decisions.map((d) => narrative.chapters[d.chapterIndex]!);
    const collapsedLines = narratedDiffLines(collapsedChapters);
    const totalLines = narratedDiffLines(narrative.chapters);
    expect(totalLines).toBeGreaterThan(0);

    const ratio = collapsedLines / totalLines;
    expect(ratio, `collapsed ${collapsedLines} of ${totalLines} narrated lines`).toBeGreaterThanOrEqual(0.4);
    // Upper bound too: a fixture that collapses almost everything tests nothing, and the three hotspot
    // chapters have to stay open for the safety test above to have anything to guard.
    expect(ratio).toBeLessThan(0.9);
    expect(result.dividerBefore).not.toBeNull();
  });

  it('collapses nothing anywhere once repo context is unavailable, on the same recordings', async () => {
    for (const fixture of FIXTURES) {
      const narrative = await loadRecording(fixture);
      const result = selectCollapsible(narrative.chapters, computeRisk(fixture.files), {
        available: false,
        reason: 'empty-tree',
      });
      expect(result).toEqual({ available: false, reason: 'empty-tree' });
    }
  });
});
