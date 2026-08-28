import type { DiffFile, DiffLine, HunkAnchor } from '../state/types';
import { normalizePath } from './paths';

/**
 * Anchors line-scoped annotations (resolve items, callouts) to the diff row they
 * belong to, so they can render INLINE between code lines — the same place GitHub
 * puts an inline comment — rather than after the whole hunk block.
 *
 * Matches on the NEW-side line number only: concerns and callouts reference code
 * as it exists after the change, and a removed line carries no new number, so a
 * match always lands on a context or added row.
 *
 * Returns:
 *  - byLine:   lineIndex -> indices into `items` anchored there, in items order
 *  - trailing: indices into `items` that matched no line (no/!match line number);
 *              the caller renders these after the hunk so none are silently dropped.
 */
export function anchorByNewLine(
  lines: DiffLine[],
  items: ReadonlyArray<{ line?: number | null }>,
): { byLine: Map<number, number[]>; trailing: number[] } {
  const byLine = new Map<number, number[]>();
  const trailing: number[] = [];

  items.forEach((item, itemIdx) => {
    if (item.line == null) {
      trailing.push(itemIdx);
      return;
    }
    const lineIdx = lines.findIndex((l) => l.lineNumber.new === item.line);
    if (lineIdx === -1) {
      trailing.push(itemIdx);
      return;
    }
    const bucket = byLine.get(lineIdx);
    if (bucket) bucket.push(itemIdx);
    else byLine.set(lineIdx, [itemIdx]);
  });

  return { byLine, trailing };
}

/**
 * Wire-side mirror of the server's `resolveAnchor`. Re-resolves a diff section's content anchor when
 * its `hunkIndex` no longer lands on the right hunk (diff re-fetch, truncation, off-by-one). The
 * browser never hashes: it compares the `contentHash` the server stamped onto each wire hunk. Ladder,
 * scoped to the named file:
 *   1. exact  — same contentHash at the same new-side start
 *   2. moved  — same contentHash anywhere in that file
 *   3. range  — overlapping new-side line range in that file
 *   4. null   — nothing plausible
 */
export function resolveAnchor(files: DiffFile[], anchor: HunkAnchor): { file: DiffFile; hunkIndex: number } | null {
  const norm = normalizePath(anchor.file);
  const named = files.find((f) => normalizePath(f.file) === norm);
  if (!named) return null;

  let idx = named.hunks.findIndex((h) => h.contentHash === anchor.contentHash && h.newStart === anchor.newStart);
  if (idx !== -1) return { file: named, hunkIndex: idx };

  idx = named.hunks.findIndex((h) => h.contentHash != null && h.contentHash === anchor.contentHash);
  if (idx !== -1) return { file: named, hunkIndex: idx };

  const aStart = anchor.newStart;
  const aEnd = anchor.newStart + Math.max(anchor.newLines - 1, 0);
  idx = named.hunks.findIndex((h) => {
    const hEnd = h.newStart + Math.max(h.newCount - 1, 0);
    return h.newStart <= aEnd && aStart <= hEnd;
  });
  if (idx !== -1) return { file: named, hunkIndex: idx };

  return null;
}
