import { hashHunkLines } from '../github/diff-parser';
import type { DiffFile, DiffHunk } from '../github/types';
import type { HunkAnchor, NarrativeResponse } from './types';

function normalizePath(p: string): string {
  return p
    .trim()
    .replace(/^[ab]\//, '')
    .replace(/^\/+/, '');
}

function hunkHash(hunk: DiffHunk): string {
  return hunk.contentHash ?? hashHunkLines(hunk.lines);
}

/**
 * Build the deterministic anchor for one hunk. `contentHash` re-uses the parse-time hash when present
 * so the anchor and the wire hunk always agree; it falls back to hashing the lines for DiffFiles built
 * without it (tests, older callers). Throws only on a genuinely absent hunk — callers pass a validated
 * index.
 */
export function computeHunkAnchor(file: DiffFile, hunkIndex: number): HunkAnchor {
  const hunk = file.hunks[hunkIndex];
  if (!hunk) throw new Error(`computeHunkAnchor: no hunk at index ${hunkIndex} in ${file.file}`);
  return {
    file: file.file,
    newStart: hunk.newStart,
    newLines: hunk.newCount,
    contentHash: hunkHash(hunk),
  };
}

/**
 * Re-resolve a stale anchor against a (possibly reshaped) diff. Fallback ladder, scoped to the named
 * file:
 *   1. exact    — same contentHash at the same new-side start (unchanged hunk, unchanged position)
 *   2. moved    — same contentHash anywhere in that file's hunks (hunk survived, index shifted)
 *   3. range    — overlapping new-side line range in that file (hunk edited, roughly same location)
 *   4. null     — nothing plausible; the caller drops the reference
 */
export function resolveAnchor(files: DiffFile[], anchor: HunkAnchor): { file: string; hunkIndex: number } | null {
  const norm = normalizePath(anchor.file);
  const named = files.find((f) => normalizePath(f.file) === norm);
  if (!named) return null;

  let idx = named.hunks.findIndex((h) => hunkHash(h) === anchor.contentHash && h.newStart === anchor.newStart);
  if (idx !== -1) return { file: named.file, hunkIndex: idx };

  idx = named.hunks.findIndex((h) => hunkHash(h) === anchor.contentHash);
  if (idx !== -1) return { file: named.file, hunkIndex: idx };

  const aStart = anchor.newStart;
  const aEnd = anchor.newStart + Math.max(anchor.newLines - 1, 0);
  idx = named.hunks.findIndex((h) => {
    const hEnd = h.newStart + Math.max(h.newCount - 1, 0);
    return h.newStart <= aEnd && aStart <= hEnd;
  });
  if (idx !== -1) return { file: named.file, hunkIndex: idx };

  return null;
}

/**
 * Stamp a fresh anchor onto every diff section that resolves to a real hunk. Runs after repair, so
 * every surviving diff section already points at a valid `{ file, hunkIndex }`; sections whose file or
 * index is (unexpectedly) unresolvable are left untouched rather than crashing. Prose sections pass
 * through unchanged.
 */
export function enrichNarrativeAnchors(narrative: NarrativeResponse, files: DiffFile[]): NarrativeResponse {
  const fileMap = new Map<string, DiffFile>();
  for (const f of files) fileMap.set(normalizePath(f.file), f);

  const chapters = narrative.chapters.map((ch) => ({
    ...ch,
    sections: ch.sections.map((s) => {
      if (s.type !== 'diff') return s;
      const file = fileMap.get(normalizePath(s.file));
      if (!file || s.hunkIndex < 0 || s.hunkIndex >= file.hunks.length) return s;
      return { ...s, anchor: computeHunkAnchor(file, s.hunkIndex) };
    }),
  }));

  return { ...narrative, chapters };
}
