import { describe, expect, it } from 'vitest';
import { anchorByNewLine } from '../anchor';
import type { DiffLine } from '../../state/types';

// A small hunk spanning new-side lines 10..13, with one removed line (no new number).
//   idx 0  context  new 10
//   idx 1  remove   old 11   (no new)
//   idx 2  add      new 11
//   idx 3  add      new 12
//   idx 4  context  new 13
function mkLines(): DiffLine[] {
  return [
    { type: 'context', content: 'a', lineNumber: { old: 10, new: 10 } },
    { type: 'remove', content: 'b', lineNumber: { old: 11 } },
    { type: 'add', content: 'c', lineNumber: { new: 11 } },
    { type: 'add', content: 'd', lineNumber: { new: 12 } },
    { type: 'context', content: 'e', lineNumber: { old: 12, new: 13 } },
  ];
}

describe('anchorByNewLine', () => {
  it('anchors an item to the line index whose NEW-side number equals item.line', () => {
    const { byLine, trailing } = anchorByNewLine(mkLines(), [{ line: 12 }]);
    expect(byLine.get(3)).toEqual([0]); // new 12 lives at index 3
    expect(trailing).toEqual([]);
  });

  it('groups multiple items on one line in items order', () => {
    const { byLine } = anchorByNewLine(mkLines(), [{ line: 11 }, { line: 13 }, { line: 11 }]);
    expect(byLine.get(2)).toEqual([0, 2]); // both line-11 items at index 2
    expect(byLine.get(4)).toEqual([1]); // line-13 item at index 4
  });

  it('sends items with no matching new-side line to trailing', () => {
    const { byLine, trailing } = anchorByNewLine(mkLines(), [{ line: 99 }]);
    expect(byLine.size).toBe(0);
    expect(trailing).toEqual([0]);
  });

  it('never anchors to a removed line (line 11 is an add, not the removed old-11)', () => {
    const { byLine } = anchorByNewLine(mkLines(), [{ line: 11 }]);
    expect(byLine.get(2)).toEqual([0]); // the add at index 2, not the remove at index 1
    expect(byLine.has(1)).toBe(false);
  });

  it('treats null/undefined line as trailing', () => {
    const { trailing } = anchorByNewLine(mkLines(), [{ line: null }, { line: undefined }, {}]);
    expect(trailing).toEqual([0, 1, 2]);
  });
});
