import { readFile } from 'fs/promises';
import { describe, expect, it } from 'vitest';
import { FIXTURES } from '../eval/fixtures';
import { scoreHotspotPlacement } from '../eval/judge';
import { aggregate } from '../eval/run';
import type { EvalFixture, EvalRun, HotspotPlacementResult } from '../eval/types';
import type { CollapseResult } from '../narrative/collapse';
import { normalizeNarrative, type NarrativeChapter, type NarrativeResponse } from '../narrative/types';

/**
 * Read + parse + normalize, the same route the production cache path takes. A static JSON import would
 * typecheck but infer a wide structural literal whose `sections` is not `NarrativeSection[]`. Duplicated
 * from `collapse.test.ts` rather than exported from it, matching how the helpers there are kept private.
 */
async function loadRecording(fixture: EvalFixture): Promise<NarrativeResponse> {
  const path = fixture.recordedNarrativePath;
  if (!path) throw new Error(`fixture ${fixture.id} has no recordedNarrativePath`);
  return normalizeNarrative(JSON.parse(await readFile(path, 'utf-8')));
}

/** Also the cheap cross-phase guard: a fixture Phase 2 forgot to register fails here by name. */
function fixtureFor(id: string): EvalFixture {
  const fixture = FIXTURES.find((f) => f.id === id);
  expect(fixture, `${id} must be registered in FIXTURES`).toBeTruthy();
  return fixture!;
}

/** A warm context where nothing collapsed — the state the eval harness itself always scores against. */
const NOTHING_COLLAPSED: CollapseResult = { available: true, decisions: [], dividerBefore: null };

/**
 * A warm context that collapses exactly the named chapters. `evidence` is filled in only to satisfy the
 * union; `scoreHotspotPlacement` reads `chapterIndex` and nothing else off a decision.
 */
function collapsing(...chapterIndices: number[]): CollapseResult {
  return {
    available: true,
    decisions: chapterIndices.map((chapterIndex) => ({
      chapterIndex,
      reason: `chapter ${chapterIndex} collapsed by the test`,
      evidence: { kind: 'test-only', files: [] },
    })),
    dividerBefore: chapterIndices.length > 0 ? Math.min(...chapterIndices) : null,
  };
}

/** The same narrative with every diff section pointing at `file` dropped. */
function withoutFile(narrative: NarrativeResponse, file: string): NarrativeResponse {
  return {
    ...narrative,
    chapters: narrative.chapters.map((chapter) => ({
      ...chapter,
      sections: chapter.sections.filter((s) => s.type !== 'diff' || s.file !== file),
    })),
  };
}

/** A chapter over the given files, one diff section each. */
function chapterOf(files: string[]): NarrativeChapter {
  return {
    title: 'chapter',
    summary: '',
    whyMatters: '',
    risk: 'low',
    sections: files.map((file, hunkIndex) => ({ type: 'diff', file, startLine: 1, endLine: 10, hunkIndex })),
  };
}

function narrativeOf(chapters: NarrativeChapter[]): NarrativeResponse {
  return { title: '', tldr: '', verdict: 'caution', readingPlan: [], concerns: [], chapters };
}

/** A fixture that keeps its recording and files but declares exactly these hotspots. */
function withHotspots(fixture: EvalFixture, expectedHotspots: string[] | undefined): EvalFixture {
  const groundTruth = { ...fixture.groundTruth, expectedHotspots };
  if (expectedHotspots === undefined) delete groundTruth.expectedHotspots;
  return { ...fixture, groundTruth };
}

function scoredPlacement(expanded: number, total: number): HotspotPlacementResult {
  const placements = Array.from({ length: total }, (_, i) => ({
    file: `src/hotspot-${i}.ts`,
    covered: true,
    expanded: i < expanded,
    chapterIndex: i,
  }));
  return { status: 'scored', placements, expandedOf: { expanded, total } };
}

const UNSCORED_PLACEMENT: HotspotPlacementResult = {
  status: 'n/a',
  placements: [],
  expandedOf: { expanded: 0, total: 0 },
};

function runWith(hotspotPlacement: HotspotPlacementResult, fixtureId = 'synthetic'): EvalRun {
  return {
    fixtureId,
    provider: 'test',
    totalMs: 1000,
    proseWordCount: 100,
    scores: { comprehensiveness: 4, rationality: 4, conciseness: 4, expressiveness: 4 },
    scoreNotes: '',
    defectDetection: { surfaced: 1, expected: 1, detail: [] },
    hotspotPlacement,
    hasConcerns: true,
    chaptersOrderedByRisk: true,
    verdict: 'caution',
  };
}

describe('scoreHotspotPlacement', () => {
  it('reports n/a for a fixture whose expectedHotspots is empty', async () => {
    const fixture = fixtureFor('safe-rename');
    expect(fixture.groundTruth.expectedHotspots, 'safe-rename is the empty-hotspots case').toEqual([]);
    const result = scoreHotspotPlacement(await loadRecording(fixture), fixture, NOTHING_COLLAPSED);
    expect(result.status).toBe('n/a');
    expect(result.placements).toEqual([]);
    expect(result.expandedOf).toEqual({ expanded: 0, total: 0 });
  });

  it('reports n/a for a fixture that declares no expectedHotspots at all', async () => {
    // The field is optional, so absent and empty are different inputs and both have to land on n/a.
    const fixture = withHotspots(fixtureFor('auth-token-validation'), undefined);
    expect(fixture.groundTruth.expectedHotspots).toBeUndefined();
    const result = scoreHotspotPlacement(await loadRecording(fixture), fixture, NOTHING_COLLAPSED);
    expect(result.status).toBe('n/a');
    expect(result.placements).toEqual([]);
  });

  it('marks a hotspot covered and expanded when nothing collapsed', async () => {
    const fixture = fixtureFor('auth-token-validation');
    const result = scoreHotspotPlacement(await loadRecording(fixture), fixture, NOTHING_COLLAPSED);
    expect(result.status).toBe('scored');
    expect(result.placements).toEqual([
      { file: 'src/auth/token-validator.ts', covered: true, expanded: true, chapterIndex: 0 },
    ]);
    expect(result.expandedOf).toEqual({ expanded: 1, total: 1 });
  });

  it('marks a hotspot covered but not expanded when its chapter is collapsed', async () => {
    // The failure the whole feature exists to prevent: the narrative found the file and then hid it.
    const fixture = fixtureFor('auth-token-validation');
    const result = scoreHotspotPlacement(await loadRecording(fixture), fixture, collapsing(0));
    expect(result.status).toBe('scored');
    expect(result.placements[0]).toEqual({
      file: 'src/auth/token-validator.ts',
      covered: true,
      expanded: false,
      chapterIndex: 0,
    });
    expect(result.expandedOf).toEqual({ expanded: 0, total: 1 });
  });

  it('marks a hotspot uncovered with a null chapterIndex when no diff section references it', async () => {
    const fixture = fixtureFor('auth-token-validation');
    const hotspot = 'src/auth/token-validator.ts';
    const stripped = withoutFile(await loadRecording(fixture), hotspot);
    // Prose naming the file is not coverage: a reader can only read the change from a diff section.
    stripped.chapters[0]!.sections.push({ type: 'narrative', content: `we changed ${hotspot} a lot` });

    const result = scoreHotspotPlacement(stripped, fixture, NOTHING_COLLAPSED);
    expect(result.status).toBe('scored');
    expect(result.placements[0]).toEqual({ file: hotspot, covered: false, expanded: false, chapterIndex: null });
    expect(result.expandedOf).toEqual({ expanded: 0, total: 1 });
  });

  it('reads an unavailable collapse result as nothing collapsed rather than everything hidden', async () => {
    // `selectCollapsible` short-circuits on the unavailable arm before weighing evidence, so no chapter
    // is hidden and a covered hotspot is an expanded one.
    const fixture = fixtureFor('auth-token-validation');
    const result = scoreHotspotPlacement(await loadRecording(fixture), fixture, {
      available: false,
      reason: 'fetch-failed',
    });
    expect(result.expandedOf).toEqual({ expanded: 1, total: 1 });
    expect(result.placements[0]?.expanded).toBe(true);
  });

  it('counts every declared hotspot separately across a multi-hotspot fixture', async () => {
    const fixture = fixtureFor('large-refactor');
    const narrative = await loadRecording(fixture);
    expect(fixture.groundTruth.expectedHotspots?.length, 'large-refactor declares three hotspots').toBe(3);

    const open = scoreHotspotPlacement(narrative, fixture, NOTHING_COLLAPSED);
    expect(open.expandedOf).toEqual({ expanded: 3, total: 3 });
    expect(open.placements.map((p) => p.chapterIndex)).toEqual([0, 1, 2]);

    // Collapse the chapter holding the second hotspot and only that hotspot's verdict changes.
    const partly = scoreHotspotPlacement(narrative, fixture, collapsing(1));
    expect(partly.expandedOf).toEqual({ expanded: 2, total: 3 });
    expect(partly.placements.map((p) => p.expanded)).toEqual([true, false, true]);
    expect(partly.placements.every((p) => p.covered)).toBe(true);
  });

  it('matches paths that differ only by an a/ or b/ prefix', () => {
    // No committed fixture exercises this — every recording and every expectedHotspots entry is already
    // a bare path — so the disagreement the codebase keeps hitting has to be constructed here.
    const fixture = withHotspots(fixtureFor('auth-token-validation'), ['a/src/auth/token-validator.ts']);
    const narrative = narrativeOf([chapterOf(['b/src/auth/token-validator.ts'])]);
    const result = scoreHotspotPlacement(narrative, fixture, NOTHING_COLLAPSED);
    expect(result.placements[0]?.covered).toBe(true);
    expect(result.placements[0]?.chapterIndex).toBe(0);
  });

  it('reports the first chapter referencing the hotspot when several do', () => {
    const fixture = withHotspots(fixtureFor('auth-token-validation'), ['src/shared/money.ts']);
    const narrative = narrativeOf([
      chapterOf(['src/api/orders.ts']),
      chapterOf(['src/shared/money.ts']),
      chapterOf(['src/shared/money.ts']),
    ]);
    const result = scoreHotspotPlacement(narrative, fixture, NOTHING_COLLAPSED);
    expect(result.placements[0]?.chapterIndex).toBe(1);
    // Collapsing the later duplicate does not hide it, because chapter 1 still shows it.
    expect(scoreHotspotPlacement(narrative, fixture, collapsing(2)).placements[0]?.expanded).toBe(true);
    expect(scoreHotspotPlacement(narrative, fixture, collapsing(1)).placements[0]?.expanded).toBe(false);
  });
});

describe('aggregate', () => {
  it('skips n/a runs rather than averaging them in as zero', () => {
    const result = aggregate([
      runWith(scoredPlacement(1, 1), 'all-expanded'),
      runWith(scoredPlacement(1, 3), 'one-of-three'),
      runWith(UNSCORED_PLACEMENT, 'no-hotspots'),
    ]);
    // Macro over the two scored runs: (1 + 1/3) / 2.
    expect(result.avgHotspotPlacement).toBe(0.67);
    // Averaging the n/a run in as zero would give 0.44; pooling the counts would give 0.5.
    expect(result.avgHotspotPlacement).not.toBe(0.44);
    expect(result.avgHotspotPlacement).not.toBe(0.5);
  });

  it('reports zero when no run was scored, matching how defect recall degrades', () => {
    const result = aggregate([runWith(UNSCORED_PLACEMENT), runWith(UNSCORED_PLACEMENT)]);
    expect(result.avgHotspotPlacement).toBe(0);
  });

  it('includes the field in the empty-run-set aggregate', () => {
    expect(aggregate([]).avgHotspotPlacement).toBe(0);
  });
});
