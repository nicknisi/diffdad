import type { DiffFile, DiffHunk, PRComment } from '../github/types';

export type HunkHint = {
  file: string;
  hunkIndex: number;
  /** A reviewer has already commented on this hunk's range. */
  hasInlineComment?: boolean;
  /** File path looks like a test file. */
  isTestFile?: boolean;
  /** Hunk is "low information" — pure whitespace or imports-only. */
  isTrivial?: 'whitespace' | 'imports-only' | false;
};

function normalizePath(p: string): string {
  return p
    .trim()
    .replace(/^[ab]\//, '')
    .replace(/^\/+/, '');
}

const TEST_PATH_RE = /(^|\/)(__tests__|tests?|specs?)\//i;
const TEST_FILE_RE = /\.(test|spec)\.(t|j|m)?sx?$/i;

function isTestPath(path: string): boolean {
  return TEST_PATH_RE.test(path) || TEST_FILE_RE.test(path);
}

const IMPORT_LINE_RE = /^\s*(import|export)\s/;
const FROM_LINE_RE = /^[\s),}]+from\s+['"]/;
const STRING_LITERAL_LINE_RE = /^\s*['"][^'"]+['"];?\s*$/;
const TYPE_IMPORT_LINE_RE = /^\s*(type|interface)\s+\w+\s*=\s*import\(/;

function isImportLikely(s: string): boolean {
  return (
    IMPORT_LINE_RE.test(s) || FROM_LINE_RE.test(s) || STRING_LITERAL_LINE_RE.test(s) || TYPE_IMPORT_LINE_RE.test(s)
  );
}

/**
 * Classify a hunk as trivial when its semantic content is low: pure whitespace
 * shifts or import-only edits. Used as a planner hint, not a hard filter — the
 * planner can still narrate trivial hunks in a suppressed theme.
 */
export function classifyTrivial(hunk: DiffHunk): 'whitespace' | 'imports-only' | false {
  const changes = hunk.lines.filter((l) => l.type !== 'context');
  if (changes.length === 0) return false;
  if (changes.every((l) => l.content.trim() === '')) return 'whitespace';
  if (changes.every((l) => isImportLikely(l.content) || l.content.trim() === '')) return 'imports-only';
  return false;
}

/**
 * Compute non-LLM hints over the diff. Cheap, deterministic, and fed into the
 * planner prompt as signal — the planner is free to ignore them but they
 * meaningfully bias output (e.g. tests tend to cluster, trivial hunks land in
 * the suppressed bucket).
 */
export function computeHints(files: DiffFile[], comments: PRComment[] = []): HunkHint[] {
  const out: HunkHint[] = [];
  const commentsByPath = new Map<string, PRComment[]>();
  for (const c of comments) {
    if (!c.path) continue;
    const norm = normalizePath(c.path);
    let arr = commentsByPath.get(norm);
    if (!arr) {
      arr = [];
      commentsByPath.set(norm, arr);
    }
    arr.push(c);
  }

  for (const f of files) {
    const norm = normalizePath(f.file);
    const isTest = isTestPath(f.file);
    const fileComments = commentsByPath.get(norm) ?? [];
    f.hunks.forEach((h, idx) => {
      const newStart = h.newStart;
      const newEnd = newStart + Math.max(h.newCount - 1, 0);
      const hasInlineComment = fileComments.some((c) => c.line !== undefined && c.line >= newStart && c.line <= newEnd);
      const trivial = classifyTrivial(h);
      const hint: HunkHint = { file: f.file, hunkIndex: idx };
      if (hasInlineComment) hint.hasInlineComment = true;
      if (isTest) hint.isTestFile = true;
      if (trivial) hint.isTrivial = trivial;
      out.push(hint);
    });
  }
  return out;
}

/**
 * Format a hints[] array as a planner-prompt block. Returns an empty string if
 * no hint is interesting enough to mention.
 */
export function formatHintsBlock(hints: HunkHint[]): string {
  const interesting = hints.filter((h) => h.hasInlineComment || h.isTestFile || h.isTrivial);
  if (interesting.length === 0) return '';
  const lines = [
    'Hunk hints (planner signals; not constraints):',
    '  - hot-zone: hunk has an inline comment from a reviewer — likely a contested area.',
    '  - test: hunk is in a test file — usually clusters with the production change it covers.',
    '  - trivial=whitespace|imports-only: low-information hunk — strong candidate for the suppressed mechanical bucket.',
    '',
  ];
  for (const h of interesting) {
    const tags: string[] = [];
    if (h.hasInlineComment) tags.push('hot-zone');
    if (h.isTestFile) tags.push('test');
    if (h.isTrivial) tags.push(`trivial=${h.isTrivial}`);
    lines.push(`  ${h.file}#${h.hunkIndex}: ${tags.join(', ')}`);
  }
  return lines.join('\n');
}
