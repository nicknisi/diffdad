import { describe, expect, it } from "vitest";
import { buildNarrativePrompt } from "../narrative/prompt";
import type { DiffFile } from "../github/types";

describe("buildNarrativePrompt", () => {
  it("includes PR metadata and diff content", () => {
    const files: DiffFile[] = [
      {
        file: "src/constants.ts",
        isNewFile: false,
        isDeleted: false,
        hunks: [
          {
            header: "@@ -1,2 +1,3 @@",
            oldStart: 1,
            oldCount: 2,
            newStart: 1,
            newCount: 3,
            lines: [
              {
                type: "context",
                content: "export const x = 1;",
                lineNumber: { old: 1, new: 1 },
              },
              {
                type: "add",
                content: "export const y = 2;",
                lineNumber: { new: 2 },
              },
            ],
          },
        ],
      },
    ];

    const { system, user } = buildNarrativePrompt({
      title: "Add y constant",
      description: "Adds a new y constant for downstream math.",
      labels: ["enhancement"],
      files,
      fileTree: ["src/constants.ts", "src/index.ts"],
    });

    expect(system).toContain("semantic");
    expect(system).toContain("chapters");

    expect(user).toContain("Add y constant");
    expect(user).toContain("src/constants.ts");
    expect(user).toContain("export const y = 2;");
  });

  it("truncates the file tree to 200 entries", () => {
    const fileTree = Array.from({ length: 250 }, (_, i) => `src/file${i}.ts`);

    const { user } = buildNarrativePrompt({
      title: "Big PR",
      description: "",
      labels: [],
      files: [],
      fileTree,
    });

    expect(user).toContain("src/file0.ts");
    expect(user).toContain("src/file199.ts");
    expect(user).not.toContain("src/file200.ts");
  });
});
