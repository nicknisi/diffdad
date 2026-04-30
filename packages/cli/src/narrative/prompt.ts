import type { DiffFile, DiffHunk, DiffLine } from "../github/types";

export interface NarrativePromptInput {
  title: string;
  description: string;
  labels: string[];
  files: DiffFile[];
  fileTree: string[];
}

export interface NarrativePrompt {
  system: string;
  user: string;
}

const FILE_TREE_LIMIT = 200;

const RESPONSE_SCHEMA = `{
  "title": "string — overall narrative title for the PR",
  "chapters": [
    {
      "title": "string — chapter title",
      "summary": "string — short summary of what this chapter covers",
      "risk": "low | medium | high",
      "sections": [
        { "type": "narrative", "content": "string — prose explaining the change" },
        {
          "type": "diff",
          "file": "string — path to the file from the PR",
          "startLine": "number — first line in the new file (1-based)",
          "endLine": "number — last line in the new file (1-based)",
          "hunkIndex": "number — index of the hunk inside the DiffFile.hunks array (0-based)"
        }
      ]
    }
  ],
  "suggestedStart": {
    "chapter": "number — 0-based index of the chapter a reviewer should read first",
    "reason": "string — why start there"
  }
}`;

const SYSTEM_PROMPT = `You are Diff Dad, a senior staff engineer who turns pull request diffs into a readable narrative for code reviewers.

Your job is to read the entire PR — every file, every hunk — and produce a semantic walkthrough so a reviewer can understand the change as a story rather than a pile of files.

Rules:
- Group hunks by semantic behavior, not by file. A single chapter may pull hunks from many files, and the same hunk MAY appear in more than one chapter when it is genuinely relevant to multiple behaviors.
- Order chapters as a reading sequence: the order should be how a reviewer should read the change, not the order GitHub lists files.
- Assign each chapter a risk level — "low", "medium", or "high" — based on blast radius, subtlety, and how easy it is to get wrong.
- Inside each chapter, alternate "narrative" prose sections with "diff" sections that point at the relevant hunks. Narrative sections explain intent and consequences in plain language; diff sections cite the specific lines.
- Use the hunkIndex field to reference the position of the hunk inside the file's hunks array (0-based). Use startLine/endLine on the NEW side of the diff (1-based). For deleted files, use the OLD side line numbers.
- Suggest where a reviewer should start reading via "suggestedStart". Pick the chapter that best anchors the rest of the change.

Output format — return ONLY valid JSON, no prose around it, matching this schema:
${RESPONSE_SCHEMA}`;

function formatHunkLine(line: DiffLine): string {
  const prefix =
    line.type === "add" ? "+" : line.type === "remove" ? "-" : " ";
  return `${prefix}${line.content}`;
}

function formatHunk(hunk: DiffHunk): string {
  const body = hunk.lines.map(formatHunkLine).join("\n");
  return `${hunk.header}\n${body}`;
}

function formatFile(file: DiffFile): string {
  const header = `diff --git a/${file.file} b/${file.file}`;
  const fromPath = file.isNewFile ? "/dev/null" : `a/${file.file}`;
  const toPath = file.isDeleted ? "/dev/null" : `b/${file.file}`;
  const fileMarkers = [
    file.isNewFile ? "new file" : null,
    file.isDeleted ? "deleted file" : null,
  ]
    .filter(Boolean)
    .join(" ");
  const meta = [header];
  if (fileMarkers) meta.push(fileMarkers);
  meta.push(`--- ${fromPath}`, `+++ ${toPath}`);
  const hunks = file.hunks.map(formatHunk).join("\n");
  return `${meta.join("\n")}\n${hunks}`;
}

export function buildNarrativePrompt(
  input: NarrativePromptInput,
): NarrativePrompt {
  const { title, description, labels, files, fileTree } = input;

  const truncatedTree = fileTree.slice(0, FILE_TREE_LIMIT);
  const labelLine = labels.length > 0 ? labels.join(", ") : "(none)";
  const descriptionBlock = description.trim().length > 0 ? description : "(no description provided)";
  const treeBlock =
    truncatedTree.length > 0 ? truncatedTree.join("\n") : "(empty)";
  const diffBlock =
    files.length > 0 ? files.map(formatFile).join("\n") : "(no file changes)";

  const user = [
    `PR title: ${title}`,
    "",
    "PR description:",
    descriptionBlock,
    "",
    `Labels: ${labelLine}`,
    "",
    `File tree (first ${FILE_TREE_LIMIT} entries):`,
    treeBlock,
    "",
    "Unified diff:",
    diffBlock,
  ].join("\n");

  return { system: SYSTEM_PROMPT, user };
}
