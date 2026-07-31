import type { DiffFile, PRMetadata } from '../github/types';

/**
 * A canned PR for evaluation. Captures everything generateNarrative needs as
 * input plus annotated ground truth so the judge can score the output.
 */
export type EvalFixture = {
  /** Stable identifier for the fixture (filename without extension). */
  id: string;
  /** Short human-readable description. */
  description: string;
  pr: PRMetadata;
  files: DiffFile[];
  fileTree?: string[];
  /**
   * Absolute path to a committed narrative recorded for this fixture, under `fixtures/recorded/`.
   *
   * Absolute rather than relative because the two consumers run from different working directories —
   * the test suite from wherever `bun test` was invoked, the harness from the repo root — and a
   * cwd-relative path resolves differently for each. Each fixture builds it from its own
   * `import.meta.url`, so there is exactly one resolution rule.
   */
  recordedNarrativePath?: string;
  groundTruth: GroundTruth;
};

export type GroundTruth = {
  /** Free-text description of what a careful reviewer should notice. */
  expectedConcerns: string[];
  /** Files where a careful reviewer should focus first. */
  expectedHotspots?: string[];
  /** Things genuinely missing from the PR (tests, validation, etc). */
  expectedMissing?: string[];
  /** Expected verdict polarity: changes that should NOT be 'safe'. */
  shouldNotBeSafe?: boolean;
};

/**
 * 4-axis quality rubric, derived from Tao 2022 / Dong 2021. Each axis is 1-5.
 *
 * - comprehensiveness: did the narrative cover the meaningful changes?
 * - rationality: did it explain WHY changes matter, not just WHAT they are?
 * - conciseness: was it tight, no padding, low ratio of prose to insight?
 * - expressiveness: clear, specific, well-anchored to file:line?
 */
export type RubricScores = {
  comprehensiveness: number;
  rationality: number;
  conciseness: number;
  expressiveness: number;
};

export type DefectDetectionResult = {
  /** Number of expectedConcerns the narrative surfaced (in concerns or callouts or whyMatters). */
  surfaced: number;
  /** Total expected. */
  expected: number;
  /** Per-concern detail. */
  detail: { expected: string; surfaced: boolean; evidence?: string }[];
};

/** Where one ground-truth hotspot file ended up in a narrative. */
export type HotspotPlacement = {
  file: string;
  /** Some chapter's diff sections reference this file. */
  covered: boolean;
  /** Covered AND the covering chapter is not collapsed. */
  expanded: boolean;
  /** 0-based index of the first chapter referencing it; null when uncovered. */
  chapterIndex: number | null;
};

export type HotspotPlacementResult = {
  /**
   * 'n/a' when the fixture declares no hotspots.
   *
   * Explicit rather than the sentinel `DefectDetectionResult` uses (`expected: 0`), which every
   * consumer has to re-derive independently — the console line and the aggregate each decode it on
   * their own today. One discriminant read the same way in both places is the point.
   */
  status: 'scored' | 'n/a';
  placements: HotspotPlacement[];
  /** Count of hotspots in expanded chapters, over the count declared. Both 0 when `n/a`. */
  expandedOf: { expanded: number; total: number };
};

export type EvalRun = {
  fixtureId: string;
  provider: string;
  /** Wall-clock ms to first usable partial parse (streaming only). */
  timeToFirstPartialMs?: number;
  /** Wall-clock total ms. */
  totalMs: number;
  /** Total prose word count across all chapter narrative sections + tldr + concerns + whyMatters. */
  proseWordCount: number;
  scores: RubricScores;
  scoreNotes: string;
  defectDetection: DefectDetectionResult;
  /** Did the ground-truth hotspots survive into chapters a reader actually sees? */
  hotspotPlacement: HotspotPlacementResult;
  /** True if the narrative had at least 1 concern. */
  hasConcerns: boolean;
  /** Risk-distribution sanity: did chapters get ordered by risk? */
  chaptersOrderedByRisk: boolean;
  /** Verdict the narrative produced. */
  verdict: 'safe' | 'caution' | 'risky';
  errors?: string[];
};

export type Baseline = {
  generatedAt: string;
  provider: string;
  judgeProvider: string;
  runs: EvalRun[];
  aggregate: {
    avgComprehensiveness: number;
    avgRationality: number;
    avgConciseness: number;
    avgExpressiveness: number;
    avgTimeToFirstPartialMs: number | null;
    avgTotalMs: number;
    avgProseWordCount: number;
    avgDefectRecall: number;
    /** Mean per-run fraction of hotspots that landed in an expanded chapter, over scored runs only. */
    avgHotspotPlacement: number;
  };
};
