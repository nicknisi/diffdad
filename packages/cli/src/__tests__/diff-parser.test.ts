import { describe, expect, it } from "vitest";
import { parseDiff } from "../github/diff-parser";

describe("parseDiff", () => {
  it("parses a unified diff into structured hunks", () => {
    const raw = [
      "diff --git a/src/math.ts b/src/math.ts",
      "index abc1234..def5678 100644",
      "--- a/src/math.ts",
      "+++ b/src/math.ts",
      "@@ -1,4 +1,5 @@",
      " export function add(a: number, b: number) {",
      "-  return a + b;",
      "+  const result = a + b;",
      "+  return result;",
      " }",
      "",
    ].join("\n");

    const files = parseDiff(raw);

    expect(files).toHaveLength(1);
    const file = files[0]!;
    expect(file.file).toBe("src/math.ts");
    expect(file.isNewFile).toBe(false);
    expect(file.isDeleted).toBe(false);
    expect(file.hunks).toHaveLength(1);

    const hunk = file.hunks[0]!;
    expect(hunk.oldStart).toBe(1);
    expect(hunk.oldCount).toBe(4);
    expect(hunk.newStart).toBe(1);
    expect(hunk.newCount).toBe(5);
    expect(hunk.header).toBe("@@ -1,4 +1,5 @@");

    expect(hunk.lines).toHaveLength(5);
    expect(hunk.lines[0]).toEqual({
      type: "context",
      content: "export function add(a: number, b: number) {",
      lineNumber: { old: 1, new: 1 },
    });
    expect(hunk.lines[1]).toEqual({
      type: "remove",
      content: "  return a + b;",
      lineNumber: { old: 2 },
    });
    expect(hunk.lines[2]).toEqual({
      type: "add",
      content: "  const result = a + b;",
      lineNumber: { new: 2 },
    });
    expect(hunk.lines[3]).toEqual({
      type: "add",
      content: "  return result;",
      lineNumber: { new: 3 },
    });
    expect(hunk.lines[4]).toEqual({
      type: "context",
      content: "}",
      lineNumber: { old: 3, new: 4 },
    });
  });

  it("handles new files", () => {
    const raw = [
      "diff --git a/src/new.ts b/src/new.ts",
      "new file mode 100644",
      "index 0000000..abcdef0",
      "--- /dev/null",
      "+++ b/src/new.ts",
      "@@ -0,0 +1,3 @@",
      "+export const a = 1;",
      "+export const b = 2;",
      "+export const c = 3;",
      "",
    ].join("\n");

    const files = parseDiff(raw);

    expect(files).toHaveLength(1);
    const file = files[0]!;
    expect(file.file).toBe("src/new.ts");
    expect(file.isNewFile).toBe(true);
    expect(file.isDeleted).toBe(false);
    expect(file.hunks).toHaveLength(1);

    const hunk = file.hunks[0]!;
    expect(hunk.lines).toHaveLength(3);
    expect(hunk.lines.every((l) => l.type === "add")).toBe(true);
    expect(hunk.lines[0]!.lineNumber).toEqual({ new: 1 });
    expect(hunk.lines[1]!.lineNumber).toEqual({ new: 2 });
    expect(hunk.lines[2]!.lineNumber).toEqual({ new: 3 });
  });

  it("parses multiple files", () => {
    const raw = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,2 +1,2 @@",
      " const x = 1;",
      "-const y = 2;",
      "+const y = 3;",
      "diff --git a/src/b.ts b/src/b.ts",
      "deleted file mode 100644",
      "index 3333333..0000000",
      "--- a/src/b.ts",
      "+++ /dev/null",
      "@@ -1,2 +0,0 @@",
      "-const removed = true;",
      "-export { removed };",
      "",
    ].join("\n");

    const files = parseDiff(raw);

    expect(files).toHaveLength(2);

    const a = files[0]!;
    expect(a.file).toBe("src/a.ts");
    expect(a.isNewFile).toBe(false);
    expect(a.isDeleted).toBe(false);
    expect(a.hunks).toHaveLength(1);
    expect(a.hunks[0]!.lines.map((l) => l.type)).toEqual([
      "context",
      "remove",
      "add",
    ]);

    const b = files[1]!;
    expect(b.file).toBe("src/b.ts");
    expect(b.isDeleted).toBe(true);
    expect(b.isNewFile).toBe(false);
    expect(b.hunks[0]!.lines.every((l) => l.type === "remove")).toBe(true);
  });
});
