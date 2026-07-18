import type { Chapter, Concern, DiffFile, NarrativeResponse } from '../state/types';
import { hashKey } from './hash';
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

/**
 * Content-addressed identity for a finding: hash of file + normalized question stem.
 * Deliberately excludes the anchor line (lines shift on every rebase) and the concern's
 * array position (regeneration reorders), so a resolved finding stays resolved when the
 * planner re-raises the same question about the same file in a fresh narrative.
 */
export function findingKey(file: string | undefined, question: string): string {
  const stem = (question ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12)
    .join(' ');
  return hashKey(`${normalizePath(file ?? '')}|${stem}`);
}

/** Open resolve items = walkthrough items minus the ones the reviewer marked resolved.
 * The single count every progress surface (rail, submit bars, overview) derives from. */
export function countOpenResolve(walkthrough: WalkthroughModel | null, resolved: Record<string, boolean>): number {
  if (!walkthrough) return 0;
  let n = 0;
  for (const beat of walkthrough.beats) {
    for (const item of beat.resolve) if (!resolved[item.id]) n++;
  }
  return n;
}

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

/**
 * Shared factory so owned and orphaned concerns produce identically-shaped resolve items.
 * Ids are content-addressed (see {@link findingKey}) so resolved-state survives regeneration;
 * `seen` disambiguates the pathological duplicate (same file, same question twice in one
 * narrative) with a positional suffix so React keys stay unique.
 */
function makeResolveItem(
  concern: Concern,
  beatId: string,
  chapterIndex: number,
  severity: ResolveSeverity,
  seen: Map<string, number>,
): ResolveItem {
  const base = findingKey(concern.file, concern.question);
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  return {
    id: n === 1 ? base : `${base}~${n}`,
    beatId,
    chapterIndex,
    question: concern.question,
    // GitHub's comment APIs require repository-relative paths, but the planner may emit tolerated
    // git-style prefixes (`a/src/foo.ts`). Normalize once here so every consumer — display,
    // chapter anchoring, and the comment composer that posts to GitHub — sees the canonical path.
    file: concern.file ? normalizePath(concern.file) : undefined,
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
function buildOtherBeat(orphans: Concern[], seen: Map<string, number>): Beat | null {
  if (orphans.length === 0) return null;
  return {
    id: ORPHAN_BEAT_ID,
    chapterIndex: -1,
    title: 'Other',
    risk: 'info',
    sections: [],
    resolve: orphans.map((concern) => makeResolveItem(concern, ORPHAN_BEAT_ID, -1, 'info', seen)),
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
  const orphans: Concern[] = [];
  const seenFindingKeys = new Map<string, number>();
  concerns.forEach((concern) => {
    const owner = chapterFiles.findIndex((set) => set.has(normalizePath(concern.file)));
    const beat = owner >= 0 ? beats[owner] : undefined;
    const chapter = owner >= 0 ? chapters[owner] : undefined;
    if (!beat || !chapter) {
      orphans.push(concern);
      return;
    }
    const severity = concernSeverity(chapter.risk);
    beat.resolve.push(makeResolveItem(concern, beat.id, owner, severity, seenFindingKeys));
    beat.risk = higher(beat.risk, severity);
  });

  const other = buildOtherBeat(orphans, seenFindingKeys);
  if (other) beats.push(other);

  const toResolve = beats.reduce((n, b) => n + b.resolve.filter((r) => r.status === 'open').length, 0);
  return { beats, toResolve };
}
