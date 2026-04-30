import type { DiffHunk } from './types';

/**
 * Convert an absolute new-side line number to a 1-based diff position
 * within the hunk (as used by GitHub's review comment API).
 * Returns null if the line is not represented in the hunk.
 */
export function absoluteToPosition(hunk: DiffHunk, absoluteNewLine: number): number | null {
  for (let i = 0; i < hunk.lines.length; i++) {
    const line = hunk.lines[i]!;
    if (line.lineNumber.new === absoluteNewLine) {
      return i + 1;
    }
  }
  return null;
}

/**
 * Convert a 1-based diff position back to absolute line numbers
 * (old- and/or new-side). Returns null if the position is out of range.
 */
export function positionToAbsolute(hunk: DiffHunk, position: number): { old?: number; new?: number } | null {
  if (position < 1 || position > hunk.lines.length) {
    return null;
  }
  const line = hunk.lines[position - 1]!;
  const result: { old?: number; new?: number } = {};
  if (line.lineNumber.old !== undefined) result.old = line.lineNumber.old;
  if (line.lineNumber.new !== undefined) result.new = line.lineNumber.new;
  return result;
}
