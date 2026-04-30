import { describe, expect, it } from "vitest";
import {
  absoluteToPosition,
  positionToAbsolute,
} from "../github/line-mapper";
import type { DiffHunk } from "../github/types";

const hunk: DiffHunk = {
  header: "@@ -10,6 +10,8 @@",
  oldStart: 10,
  oldCount: 6,
  newStart: 10,
  newCount: 8,
  lines: [
    { type: "context", content: "a", lineNumber: { old: 10, new: 10 } },
    { type: "context", content: "b", lineNumber: { old: 11, new: 11 } },
    { type: "add", content: "c", lineNumber: { new: 12 } },
    { type: "add", content: "d", lineNumber: { new: 13 } },
    { type: "context", content: "e", lineNumber: { old: 12, new: 14 } },
    { type: "context", content: "f", lineNumber: { old: 13, new: 15 } },
  ],
};

describe("line-mapper", () => {
  it("converts absolute new-side line to diff position", () => {
    expect(absoluteToPosition(hunk, 12)).toBe(3);
    expect(absoluteToPosition(hunk, 10)).toBe(1);
  });

  it("returns null for lines not in the hunk", () => {
    expect(absoluteToPosition(hunk, 99)).toBeNull();
  });

  it("converts diff position back to absolute line", () => {
    expect(positionToAbsolute(hunk, 3)).toEqual({ new: 12 });
    expect(positionToAbsolute(hunk, 1)).toEqual({ old: 10, new: 10 });
  });
});
