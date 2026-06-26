import type { DiffLine } from '../state/types';

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
