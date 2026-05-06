import type { DiffFile } from '../github/types';
import type { NarrativeResponse } from './types';

export type NarrativeMetrics = {
  /** Number of chapters in the narrative. */
  chapters: number;
  /** Hunks shown as a primary diff section in some chapter. */
  hunksPrimary: number;
  /** Hunks present in the diff but never referenced (primary or reshow). */
  hunksOrphaned: number;
  /** Reshow entries across all chapters. */
  reshowCount: number;
  /** Fraction of chapters whose primary diff sections span ≥2 distinct files. */
  crossFileChapterRatio: number;
  /** Median primary-hunk count per chapter. */
  hunksPerChapterP50: number;
  /** 90th-percentile primary-hunk count per chapter. */
  hunksPerChapterP90: number;
  /** Optional: tokens billed by the model for this narrative. */
  promptInputTokens?: number;
  outputTokens?: number;
  /** Optional: time from generation start to first chapter visible. */
  wallMsToFirstChapter?: number;
  /** Optional: total wall-clock time end to end. */
  wallMsTotal?: number;
};

function normalizePath(p: string): string {
  return p
    .trim()
    .replace(/^[ab]\//, '')
    .replace(/^\/+/, '');
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

/**
 * Compute structural metrics over an assembled narrative + the diff it was
 * generated from. Pure: deterministic for a given (narrative, files) pair.
 *
 * Used both by the bench script (Phase 2) and by per-PR observability (later).
 */
export function computeMetrics(narrative: NarrativeResponse, files: DiffFile[]): NarrativeMetrics {
  const referenced = new Set<string>();
  const primaryHunkKeys = new Set<string>();
  let reshowCount = 0;
  let crossFileChapters = 0;
  const hunksPerChapter: number[] = [];

  for (const ch of narrative.chapters) {
    const filesInChapter = new Set<string>();
    let chapterPrimary = 0;
    for (const s of ch.sections) {
      if (s.type !== 'diff') continue;
      const key = `${normalizePath(s.file)}:${s.hunkIndex}`;
      filesInChapter.add(normalizePath(s.file));
      if (!primaryHunkKeys.has(key)) {
        primaryHunkKeys.add(key);
        chapterPrimary++;
      }
      referenced.add(key);
    }
    for (const r of ch.reshow ?? []) {
      reshowCount++;
      if (r.file) referenced.add(`${normalizePath(r.file)}:${r.ref}`);
    }
    hunksPerChapter.push(chapterPrimary);
    if (filesInChapter.size >= 2) crossFileChapters++;
  }

  let orphaned = 0;
  for (const f of files) {
    const norm = normalizePath(f.file);
    f.hunks.forEach((_, idx) => {
      if (!referenced.has(`${norm}:${idx}`)) orphaned++;
    });
  }

  const sorted = [...hunksPerChapter].sort((a, b) => a - b);

  return {
    chapters: narrative.chapters.length,
    hunksPrimary: primaryHunkKeys.size,
    hunksOrphaned: orphaned,
    reshowCount,
    crossFileChapterRatio: narrative.chapters.length === 0 ? 0 : crossFileChapters / narrative.chapters.length,
    hunksPerChapterP50: percentile(sorted, 50),
    hunksPerChapterP90: percentile(sorted, 90),
  };
}

/**
 * Render a metrics row for a fixture as a single-line CSV-ish string. Used by
 * the bench runner to print a quick comparison table.
 */
export function formatMetricsRow(label: string, m: NarrativeMetrics): string {
  return [
    label.padEnd(40),
    `chapters=${m.chapters}`,
    `primary=${m.hunksPrimary}`,
    `orphan=${m.hunksOrphaned}`,
    `reshow=${m.reshowCount}`,
    `xfile=${m.crossFileChapterRatio.toFixed(2)}`,
    `p50=${m.hunksPerChapterP50}`,
    `p90=${m.hunksPerChapterP90}`,
  ].join('  ');
}
