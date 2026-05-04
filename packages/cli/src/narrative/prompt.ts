import type { DiffFile, DiffHunk, DiffLine } from '../github/types';
import { computeRisk, formatRiskHints, type FileRisk } from './risk';

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
  /** Files we already filtered out before getting here — listed for the LLM to reference if needed. */
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
  /** Files that survived diff filtering and were sent to the LLM. */
  keptFiles: DiffFile[];
  /** Per-file risk signals passed to the LLM as ordering hints. */
  risks: FileRisk[];
}

const FILE_TREE_LIMIT = 200;
const MAX_CHAPTERS = 7;
const MAX_LINES_PER_FILE = 800;
const MAX_TOTAL_DIFF_LINES = 12000;

const RESPONSE_SCHEMA = `{
  "title": "string — short title for the PR's review story",
  "tldr": "string — exactly 1 sentence summarizing what this PR does",
  "verdict": "safe | caution | risky — overall reviewer signal",
  "readingPlan": [
    {
      "step": "string — imperative instruction, e.g. 'Start at chapter 3 — that's where the auth boundary moved.'",
      "chapterIndex": "number? — 0-based chapter to jump to (optional)",
      "why": "string? — short reason"
    }
  ],
  "concerns": [
    {
      "question": "string — must be a question. e.g. 'In foo.ts:42, what happens if the cache misses while a write is in flight?'",
      "file": "string — file path",
      "line": "number — 1-based line on the new side",
      "category": "logic | state | timing | validation | security | test-gap | api-contract | error-handling",
      "why": "string — 1 sentence: why this is worth asking"
    }
  ],
  "chapters": [
    {
      "title": "string — chapter title",
      "summary": "string — exactly 1 sentence: what this chapter covers",
      "whyMatters": "string — 1-2 sentences: what breaks if this is wrong",
      "risk": "low | medium | high",
      "sections": [
        { "type": "narrative", "content": "string — prose explaining the behavioral delta" },
        {
          "type": "diff",
          "file": "string — file path",
          "startLine": "number — first line in the new file (1-based)",
          "endLine": "number — last line in the new file (1-based)",
          "hunkIndex": "number — 0-based index into DiffFile.hunks for the file"
        }
      ],
      "callouts": [
        {
          "file": "string",
          "line": "number — 1-based, new side",
          "level": "nit | concern | warning",
          "message": "string"
        }
      ],
      "reshow": [
        {
          "ref": "number — hunkIndex of a hunk owned by another chapter",
          "file": "string",
          "framing": "string — markdown explaining why it's reshown",
          "highlight": { "from": "number", "to": "number" }
        }
      ]
    }
  ],
  "missing": [
    "string — things notably absent: missing tests, error handling, docs, migrations, edge cases"
  ]
}`;

const SYSTEM_PROMPT = `You are Diff Dad, a senior engineer producing a code review walkthrough.

Your job is to help a reviewer find the things they would otherwise miss. Empirical research on code review (Mantyla & Lassenius 2009) shows that human reviewers reliably catch style and structure issues but miss bugs in **logic, state, timing, and input validation**. Your value is on the slip set — not the obvious stuff.

## Operating principles

1. **Target the slip set.** Concentrate on logic, state, timing, validation, error handling, security, API contracts, and test gaps. Do NOT comment on style, formatting, naming, or readability unless it changes runtime behavior.
2. **Lead with concerns, not chapters.** A reviewer should be able to read your top-level concerns and reading plan in 30 seconds and know where to look.
3. **Phrase concerns as questions.** Socratic framing engages the reviewer's reasoning and protects against you being confidently wrong. "What happens if X is null when Y fires?" is correct. "X can be null when Y fires." is wrong — never assert what you cannot prove from the diff.
4. **Anchor everything.** Every concern and callout MUST have a real \`file\` and \`line\` from the diff. If you cannot anchor a thought to file:line, omit it.
5. **Be brief.** A reviewer skims. One sentence beats three. If it isn't useful, cut it.
6. **No false positives are better than no comments.** A loud confidently-wrong concern destroys trust faster than a missed bug.

## What to produce

### tldr (1 sentence)
Plain-language: what this PR does. No risk language; that's the verdict's job.

### verdict (one of safe | caution | risky)
- **safe** — mechanical, low-risk: renames, formatting, dependency bumps, config tweaks with no behavior change.
- **caution** — functional change worth careful review.
- **risky** — touches the slip set: auth/security/data/concurrency, or has significant omissions.

### readingPlan (3-5 steps, ordered)
Each step is an imperative instruction with an optional chapter jump. Order so a reviewer who stops after step 2 still has the most important context. Example:
- "Start at chapter 3 — that's where the auth boundary moved." (chapterIndex=2)
- "Then 1 to confirm the migration is reversible." (chapterIndex=0)
- "Skim 4-5; they're scaffolding."

### concerns (up to ~6, fewer is better)
Specific, anchored, Socratic questions. Each has category, file:line, why.
- **logic** — branch correctness, off-by-one, fallthrough, dead code paths
- **state** — invariants broken, ordering, missed initialization, mutation hazards
- **timing** — race conditions, stale reads, retry/timeout bugs, async ordering
- **validation** — input/state not checked, trust-boundary violations
- **security** — auth, authz, injection, secret exposure, crypto misuse
- **test-gap** — added/changed behavior with no test that asserts it
- **api-contract** — public API change without a corresponding consumer update or compat shim
- **error-handling** — failure mode silently swallowed, retried wrong, or surfaced badly

If you have nothing real to say, return an empty array. Do not pad.

### chapters (max ${MAX_CHAPTERS}, ideally 3-5)
Group hunks by behavior, not by file. A reviewer will skim chapter titles and read whyMatters before diving in.
- **summary** — exactly 1 sentence: what this chapter covers.
- **whyMatters** — 1-2 sentences: what breaks if this is wrong, or what guarantee this enforces. THIS IS THE MOST IMPORTANT FIELD. Don't just describe — explain consequence.
- **risk** — low/medium/high (proportional to slip-set exposure, not line count).
- **sections** — alternate \`narrative\` and \`diff\` sections.
- **callouts** — line-level review guidance: \`nit\` (style), \`concern\` (worth discussing), \`warning\` (likely bug). Skip nits. Use concerns/warnings sparingly — the top-level \`concerns\` array is the primary surface.

Order chapters by risk descending. The first chapter should be the highest-risk slice; mechanical changes go last.

### missing (optional)
Things genuinely absent: missing tests, missing migration, missing error handling for a new failure mode, missing validation. Only include items that are real risks. Skip if nothing fits.

## Diff conventions

- Each hunk has a \`[hunkIndex=N]\` marker. \`hunkIndex\` is per-file, 0-based — index into DiffFile.hunks for that file.
- \`startLine\`/\`endLine\` are 1-based on the NEW side (use OLD side for deletions). Use these to FOCUS a chapter on the relevant range; the viewer dims lines outside the window.
- Each hunk should be displayed in ONE chapter. To reference it elsewhere, use \`reshow\`. For a new file with one giant hunk, use \`startLine\`/\`endLine\` to focus each section on the relevant slice.
- A \`[FILE TRUNCATED: ...]\` marker means the diff was capped to fit the prompt budget — describe what you can see and acknowledge the omission rather than inventing details.

## Risk hints

You will receive per-file risk signals (churn, inbound refs, criticality keywords, test-gap flags). Use them to:
- Order chapters: risky files lead.
- Weight the reading plan: point reviewers at high-risk files first.
- Tune concerns: a file with criticality=auth + test-gap deserves at least one concern.

But the signals are heuristics. Do not invent concerns just because the score is high; only flag concerns you can actually anchor to specific lines in the diff.

## Brevity

You are output-token-bound. Every chapter and sentence costs the reader real wait time. Aim for **3-6 chapters total**, never more than ${MAX_CHAPTERS}, even on large PRs — group aggressively. Keep narrative sections to **1-3 sentences**. Cut anything restating what the diff already shows.

## Output

Return ONLY valid JSON, no prose around it, matching this schema:
${RESPONSE_SCHEMA}`;

function formatHunkLine(line: DiffLine): string {
  const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
  return `${prefix}${line.content}`;
}

function formatHunk(hunk: DiffHunk, index: number): string {
  const body = hunk.lines.map(formatHunkLine).join('\n');
  return `[hunkIndex=${index}]\n${hunk.header}\n${body}`;
}

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
    const h = file.hunks[i]!;
    if (linesUsed + h.lines.length > cap) {
      truncated = true;
      omittedHunks = file.hunks.length - i;
      for (let j = i; j < file.hunks.length; j++) omittedLines += file.hunks[j]!.lines.length;
      break;
    }
    includedHunks.push(formatHunk(h, i));
    linesUsed += h.lines.length;
  }

  let body = includedHunks.join('\n');
  if (truncated) {
    body += `\n[FILE TRUNCATED: ${omittedHunks} more hunk(s), ${omittedLines} more line(s) omitted to fit prompt budget]`;
  }
  return {
    text: `${meta.join('\n')}\n${body}`,
    linesUsed,
    truncated,
    hunksDropped: omittedHunks,
    linesDropped: omittedLines,
  };
}

export function buildNarrativePrompt(input: NarrativePromptInput): NarrativePrompt {
  const { title, description, labels, files, fileTree, skippedFiles, previousContext } = input;

  const truncatedTree = fileTree.slice(0, FILE_TREE_LIMIT);
  const labelLine = labels.length > 0 ? labels.join(', ') : '(none)';
  const descriptionBlock = description.trim().length > 0 ? description : '(no description provided)';
  const treeBlock = truncatedTree.length > 0 ? truncatedTree.join('\n') : '(empty)';

  // Risk hints are computed on the files we actually narrate (mechanical files
  // are partitioned out earlier by the engine).
  const risks = computeRisk(files);

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
  const riskBlock = formatRiskHints(risks);

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
  ];

  if (riskBlock) {
    parts.push(riskBlock, '');
  }

  parts.push('Unified diff:', diffBlock);

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
      'This PR was reviewed before with an earlier version of the code. Mention notable changes from the previous review in the appropriate chapter\'s whyMatters or in a concern, but do NOT add a "What Changed" chapter — keep the structure focused on the current state.',
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
  return { system: SYSTEM_PROMPT, user, stats, keptFiles: files, risks };
}
