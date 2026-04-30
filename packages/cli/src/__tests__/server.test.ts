import { describe, it, expect } from "vitest";
import { createServer } from "../server";
import type { NarrativeResponse } from "../narrative/types";
import type { PRMetadata } from "../github/types";

const mockNarrative: NarrativeResponse = {
  title: "Test PR",
  chapters: [{
    title: "Add feature", summary: "Adds a new feature", risk: "low",
    sections: [
      { type: "narrative", content: "This adds a feature." },
      { type: "diff", file: "src/index.ts", startLine: 1, endLine: 5, hunkIndex: 0 },
    ],
  }],
};

const mockPR: PRMetadata = {
  number: 1, title: "Test PR", body: "", state: "open", draft: false,
  author: { login: "test", avatarUrl: "" }, branch: "feat", base: "main",
  labels: [], createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  additions: 10, deletions: 2, changedFiles: 1, commits: 1,
};

describe("server", () => {
  it("serves narrative at /api/narrative", async () => {
    const app = createServer({
      narrative: mockNarrative, pr: mockPR, files: [], comments: [],
      github: {} as any, owner: "test", repo: "test",
    });
    const res = await app.request("/api/narrative");
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.narrative.title).toBe("Test PR");
    expect(data.narrative.chapters).toHaveLength(1);
  });
});
