import { describe, expect, it } from 'vitest';
import {
  collectTargets,
  compileFindQuery,
  findInNarrative,
  matchTargets,
  wrapIndex,
} from '../find';
import type { Chapter, DiffFile, DiffLine, NarrativeResponse, Section } from '../../state/types';

// --- fixtures -------------------------------------------------------------

function line(content: string): DiffLine {
  return { type: 'context', content, lineNumber: {} };
}

function mkFile(file: string, contents: string[]): DiffFile {
  return {
    file,
    isNewFile: false,
    isDeleted: false,
    hunks: [
      {
        header: '@@ -1,1 +1,1 @@',
        oldStart: 1,
        oldCount: contents.length,
        newStart: 1,
        newCount: contents.length,
        lines: contents.map(line),
      },
    ],
  };
}

function prose(content: string): Section {
  return { type: 'narrative', content };
}

function diff(file: string, hunkIndex = 0): Section {
  return { type: 'diff', file, startLine: 1, endLine: 10, hunkIndex };
}

function mkChapter(o: Partial<Chapter> = {}): Chapter {
  return { title: 'Chapter', summary: '', whyMatters: '', risk: 'low', sections: [], ...o };
}

function mkNarrative(chapters: Chapter[]): NarrativeResponse {
  return { title: 't', tldr: 'td', verdict: 'safe', readingPlan: [], concerns: [], chapters };
}

const OPTS = { matchCase: false, wholeWord: false, regex: false };

// --- compileFindQuery -----------------------------------------------------

describe('compileFindQuery', () => {
  it('escapes plain-text queries so metacharacters are literal', () => {
    const compiled = compileFindQuery('a.b', OPTS);
    expect('expression' in compiled).toBe(true);
    if ('expression' in compiled) {
      expect('axb'.match(compiled.expression)).toBeNull();
      expect('a.b'.match(compiled.expression)).not.toBeNull();
    }
  });

  it('is case-insensitive by default and case-sensitive with matchCase', () => {
    const insensitive = compileFindQuery('foo', OPTS);
    const sensitive = compileFindQuery('foo', { ...OPTS, matchCase: true });
    if ('expression' in insensitive) expect('FOO'.match(insensitive.expression)).not.toBeNull();
    if ('expression' in sensitive) expect('FOO'.match(sensitive.expression)).toBeNull();
  });

  it('wraps in word boundaries for wholeWord', () => {
    const compiled = compileFindQuery('cat', { ...OPTS, wholeWord: true });
    if ('expression' in compiled) {
      expect('the cat sat'.match(compiled.expression)).not.toBeNull();
      expect('category'.match(compiled.expression)).toBeNull();
    }
  });

  it('treats the query as a pattern under regex', () => {
    const compiled = compileFindQuery('a.b', { ...OPTS, regex: true });
    if ('expression' in compiled) expect('axb'.match(compiled.expression)).not.toBeNull();
  });

  it('returns an error for an invalid regex', () => {
    const compiled = compileFindQuery('(unclosed', { ...OPTS, regex: true });
    expect('error' in compiled).toBe(true);
  });
});

// --- collectTargets (document order) --------------------------------------

describe('collectTargets', () => {
  it('collects title, summary, whyMatters, sections and callouts in render order', () => {
    const narrative = mkNarrative([
      mkChapter({
        title: 'Title A',
        summary: 'Summary A',
        whyMatters: 'Why A',
        sections: [prose('Prose A'), diff('src/a.ts')],
        callouts: [{ file: 'src/a.ts', line: 1, level: 'nit', message: 'Callout A' }],
      }),
    ]);
    const files = [mkFile('src/a.ts', ['line one', 'line two'])];
    const targets = collectTargets(narrative, files);
    expect(targets.map((t) => t.field)).toEqual([
      'title',
      'summary',
      'whyMatters',
      'narrative',
      'diff',
      'diff',
      'callout',
    ]);
    expect(targets.map((t) => t.text)).toEqual([
      'Title A',
      'Summary A',
      'Why A',
      'Prose A',
      'line one',
      'line two',
      'Callout A',
    ]);
    // order is a strictly increasing document rank
    expect(targets.map((t) => t.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('spans multiple chapters in order, including a later chapter that is collapsed in the UI', () => {
    const narrative = mkNarrative([
      mkChapter({ title: 'First', sections: [diff('src/a.ts')] }),
      mkChapter({ title: 'Second', sections: [diff('src/b.ts')] }),
    ]);
    const files = [mkFile('src/a.ts', ['needle in a']), mkFile('src/b.ts', ['needle in b'])];
    // The store has no notion of collapse for search — the data drives it, so a match in the second
    // chapter is found regardless of any UI collapse.
    const { matches } = findInNarrative(narrative, files, 'needle', OPTS);
    expect(matches.map((m) => m.chid)).toEqual(['ch-0', 'ch-1']);
    expect(matches[0]!.order).toBeLessThan(matches[1]!.order);
  });

  it('skips diff sections whose file/hunk is missing from files', () => {
    const narrative = mkNarrative([mkChapter({ sections: [diff('src/missing.ts')] })]);
    const targets = collectTargets(narrative, []);
    expect(targets.filter((t) => t.field === 'diff')).toHaveLength(0);
  });

  it('returns nothing for a null narrative', () => {
    expect(collectTargets(null, [])).toEqual([]);
  });
});

// --- matchTargets / findInNarrative ---------------------------------------

describe('findInNarrative', () => {
  const narrative = mkNarrative([
    mkChapter({ title: 'Cat chapter', summary: 'a cat and a category', sections: [diff('src/a.ts')] }),
  ]);
  const files = [mkFile('src/a.ts', ['CAT scan', 'concatenate'])];

  it('finds matches across prose and diff content in document order', () => {
    const { matches } = findInNarrative(narrative, files, 'cat', OPTS);
    // title(1) + summary(2: "cat", "category") + diff line 1 "CAT" + diff line 2 "concat"
    expect(matches).toHaveLength(5);
    expect(matches.map((m) => m.field)).toEqual(['title', 'summary', 'summary', 'diff', 'diff']);
  });

  it('honors matchCase', () => {
    const { matches } = findInNarrative(narrative, files, 'CAT', { ...OPTS, matchCase: true });
    // only the diff line "CAT scan"
    expect(matches).toHaveLength(1);
    expect(matches[0]!.field).toBe('diff');
    expect(matches[0]!.text).toBe('CAT');
  });

  it('honors wholeWord', () => {
    const { matches } = findInNarrative(narrative, files, 'cat', { ...OPTS, wholeWord: true });
    // "Cat chapter" title, "a cat" in summary, "CAT scan" diff — not "category"/"concatenate"
    expect(matches).toHaveLength(3);
  });

  it('supports regex queries', () => {
    const { matches } = findInNarrative(narrative, files, 'c.t', { ...OPTS, regex: true });
    expect(matches.length).toBeGreaterThan(0);
  });

  it('reports an invalid regex and yields no matches', () => {
    const { matches, error } = findInNarrative(narrative, files, '(', { ...OPTS, regex: true });
    expect(matches).toHaveLength(0);
    expect(error).toBeTruthy();
  });

  it('returns no matches and no error for an empty query', () => {
    expect(findInNarrative(narrative, files, '', OPTS)).toEqual({ matches: [], error: null });
  });

  it('does not spin on a zero-length regex match', () => {
    const { matches } = findInNarrative(narrative, files, 'x*', { ...OPTS, regex: true });
    // zero-length matches are skipped, so nothing is collected for an all-optional pattern
    expect(matches).toHaveLength(0);
  });
});

describe('matchTargets records offsets', () => {
  it('reports start/end within the target text', () => {
    const targets = collectTargets(mkNarrative([mkChapter({ summary: 'find me here' })]), []);
    const compiled = compileFindQuery('me', OPTS);
    if (!('expression' in compiled)) throw new Error('expected valid regex');
    const matches = matchTargets(targets, compiled.expression);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.start).toBe(5);
    expect(matches[0]!.end).toBe(7);
  });
});

// --- wrapIndex (navigation wrap-around) -----------------------------------

describe('wrapIndex', () => {
  it('wraps forward past the end to the start', () => {
    expect(wrapIndex(3, 3)).toBe(0);
    expect(wrapIndex(4, 3)).toBe(1);
  });

  it('wraps backward before the start to the end', () => {
    expect(wrapIndex(-1, 3)).toBe(2);
    expect(wrapIndex(-2, 3)).toBe(1);
  });

  it('returns -1 for an empty match set', () => {
    expect(wrapIndex(0, 0)).toBe(-1);
  });
});
