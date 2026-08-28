/**
 * Pure search logic for the find-in-review widget.
 *
 * The widget searches the narrative DATA, not the rendered DOM, so a match inside a collapsed chapter
 * is found (and can then trigger an expand) rather than missed the way browser Ctrl-F misses it. Every
 * function here is a plain data transform with no DOM access, so the matching rules — case, whole word,
 * regex, document order across chapters — are testable as functions.
 */
import { normalizePath } from './paths';
import type { DiffFile, NarrativeResponse } from '../state/types';

export type FindOptions = {
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
};

/** Which slice of a chapter a target's text came from — kept for debugging/tests, not shown to users. */
export type FindField = 'title' | 'summary' | 'whyMatters' | 'narrative' | 'diff' | 'callstack' | 'callout';

/**
 * A single searchable string plus where it lives. `chapterIndex` / `chid` are what navigation needs to
 * expand the right chapter and scroll to it; `order` is the document-order rank assigned as targets are
 * collected top-to-bottom, so matches come out already ordered.
 */
export type FindTarget = {
  chapterIndex: number;
  chid: string;
  field: FindField;
  text: string;
  order: number;
};

export type FindMatch = {
  chapterIndex: number;
  chid: string;
  field: FindField;
  /** The matched text (what the DOM highlighter looks for inside the chapter element). */
  text: string;
  /** Char offset of the match within `target.text`. */
  start: number;
  end: number;
  order: number;
};

/** A compiled query, or a message describing why the regex is invalid (widget shows an inert error). */
export type CompiledQuery = { expression: RegExp } | { error: string };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the global regex for a query. Non-regex queries are escaped; `wholeWord` wraps the source in
 * `\b...\b`. An invalid regex returns `{ error }` so the caller can render a subtle error state and run
 * no search rather than throw.
 */
export function compileFindQuery(query: string, opts: FindOptions): CompiledQuery {
  const source = opts.regex ? query : escapeRegExp(query);
  const bounded = opts.wholeWord ? `\\b(?:${source})\\b` : source;
  try {
    return { expression: new RegExp(bounded, opts.matchCase ? 'gu' : 'giu') };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** All non-overlapping matches of `expression` in `text`, guarding against zero-length-match spins. */
export function regexMatches(text: string, expression: RegExp): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  expression.lastIndex = 0;
  for (;;) {
    const m = expression.exec(text);
    if (!m) break;
    if (m[0].length === 0) {
      expression.lastIndex += 1;
      continue;
    }
    out.push({ start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/**
 * Every searchable string in the narrative, in the order it renders: per chapter — title, summary,
 * whyMatters, then each section (narrative prose, or every diff line's content) in section order, then
 * callouts. Diff line text is pulled from `files` by matching the section's file + hunk index, which is
 * what lets a match land inside a chapter whose diff is currently collapsed.
 */
export function collectTargets(narrative: NarrativeResponse | null, files: DiffFile[]): FindTarget[] {
  const targets: FindTarget[] = [];
  if (!narrative) return targets;
  let order = 0;
  const push = (chapterIndex: number, chid: string, field: FindField, text: string) => {
    if (text && text.length > 0) targets.push({ chapterIndex, chid, field, text, order: order++ });
  };

  narrative.chapters.forEach((ch, idx) => {
    const chid = `ch-${idx}`;
    push(idx, chid, 'title', ch.title ?? '');
    push(idx, chid, 'summary', ch.summary ?? '');
    push(idx, chid, 'whyMatters', ch.whyMatters ?? '');
    for (const section of ch.sections) {
      if (section.type === 'narrative') {
        push(idx, chid, 'narrative', section.content ?? '');
      } else if (section.type === 'callstack') {
        push(idx, chid, 'callstack', section.title ?? '');
        for (const frame of section.frames) push(idx, chid, 'callstack', frame.label ?? '');
      } else if (section.type === 'diff') {
        const norm = normalizePath(section.file);
        const diffFile = files.find((f) => normalizePath(f.file) === norm);
        const hunk = diffFile?.hunks[section.hunkIndex];
        if (!hunk) continue;
        for (const line of hunk.lines) push(idx, chid, 'diff', line.content ?? '');
      }
    }
    for (const callout of ch.callouts ?? []) push(idx, chid, 'callout', callout.message ?? '');
  });

  return targets;
}

/** Run a compiled regex over every target, yielding matches in document order. */
export function matchTargets(targets: FindTarget[], expression: RegExp): FindMatch[] {
  const matches: FindMatch[] = [];
  for (const target of targets) {
    for (const { start, end } of regexMatches(target.text, expression)) {
      matches.push({
        chapterIndex: target.chapterIndex,
        chid: target.chid,
        field: target.field,
        text: target.text.slice(start, end),
        start,
        end,
        order: target.order,
      });
    }
  }
  return matches;
}

/**
 * One-shot search: compile the query, collect targets, return ordered matches. An empty query yields no
 * matches with no error; an invalid regex yields no matches with the error message.
 */
export function findInNarrative(
  narrative: NarrativeResponse | null,
  files: DiffFile[],
  query: string,
  opts: FindOptions,
): { matches: FindMatch[]; error: string | null } {
  if (!query) return { matches: [], error: null };
  const compiled = compileFindQuery(query, opts);
  if ('error' in compiled) return { matches: [], error: compiled.error };
  const targets = collectTargets(narrative, files);
  return { matches: matchTargets(targets, compiled.expression), error: null };
}

/** Wrap an index into `[0, length)`, so next-from-last lands on 0 and prev-from-0 lands on last. */
export function wrapIndex(index: number, length: number): number {
  if (length <= 0) return -1;
  return ((index % length) + length) % length;
}
