import type { Chapter, Concern, DiffFile, NarrativeResponse } from '../state/types';
import { normalizePath } from './paths';

/** Rail flag level. Reuses TriageSeverity's vocabulary plus an unflagged state. */
export type BeatRisk = 'risk' | 'warn' | 'info' | 'none';
export type ResolveSeverity = 'risk' | 'warn' | 'info';

/** One open question the reviewer must resolve, folded out of a narrative concern. */
export type ResolveItem = {
  id: string;
  beatId: string;
  /** Originating 0-based chapter index — required by the /api/ai `ask` action. -1 for orphans. */
  chapterIndex: number;
  question: string;
  file?: string;
  line?: number;
  severity: ResolveSeverity;
  status: 'open' | 'resolved';
};

export type BeatSection = { kind: 'prose'; text: string } | { kind: 'diff'; file: string; hunkIndex: number };

export type Beat = {
  id: string;
  chapterIndex: number;
  title: string;
  whyMatters?: string;
  risk: BeatRisk;
  sections: BeatSection[];
  resolve: ResolveItem[];
  status: 'unread' | 'understood';
};

export type WalkthroughModel = { beats: Beat[]; toResolve: number };

/** Synthetic beat that collects concerns matching no chapter, so they're never invisible. */
export const ORPHAN_BEAT_ID = 'other';

const RANK: Record<BeatRisk, number> = { none: 0, info: 1, warn: 2, risk: 3 };

/** A chapter's own risk contribution to its beat flag — low contributes nothing ("quiet"). */
function chapterContribution(risk: Chapter['risk']): BeatRisk {
  return risk === 'high' ? 'risk' : risk === 'medium' ? 'warn' : 'none';
}

/** A concern's severity, synthesized from its owning chapter's risk (concerns carry none). */
function concernSeverity(risk: Chapter['risk']): ResolveSeverity {
  return risk === 'high' ? 'risk' : risk === 'medium' ? 'warn' : 'info';
}

function higher(a: BeatRisk, b: BeatRisk): BeatRisk {
  return RANK[a] >= RANK[b] ? a : b;
}

/** Mirror of Chapter.tsx's findHunk null-drop: does this file+hunkIndex still resolve? */
function hunkResolves(files: DiffFile[], file: string, hunkIndex: number): boolean {
  const norm = normalizePath(file);
  const match = files.find((f) => normalizePath(f.file) === norm);
  return !!match && hunkIndex >= 0 && hunkIndex < match.hunks.length;
}

/** Shared factory so owned and orphaned concerns produce identically-shaped resolve items. */
function makeResolveItem(
  concern: Concern,
  beatId: string,
  chapterIndex: number,
  severity: ResolveSeverity,
  i: number,
): ResolveItem {
  return {
    id: `${beatId}::r${i}`,
    beatId,
    chapterIndex,
    question: concern.question,
    file: concern.file,
    line: concern.line,
    severity,
    status: 'open',
  };
}

/**
 * Build the trailing "Other" beat from concerns whose file matched no chapter, so they are
 * never invisible (mirrors OrphanedInlineComments in StoryView). Returns null when there are none.
 * Orphans default to 'info': there's no owning chapter risk to synthesize from, and an unplaced
 * concern is treated as low-confidence noise rather than amplified (keeps the rail quiet).
 */
function buildOtherBeat(orphans: { concern: Concern; i: number }[]): Beat | null {
  if (orphans.length === 0) return null;
  return {
    id: ORPHAN_BEAT_ID,
    chapterIndex: -1,
    title: 'Other',
    risk: 'info',
    sections: [],
    resolve: orphans.map(({ concern, i }) => makeResolveItem(concern, ORPHAN_BEAT_ID, -1, 'info', i)),
    status: 'unread',
  };
}

/**
 * Pure seam: turn a narrative + diff into the beats the rail and reading surface render.
 * No React, no fetch. The single place the three risk vocabularies are reconciled.
 * Tolerant of mid-stream inputs (absent arrays) — must never throw and crash the tree.
 */
export function buildWalkthrough(narrative: NarrativeResponse, files: DiffFile[]): WalkthroughModel {
  const chapters = narrative.chapters ?? [];
  const concerns = narrative.concerns ?? [];

  // Per-chapter set of normalized files referenced by diff sections — routes concerns to beats.
  const chapterFiles = chapters.map((ch) => {
    const set = new Set<string>();
    for (const s of ch.sections ?? []) {
      if (s.type === 'diff') set.add(normalizePath(s.file));
    }
    return set;
  });

  const beats: Beat[] = chapters.map((ch, index) => {
    const sections: BeatSection[] = [];
    for (const s of ch.sections ?? []) {
      if (s.type === 'narrative') sections.push({ kind: 'prose', text: s.content });
      else if (hunkResolves(files, s.file, s.hunkIndex)) {
        sections.push({ kind: 'diff', file: s.file, hunkIndex: s.hunkIndex });
      }
    }
    return {
      id: `ch-${index}`,
      chapterIndex: index,
      title: ch.title,
      whyMatters: ch.whyMatters,
      risk: chapterContribution(ch.risk),
      sections,
      resolve: [],
      status: 'unread',
    };
  });

  // Fold each concern into its owning beat (first chapter referencing the concern's file);
  // concerns matching no chapter are collected as orphans.
  const orphans: { concern: Concern; i: number }[] = [];
  concerns.forEach((concern, i) => {
    const owner = chapterFiles.findIndex((set) => set.has(normalizePath(concern.file)));
    const beat = owner >= 0 ? beats[owner] : undefined;
    const chapter = owner >= 0 ? chapters[owner] : undefined;
    if (!beat || !chapter) {
      orphans.push({ concern, i });
      return;
    }
    const severity = concernSeverity(chapter.risk);
    beat.resolve.push(makeResolveItem(concern, beat.id, owner, severity, i));
    beat.risk = higher(beat.risk, severity);
  });

  const other = buildOtherBeat(orphans);
  if (other) beats.push(other);

  const toResolve = beats.reduce((n, b) => n + b.resolve.filter((r) => r.status === 'open').length, 0);
  return { beats, toResolve };
}
