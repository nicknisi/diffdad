import type { DiffFile, DiffHunk, DiffLine } from '../github/types';
import { formatHintsBlock, type HunkHint } from './hints';
import type { Plan, PlanTheme } from './plan-types';
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
  /** Optional non-LLM signals fed into the planner prompt. Ignored by the single-pass narrator. */
  hints?: HunkHint[];
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
const MAX_THEMES = 7;

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

const PLAN_RESPONSE_SCHEMA = `{
  "schemaVersion": 1,
  "prTitle": "string — short title for the PR's review story",
  "prTldr": "string — exactly 1 sentence: what this PR does",
  "prVerdict": "safe | caution | risky",
  "themes": [
    {
      "id": "string — stable identifier, e.g. 'theme-0'. Use 'theme-0', 'theme-1', ... in order.",
      "title": "string — chapter title for this theme",
      "riskLevel": "low | medium | high",
      "rationale": "string — exactly 1 sentence: WHY these hunks belong together. Fed to the writer.",
      "hunkRefs": [
        { "file": "string — file path", "hunkIndex": "number — 0-based, per-file" }
      ],
      "suppress": "boolean? — true ONLY for the mechanical-changes theme; reviewer won't see prose for it"
    }
  ],
  "readingPlan": [
    {
      "step": "string — imperative instruction",
      "chapterIndex": "number? — 0-based theme index",
      "why": "string?"
    }
  ],
  "concerns": [
    {
      "question": "string — must be a question",
      "file": "string",
      "line": "number — 1-based new side",
      "category": "logic | state | timing | validation | security | test-gap | api-contract | error-handling",
      "why": "string"
    }
  ],
  "missing": [ "string" ]
}`;

const CHAPTER_RESPONSE_SCHEMA = `{
  "title": "string — should match the theme title verbatim",
  "summary": "string — exactly 1 sentence: what this chapter covers",
  "whyMatters": "string — 1-2 sentences: what breaks if this is wrong",
  "risk": "low | medium | high",
  "sections": [
    { "type": "narrative", "content": "string — prose. Aim for 1-3 sentences per narrative section." },
    {
      "type": "diff",
      "file": "string — must be one of the files listed in this theme",
      "startLine": "number — 1-based new side",
      "endLine": "number — 1-based new side",
      "hunkIndex": "number — must be one of this theme's hunkIndex values for the given file"
    }
  ],
  "callouts": [
    { "file": "string", "line": "number", "level": "nit | concern | warning", "message": "string" }
  ]
}`;

const SHARED_PRINCIPLES = `Your job is to help a reviewer find the things they would otherwise miss. Empirical research on code review (Mantyla & Lassenius 2009) shows that human reviewers reliably catch style and structure issues but miss bugs in **logic, state, timing, and input validation**. Your value is on the slip set — not the obvious stuff.

## Operating principles

1. **Target the slip set.** Concentrate on logic, state, timing, validation, error handling, security, API contracts, and test gaps. Do NOT comment on style, formatting, naming, or readability unless it changes runtime behavior.
2. **Lead with concerns, not chapters.** A reviewer should be able to read your top-level concerns and reading plan in 30 seconds and know where to look.
3. **Phrase concerns as questions.** Socratic framing engages the reviewer's reasoning and protects against you being confidently wrong. "What happens if X is null when Y fires?" is correct. "X can be null when Y fires." is wrong — never assert what you cannot prove from the diff.
4. **Anchor everything.** Every concern and callout MUST have a real \`file\` and \`line\` from the diff. If you cannot anchor a thought to file:line, omit it.
5. **Be brief.** A reviewer skims. One sentence beats three. If it isn't useful, cut it.
6. **No false positives are better than no comments.** A loud confidently-wrong concern destroys trust faster than a missed bug.`;

const SYSTEM_PROMPT = `You are Diff Dad, a senior engineer producing a code review walkthrough.

${SHARED_PRINCIPLES}

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

const PLANNER_SYSTEM_PROMPT = `You are Diff Dad's planner. You are running the FIRST of two passes: you decide the chapter structure for a PR review, then a second pass writes the prose.

${SHARED_PRINCIPLES}

## Your job in this pass

You produce a plan: a list of THEMES that group hunks by behavior across files. A reviewer will read theme titles and the reading plan in 30 seconds and decide where to look first. The writer pass receives one theme at a time and writes prose for it; if your theme is incoherent, the writer cannot fix it.

### Hard rules

1. **Cover every hunk exactly once.** Every hunk in the diff must appear in the \`hunkRefs\` of exactly one theme. No duplicates. No omissions.
2. **Group across files when behavior aligns.** If hunks in three files all implement the same auth boundary change, that is ONE theme.
3. **Use \`suppress: true\` for the mechanical bucket.** Pure renames, import-only changes, version bumps, formatting that don't change behavior. The reviewer won't see prose for these. At most ONE suppressed theme.
4. **Order themes by risk descending.** The first theme should be the highest-risk slice. The suppressed mechanical theme, if any, comes last.
5. **Aim for 3-6 themes**, never more than ${MAX_THEMES}. Two-hunk themes are OK if they are genuinely the same behavior; singleton themes are reserved for high-risk single-hunk changes.
6. **rationale is for the writer.** One sentence: WHY these hunks belong together. The writer will use this to frame their prose. Do not write prose here.

### What goes in the plan vs. the writer

You produce: the theme structure, top-level reading plan, top-level concerns, missing-items list, PR title/tldr/verdict.
The writer produces: chapter prose (summary, whyMatters, narrative sections, diff sections, callouts).

So your concerns and reading plan are real and final; your themes are the skeleton the writer fleshes out.

## Verdict, reading plan, concerns

Same rules as the single-pass narrator (see below). These live on the plan so the writer doesn't need to re-derive them.

- **safe** — mechanical, low-risk
- **caution** — functional change worth careful review
- **risky** — touches the slip set: auth/security/data/concurrency

ReadingPlan is 3-5 imperative steps with optional \`chapterIndex\` jumps to your themes (0-based).

Concerns are anchored Socratic questions (file:line:category:why). Categories: logic, state, timing, validation, security, test-gap, api-contract, error-handling.

## Diff conventions

- Each hunk has a \`[hunkIndex=N]\` marker. \`hunkIndex\` is per-file, 0-based.
- \`hunkRefs\` entries reference \`{ file, hunkIndex }\` — the file path matches the diff exactly; the hunkIndex matches the marker.
- A \`[FILE TRUNCATED: ...]\` marker means the diff was capped — acknowledge the omission rather than inventing details, and still cover the visible hunks.

## Few-shot examples

These are abbreviated. Real plans have full readingPlan/concerns/missing.

### Example 1 — cross-file behavioral grouping (a refactor that touches three files):

\`\`\`json
{
  "schemaVersion": 1,
  "prTitle": "Move auth check from controller to middleware",
  "prTldr": "Centralizes auth in a single middleware so route handlers no longer call requireAuth() themselves.",
  "prVerdict": "caution",
  "themes": [
    {
      "id": "theme-0",
      "title": "Auth boundary moves into middleware",
      "riskLevel": "high",
      "rationale": "These three hunks together implement the new boundary: middleware adds the check, controller and route remove it.",
      "hunkRefs": [
        { "file": "src/middleware/auth.ts", "hunkIndex": 0 },
        { "file": "src/controllers/posts.ts", "hunkIndex": 2 },
        { "file": "src/routes/api.ts", "hunkIndex": 1 }
      ]
    },
    {
      "id": "theme-1",
      "title": "Test coverage for the new boundary",
      "riskLevel": "medium",
      "rationale": "Tests verifying the middleware fires before the handler and the handlers no longer need the old check.",
      "hunkRefs": [
        { "file": "src/__tests__/auth.test.ts", "hunkIndex": 0 },
        { "file": "src/__tests__/posts.test.ts", "hunkIndex": 1 }
      ]
    }
  ],
  "readingPlan": [],
  "concerns": []
}
\`\`\`

Note: theme-0 spans 3 files because they implement ONE behavioral change. Theme-1 groups the test hunks for it. File order in the diff was middleware/auth, then auth.test, then posts, then posts.test, then routes — but themes regroup them by behavior.

### Example 2 — suppressed mechanical bucket alongside real themes:

\`\`\`json
{
  "schemaVersion": 1,
  "prTitle": "Add feature flag for new pricing flow",
  "prTldr": "Wires up a new feature flag that gates the pricing v2 codepath.",
  "prVerdict": "caution",
  "themes": [
    {
      "id": "theme-0",
      "title": "New pricing path gated by flag",
      "riskLevel": "high",
      "rationale": "The actual conditional that picks v1 vs v2 lives here.",
      "hunkRefs": [
        { "file": "src/pricing/index.ts", "hunkIndex": 0 },
        { "file": "src/pricing/v2.ts", "hunkIndex": 0 }
      ]
    },
    {
      "id": "theme-1",
      "title": "Mechanical changes",
      "riskLevel": "low",
      "rationale": "Import reshuffles and a rename of an unused symbol; no behavior change.",
      "suppress": true,
      "hunkRefs": [
        { "file": "src/index.ts", "hunkIndex": 0 },
        { "file": "src/util/format.ts", "hunkIndex": 1 }
      ]
    }
  ],
  "readingPlan": [],
  "concerns": []
}
\`\`\`

Note: at most one suppressed theme; everything mechanical lands in it; reviewer sees a collapsed entry without prose.

## Output

Return ONLY valid JSON, no prose around it, matching this schema:
${PLAN_RESPONSE_SCHEMA}`;

const WRITER_SYSTEM_PROMPT = `You are Diff Dad's writer. You are running the SECOND of two passes: a planner has already decided the chapter structure; you write the prose for ONE theme.

${SHARED_PRINCIPLES}

## Your job in this pass

You produce ONE chapter: title, 1-sentence summary, 1-2-sentence whyMatters, sections alternating narrative and diff, optional callouts.

### Hard rules

1. **Use the title from the plan verbatim.** Don't rename the theme.
2. **Reference only this theme's hunks.** \`sections[].file\` and \`sections[].hunkIndex\` must come from the \`hunkRefs\` you were given. Do not invent or refer to other files.
3. **Anchor everything.** Every concern and callout MUST have a real file:line from the diff.
4. **Be brief.** Narrative sections are 1-3 sentences. whyMatters is 1-2 sentences. Cut anything restating what the diff already shows.
5. **Phrase questions as questions.** Don't assert what you can't prove from the diff.
6. **Lead with the highest-risk hunk** within this theme. Order diff sections so a reviewer who stops after section 2 still has the gist.

### whyMatters

The most important field. Don't describe — explain consequence. "What breaks if this is wrong" or "what guarantee this enforces."

### callouts (optional)

Skip nits. Use \`concern\` (worth discussing) or \`warning\` (likely bug) sparingly. The plan's top-level concerns are the primary surface; callouts are for line-level guidance specific to this theme.

## Diff conventions

Same as the planner pass: \`hunkIndex\` is per-file 0-based; \`startLine\`/\`endLine\` are 1-based on the new side and FOCUS the viewer on a slice; truncation markers are real.

## Output

Return ONLY valid JSON, no prose around it, matching this schema:
${CHAPTER_RESPONSE_SCHEMA}`;

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
  perFileCap: number,
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

  const cap = Math.min(perFileCap, lineBudget);
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

interface FormattedDiff {
  diffBlock: string;
  stats: PromptCapStats;
}

/** Format a list of files as a unified diff, respecting per-file and global caps. */
function formatDiffBlock(files: DiffFile[], perFileCap: number, globalCap: number): FormattedDiff {
  let lineBudget = globalCap;
  const truncatedFileDetails: { file: string; hunksDropped: number; linesDropped: number }[] = [];
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
    const formatted = formatFile(file, lineBudget, perFileCap);
    fileBlocks.push(formatted.text);
    lineBudget -= formatted.linesUsed;
    narratedLineCount += formatted.linesUsed;
    if (formatted.truncated) {
      truncatedFileDetails.push({
        file: file.file,
        hunksDropped: formatted.hunksDropped,
        linesDropped: formatted.linesDropped,
      });
    }
  }
  return {
    diffBlock: fileBlocks.length > 0 ? fileBlocks.join('\n') : '(no file changes)',
    stats: {
      perFileCap,
      globalCap,
      inputFileCount: files.length,
      inputLineCount,
      narratedFileCount: fileBlocks.length,
      narratedLineCount,
      truncatedFiles: truncatedFileDetails,
      droppedFiles,
    },
  };
}

function buildSharedHeader(input: NarrativePromptInput, risks: FileRisk[]): string[] {
  const { title, description, labels, fileTree } = input;
  const truncatedTree = fileTree.slice(0, FILE_TREE_LIMIT);
  const labelLine = labels.length > 0 ? labels.join(', ') : '(none)';
  const descriptionBlock = description.trim().length > 0 ? description : '(no description provided)';
  const treeBlock = truncatedTree.length > 0 ? truncatedTree.join('\n') : '(empty)';
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
  if (riskBlock) parts.push(riskBlock, '');
  return parts;
}

function appendCapInfo(parts: string[], stats: PromptCapStats, skippedFiles: string[] | undefined): void {
  if (skippedFiles && skippedFiles.length > 0) {
    parts.push(
      '',
      `Mechanical files omitted from the diff above (lockfiles, generated, minified — do not narrate, but mention briefly if relevant): ${skippedFiles.join(', ')}`,
    );
  }
  if (stats.truncatedFiles.length > 0) {
    parts.push(
      '',
      `Files truncated to fit prompt budget (later hunks omitted; the [FILE TRUNCATED: ...] marker shows what was cut): ${stats.truncatedFiles.map((t) => t.file).join(', ')}`,
    );
  }
  if (stats.droppedFiles.length > 0) {
    parts.push(
      '',
      `Files entirely omitted because the prompt budget was exhausted before reaching them. Mention them in your narrative without trying to describe specific changes: ${stats.droppedFiles.join(', ')}`,
    );
  }
}

function appendPreviousContext(parts: string[], previousContext: PreviousNarrativeContext | undefined): void {
  if (!previousContext?.previousTldr && !previousContext?.previousChapterTitles?.length) return;
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

/** Build the original single-pass narrative prompt — used by the small-PR short-circuit and as a fallback. */
export function buildNarrativePrompt(input: NarrativePromptInput): NarrativePrompt {
  const { files, skippedFiles, previousContext } = input;
  const risks = computeRisk(files);
  const { diffBlock, stats } = formatDiffBlock(files, MAX_LINES_PER_FILE, MAX_TOTAL_DIFF_LINES);

  const parts = buildSharedHeader(input, risks);
  parts.push('Unified diff:', diffBlock);
  appendCapInfo(parts, stats, skippedFiles);
  appendPreviousContext(parts, previousContext);

  return { system: SYSTEM_PROMPT, user: parts.join('\n'), stats, keptFiles: files, risks };
}

/** Build the planner prompt — used for the first pass of the two-pass pipeline. */
export function buildPlannerPrompt(input: NarrativePromptInput): NarrativePrompt {
  const { files, skippedFiles, previousContext, hints } = input;
  const risks = computeRisk(files);
  const { diffBlock, stats } = formatDiffBlock(files, MAX_LINES_PER_FILE, MAX_TOTAL_DIFF_LINES);

  const parts = buildSharedHeader(input, risks);
  const hintBlock = hints ? formatHintsBlock(hints) : '';
  if (hintBlock) parts.push(hintBlock, '');
  parts.push('Unified diff:', diffBlock);
  appendCapInfo(parts, stats, skippedFiles);
  appendPreviousContext(parts, previousContext);

  return { system: PLANNER_SYSTEM_PROMPT, user: parts.join('\n'), stats, keptFiles: files, risks };
}

export interface WriterPromptInput {
  plan: Plan;
  theme: PlanTheme;
  /** Full diff files (writer renders only the hunks referenced by theme.hunkRefs, preserving original hunkIndex). */
  files: DiffFile[];
  fullFileTree: string[];
}

function normalizePath(p: string): string {
  return p
    .trim()
    .replace(/^[ab]\//, '')
    .replace(/^\/+/, '');
}

/**
 * Render only the hunks referenced by `theme.hunkRefs`, preserving each
 * hunk's original per-file `hunkIndex` so the writer's output references
 * map cleanly back into the full DiffFile[].
 */
function formatThemeDiff(files: DiffFile[], theme: PlanTheme): string {
  const indexByFile = new Map<string, Set<number>>();
  for (const r of theme.hunkRefs) {
    const norm = normalizePath(r.file);
    let s = indexByFile.get(norm);
    if (!s) {
      s = new Set();
      indexByFile.set(norm, s);
    }
    s.add(r.hunkIndex);
  }

  const blocks: string[] = [];
  for (const file of files) {
    const norm = normalizePath(file.file);
    const indices = indexByFile.get(norm);
    if (!indices) continue;
    const sortedIndices = [...indices].sort((a, b) => a - b);

    const fromPath = file.isNewFile ? '/dev/null' : `a/${file.file}`;
    const toPath = file.isDeleted ? '/dev/null' : `b/${file.file}`;
    const fileMarkers = [file.isNewFile ? 'new file' : null, file.isDeleted ? 'deleted file' : null]
      .filter(Boolean)
      .join(' ');
    const meta = [`diff --git a/${file.file} b/${file.file}`];
    if (fileMarkers) meta.push(fileMarkers);
    meta.push(`--- ${fromPath}`, `+++ ${toPath}`);

    const hunkBlocks = sortedIndices
      .map((idx) => {
        const h = file.hunks[idx];
        return h ? formatHunk(h, idx) : null;
      })
      .filter((s): s is string => s !== null);

    blocks.push(`${meta.join('\n')}\n${hunkBlocks.join('\n')}`);
  }
  return blocks.join('\n');
}

/** Build the writer prompt for one theme — second pass of the two-pass pipeline. */
export function buildWriterPrompt(input: WriterPromptInput): NarrativePrompt {
  const { plan, theme, files, fullFileTree } = input;
  const risks = computeRisk(files);
  const diffBlock = formatThemeDiff(files, theme);

  const themeSiblings = plan.themes
    .map((t, i) => `${i + 1}. ${t.title}${t.id === theme.id ? ' (← this one)' : ''} — ${t.rationale}`)
    .join('\n');

  const parts = [
    `PR title: ${plan.prTitle}`,
    `PR tldr: ${plan.prTldr}`,
    `PR verdict: ${plan.prVerdict}`,
    '',
    `Plan themes (${plan.themes.length} total, in order):`,
    themeSiblings,
    '',
    '---',
    '',
    `THIS THEME (${theme.id})`,
    `Title: ${theme.title}`,
    `Rationale: ${theme.rationale}`,
    `Risk: ${theme.riskLevel}`,
    '',
    'Hunks for this theme (only reference these in your sections):',
    theme.hunkRefs.map((r) => `- ${r.file}#${r.hunkIndex}`).join('\n'),
    '',
    'Diff (only the hunks for this theme — original hunkIndex preserved):',
    diffBlock,
    '',
  ];

  if (fullFileTree.length > 0) {
    const tree = fullFileTree.slice(0, 50).join(', ');
    parts.push(`(Project file tree, first 50: ${tree})`, '');
  }

  if (theme.suppress) {
    parts.push(
      '',
      'NOTE: this theme is marked suppress. Produce a minimal chapter: 1-sentence summary, no callouts, no narrative sections beyond a single short note.',
    );
  }

  // Stats for the writer pass aren't strictly meaningful (we don't apply caps
  // to the small per-theme diff), but we return a placeholder so the
  // NarrativePrompt shape is consistent.
  const stats: PromptCapStats = {
    perFileCap: MAX_LINES_PER_FILE,
    globalCap: MAX_TOTAL_DIFF_LINES,
    inputFileCount: files.length,
    inputLineCount: 0,
    narratedFileCount: 0,
    narratedLineCount: 0,
    truncatedFiles: [],
    droppedFiles: [],
  };

  return { system: WRITER_SYSTEM_PROMPT, user: parts.join('\n'), stats, keptFiles: files, risks };
}
