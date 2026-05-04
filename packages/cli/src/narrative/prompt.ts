import type { DiffFile, DiffHunk, DiffLine } from '../github/types';

export type PreviousNarrativeContext = {
  previousTldr?: string;
  previousChapterTitles?: string[];
};

export interface NarrativePromptInput {
  title: string;
  description: string;
  labels: string[];
  files: DiffFile[];
  fileTree: string[];
  skippedFiles?: string[];
  previousContext?: PreviousNarrativeContext;
}

export interface PromptCapStats {
  perFileCap: number;
  globalCap: number;
  inputFileCount: number;
  inputLineCount: number;
  narratedFileCount: number;
  narratedLineCount: number;
  truncatedFiles: { file: string; hunksDropped: number; linesDropped: number }[];
  droppedFiles: string[];
}

export interface NarrativePrompt {
  system: string;
  user: string;
  stats: PromptCapStats;
}

const FILE_TREE_LIMIT = 200;
const MAX_TOTAL_DIFF_LINES = 12000;

const MECHANICAL_BASENAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'composer.lock',
  'Gemfile.lock',
  'Pipfile.lock',
  'poetry.lock',
  'uv.lock',
  'cargo.lock',
  'go.sum',
]);

const MECHANICAL_PATH_REGEXES: RegExp[] = [
  /\.min\.(js|css|mjs)$/i,
  /\.map$/i,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)\.next\//,
  /(^|\/)node_modules\//,
  /(^|\/)vendor\//,
];

export function isMechanicalFile(path: string): boolean {
  const basename = path.split('/').pop() ?? path;
  if (MECHANICAL_BASENAMES.has(basename)) return true;
  if (basename.toLowerCase() === 'cargo.lock') return true;
  return MECHANICAL_PATH_REGEXES.some((re) => re.test(path));
}

export function partitionMechanicalFiles(files: DiffFile[]): { narrate: DiffFile[]; skipped: DiffFile[] } {
  const narrate: DiffFile[] = [];
  const skipped: DiffFile[] = [];
  for (const f of files) {
    if (isMechanicalFile(f.file)) skipped.push(f);
    else narrate.push(f);
  }
  return { narrate, skipped };
}

export const NARRATIVE_JSON_SCHEMA = {
  type: 'object',
  required: ['title', 'chapters'],
  properties: {
    title: { type: 'string' },
    tldr: { type: 'string' },
    verdict: { type: 'string', enum: ['safe', 'caution', 'risky'] },
    chapters: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'summary', 'risk', 'sections'],
        properties: {
          title: { type: 'string' },
          summary: { type: 'string' },
          risk: { type: 'string', enum: ['low', 'medium', 'high'] },
          sections: {
            type: 'array',
            items: {
              oneOf: [
                {
                  type: 'object',
                  required: ['type', 'content'],
                  properties: {
                    type: { type: 'string', enum: ['narrative'] },
                    content: { type: 'string' },
                  },
                },
                {
                  type: 'object',
                  required: ['type', 'file', 'startLine', 'endLine', 'hunkIndex'],
                  properties: {
                    type: { type: 'string', enum: ['diff'] },
                    file: { type: 'string' },
                    startLine: { type: 'number' },
                    endLine: { type: 'number' },
                    hunkIndex: { type: 'number' },
                  },
                },
              ],
            },
          },
          callouts: {
            type: 'array',
            items: {
              type: 'object',
              required: ['file', 'line', 'level', 'message'],
              properties: {
                file: { type: 'string' },
                line: { type: 'number' },
                level: { type: 'string', enum: ['nit', 'concern', 'warning'] },
                message: { type: 'string' },
              },
            },
          },
          reshow: {
            type: 'array',
            items: {
              type: 'object',
              required: ['ref'],
              properties: {
                ref: { type: 'number' },
                file: { type: 'string' },
                framing: { type: 'string' },
                highlight: {
                  type: 'object',
                  required: ['from', 'to'],
                  properties: { from: { type: 'number' }, to: { type: 'number' } },
                },
              },
            },
          },
        },
      },
    },
    missing: { type: 'array', items: { type: 'string' } },
    suggestedStart: {
      type: 'object',
      required: ['chapter', 'reason'],
      properties: { chapter: { type: 'number' }, reason: { type: 'string' } },
    },
  },
} as const;

const RESPONSE_SCHEMA = `{
  "title": "string — overall narrative title for the PR",
  "tldr": "string — 1-2 sentence plain-language summary: what this PR does and why",
  "verdict": "safe | caution | risky — overall reviewer confidence signal",
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
      ],
      "callouts": [
        {
          "file": "string — file path",
          "line": "number — line number (new side, 1-based)",
          "level": "nit | concern | warning",
          "message": "string — specific thing to verify, question, or flag"
        }
      ],
      "reshow": [
        {
          "ref": "number — hunkIndex of a hunk to re-display from another chapter",
          "file": "string — file path (must match a diff section's file for the given hunkIndex)",
          "framing": "string — markdown explaining why it's reshown",
          "highlight": { "from": "number — first line (new-side, 1-based)", "to": "number — last line (new-side, 1-based)" }
        }
      ]
    }
  ],
  "missing": [
    "string — things notably absent from this PR: missing tests, error handling, docs, migrations, edge cases"
  ],
  "suggestedStart": {
    "chapter": "number — 0-based index of the chapter a reviewer should read first",
    "reason": "string — why start there"
  }
}`;

const SYSTEM_PROMPT = `You are Diff Dad, a senior staff engineer preparing a code review walkthrough.

Your job is to read the entire PR and produce a review narrative that helps a reviewer understand, evaluate, and verify the change — not just see what changed, but understand what matters.

## Narrative Philosophy

A diff shows WHAT changed. Your narrative explains:
- **Behavioral delta** — what's different at runtime. "Before: requests retry 3 times. Now: they retry once with exponential backoff." Don't describe the code — describe the consequence.
- **Reviewer focus** — where to spend time. A 200-line reformatting chapter gets a sentence. A 5-line auth change gets a paragraph. Attention is proportional to risk, not line count.
- **Verification guidance** — what to check. "Verify the timeout is propagated to the retry wrapper." "Check that the migration is reversible." Specific, actionable.

## Structure Rules

- Group hunks by semantic behavior, not by file. A chapter may pull hunks from many files.
- **Avoid duplicating hunks.** Each hunk should appear as a diff section in ONE chapter (its owner). To reference it elsewhere, use a reshow entry with a highlight range. When a large hunk (especially in a new file) covers multiple concerns, use startLine/endLine to focus each diff section on just the relevant lines — don't repeat the whole hunk.
- Order chapters as a review reading sequence. Lead with the chapter that anchors understanding of the whole change. Build from core behavior outward.
- Each chapter gets a risk level:
  - **low** — mechanical, safe, minimal review needed (renames, formatting, dependency bumps)
  - **medium** — functional change with bounded blast radius (new feature behind a flag, refactor with tests)
  - **high** — subtle correctness risk, security-relevant, public API change, data migration, concurrency, or missing guardrails

## Within Each Chapter

Alternate narrative and diff sections. Narrative sections must:
1. State the behavioral delta — what was true before, what's true now
2. Explain why it matters — what breaks if this is wrong
3. Call out anything subtle — implicit assumptions, ordering dependencies, edge cases

Use the callouts array for specific line-level review guidance:
- **nit** — style, naming, minor improvement suggestion
- **concern** — potential issue worth discussing, might be intentional
- **warning** — likely bug, security issue, or correctness risk

## What's Missing

After analyzing the diff, populate the top-level "missing" array with things NOT in the PR that probably should be:
- Tests for new behavior or changed edge cases
- Error handling for new failure modes
- Documentation for API changes
- Migration steps for schema or config changes
- Validation for new inputs
Only flag genuinely concerning omissions, not a checklist of everything theoretically possible. Omit the field entirely if nothing is missing.

## Verdict

Assign an overall verdict:
- **safe** — straightforward change, low risk of issues
- **caution** — functional change that needs careful review but looks sound
- **risky** — has at least one high-risk chapter, or significant omissions

## Diff Referencing

- hunkIndex: 0-based position in the file's hunks array (NOT a global index). Each file's hunks are independently indexed starting at 0.
- startLine/endLine: NEW side of the diff, 1-based. For deleted files, use OLD side. Use these to FOCUS: when a chapter only discusses part of a hunk, set startLine/endLine to just the relevant range — the viewer will dim lines outside this window.
- Reshow: reference a hunk owned by another chapter via "reshow" with a highlight range. Prefer this over duplicating a diff section. This is especially important for new files where a single hunk contains the entire file.

## Suggested Start

Pick the chapter that best anchors the rest of the change. Often this is the core behavioral change, not the first file alphabetically.

## Brevity

You are output-token-bound. Every chapter and sentence costs the reader real wait time. Aim for **3–6 chapters total**, not more, even on large PRs — group aggressively. Keep each narrative section to **1–3 sentences**. Use callouts and the missing array only when they add real value; omit them when they don't. Cut anything restating what the diff already shows.

Output format — return ONLY valid JSON, no prose around it, matching this schema:
${RESPONSE_SCHEMA}`;

function formatHunkLine(line: DiffLine): string {
  const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
  return `${prefix}${line.content}`;
}

function formatHunk(hunk: DiffHunk, index: number): string {
  const body = hunk.lines.map(formatHunkLine).join('\n');
  return `[hunkIndex=${index}]\n${hunk.header}\n${body}`;
}

const MAX_LINES_PER_FILE = 800;

function formatFile(
  file: DiffFile,
  lineBudget: number,
): { text: string; linesUsed: number; truncated: boolean; hunksDropped: number; linesDropped: number } {
  const header = `diff --git a/${file.file} b/${file.file}`;
  const fromPath = file.isNewFile ? '/dev/null' : `a/${file.file}`;
  const toPath = file.isDeleted ? '/dev/null' : `b/${file.file}`;
  const fileMarkers = [file.isNewFile ? 'new file' : null, file.isDeleted ? 'deleted file' : null]
    .filter(Boolean)
    .join(' ');
  const meta = [header];
  if (fileMarkers) meta.push(fileMarkers);
  meta.push(`--- ${fromPath}`, `+++ ${toPath}`);

  const cap = Math.min(MAX_LINES_PER_FILE, lineBudget);
  let linesUsed = 0;
  let truncated = false;
  const includedHunks: string[] = [];
  let omittedHunks = 0;
  let omittedLines = 0;

  for (let i = 0; i < file.hunks.length; i++) {
    const h = file.hunks[i];
    if (linesUsed + h.lines.length > cap) {
      truncated = true;
      omittedHunks = file.hunks.length - i;
      for (let j = i; j < file.hunks.length; j++) omittedLines += file.hunks[j].lines.length;
      break;
    }
    includedHunks.push(formatHunk(h, i));
    linesUsed += h.lines.length;
  }

  let body = includedHunks.join('\n');
  if (truncated) {
    body += `\n[FILE TRUNCATED: ${omittedHunks} more hunk(s), ${omittedLines} more line(s) omitted to fit prompt budget]`;
  }
  return { text: `${meta.join('\n')}\n${body}`, linesUsed, truncated, hunksDropped: omittedHunks, linesDropped: omittedLines };
}

export function buildNarrativePrompt(input: NarrativePromptInput): NarrativePrompt {
  const { title, description, labels, files, fileTree, skippedFiles, previousContext } = input;

  const truncatedTree = fileTree.slice(0, FILE_TREE_LIMIT);
  const labelLine = labels.length > 0 ? labels.join(', ') : '(none)';
  const descriptionBlock = description.trim().length > 0 ? description : '(no description provided)';
  const treeBlock = truncatedTree.length > 0 ? truncatedTree.join('\n') : '(empty)';

  let lineBudget = MAX_TOTAL_DIFF_LINES;
  const truncatedFileDetails: { file: string; hunksDropped: number; linesDropped: number }[] = [];
  const truncatedFiles: string[] = [];
  const fileBlocks: string[] = [];
  const droppedFiles: string[] = [];
  let inputLineCount = 0;
  let narratedLineCount = 0;
  for (const file of files) {
    const fileLineCount = file.hunks.reduce((sum, h) => sum + h.lines.length, 0);
    inputLineCount += fileLineCount;
    if (lineBudget <= 0) {
      droppedFiles.push(file.file);
      continue;
    }
    const formatted = formatFile(file, lineBudget);
    fileBlocks.push(formatted.text);
    lineBudget -= formatted.linesUsed;
    narratedLineCount += formatted.linesUsed;
    if (formatted.truncated) {
      truncatedFiles.push(file.file);
      truncatedFileDetails.push({
        file: file.file,
        hunksDropped: formatted.hunksDropped,
        linesDropped: formatted.linesDropped,
      });
    }
  }
  const diffBlock = fileBlocks.length > 0 ? fileBlocks.join('\n') : '(no file changes)';

  const parts = [
    `PR title: ${title}`,
    '',
    'PR description:',
    descriptionBlock,
    '',
    `Labels: ${labelLine}`,
    '',
    `File tree (first ${FILE_TREE_LIMIT} entries):`,
    treeBlock,
    '',
    'Unified diff:',
    diffBlock,
  ];

  if (skippedFiles && skippedFiles.length > 0) {
    parts.push(
      '',
      `Mechanical files omitted from the diff above (lockfiles, generated, minified — do not narrate, but mention briefly if relevant): ${skippedFiles.join(', ')}`,
    );
  }

  if (truncatedFiles.length > 0) {
    parts.push(
      '',
      `Files truncated to fit prompt budget (later hunks omitted; the [FILE TRUNCATED: ...] marker shows what was cut): ${truncatedFiles.join(', ')}`,
    );
  }

  if (droppedFiles.length > 0) {
    parts.push(
      '',
      `Files entirely omitted because the prompt budget was exhausted before reaching them. Mention them in your narrative without trying to describe specific changes: ${droppedFiles.join(', ')}`,
    );
  }

  if (previousContext?.previousTldr || previousContext?.previousChapterTitles?.length) {
    parts.push(
      '',
      '---',
      '',
      'PREVIOUS REVIEW CONTEXT:',
      'This PR was reviewed before with an earlier version of the code. Include a final chapter titled "What Changed" that summarizes how the PR evolved since the previous review. Focus on behavioral differences, not just file-level changes.',
    );
    if (previousContext.previousTldr) {
      parts.push('', `Previous summary: ${previousContext.previousTldr}`);
    }
    if (previousContext.previousChapterTitles?.length) {
      parts.push('', `Previous chapters: ${previousContext.previousChapterTitles.join(', ')}`);
    }
  }

  const user = parts.join('\n');
  const stats: PromptCapStats = {
    perFileCap: MAX_LINES_PER_FILE,
    globalCap: MAX_TOTAL_DIFF_LINES,
    inputFileCount: files.length,
    inputLineCount,
    narratedFileCount: fileBlocks.length,
    narratedLineCount,
    truncatedFiles: truncatedFileDetails,
    droppedFiles,
  };
  return { system: SYSTEM_PROMPT, user, stats };
}
