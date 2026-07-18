import { describe, expect, it } from 'vitest';
import { buildWalkthrough } from '../walkthrough';
import type { Chapter, Concern, DiffFile, NarrativeResponse, Section } from '../../state/types';

// --- fixtures -------------------------------------------------------------

function mkFile(file: string, hunkCount = 1): DiffFile {
  return {
    file,
    isNewFile: false,
    isDeleted: false,
    hunks: Array.from({ length: hunkCount }, (_, i) => ({
      header: `@@ -${i * 10 + 1},5 +${i * 10 + 1},6 @@`,
      oldStart: i * 10 + 1,
      oldCount: 5,
      newStart: i * 10 + 1,
      newCount: 6,
      lines: [],
    })),
  };
}

function mkChapter(o: Partial<Chapter> = {}): Chapter {
  return { title: 'Chapter', summary: 'summary', whyMatters: 'why', risk: 'low', sections: [], ...o };
}

function prose(content: string): Section {
  return { type: 'narrative', content };
}

function diff(file: string, hunkIndex: number, startLine = 1, endLine = 10): Section {
  return { type: 'diff', file, startLine, endLine, hunkIndex };
}

function mkConcern(o: Partial<Concern> = {}): Concern {
  return { question: 'is this ok?', file: 'src/a.ts', line: 3, category: 'logic', why: 'because', ...o };
}

function mkNarrative(chapters: Chapter[], concerns: Concern[] = []): NarrativeResponse {
  return { title: 't', tldr: 'td', verdict: 'safe', readingPlan: [], concerns, chapters };
}

// --- tests ----------------------------------------------------------------

describe('buildWalkthrough', () => {
  describe('beats from chapters', () => {
    it('maps each chapter to a beat, preserving plan order', () => {
      const narrative = mkNarrative([mkChapter({ title: 'First' }), mkChapter({ title: 'Second' })]);
      const model = buildWalkthrough(narrative, []);
      expect(model.beats.map((b) => b.title)).toEqual(['First', 'Second']);
      expect(model.beats.map((b) => b.chapterIndex)).toEqual([0, 1]);
      const first = model.beats[0]!;
      expect(first.id).toBe('ch-0');
      expect(first.status).toBe('unread');
      expect(first.whyMatters).toBe('why');
    });

    it('interleaves prose and resolvable diff sections in source order', () => {
      const files = [mkFile('src/a.ts', 2)];
      const narrative = mkNarrative([
        mkChapter({ sections: [prose('intro'), diff('src/a.ts', 0), prose('mid'), diff('src/a.ts', 1)] }),
      ]);
      const beat = buildWalkthrough(narrative, files).beats[0]!;
      expect(beat.sections).toEqual([
        { kind: 'prose', text: 'intro' },
        { kind: 'diff', file: 'src/a.ts', hunkIndex: 0 },
        { kind: 'prose', text: 'mid' },
        { kind: 'diff', file: 'src/a.ts', hunkIndex: 1 },
      ]);
    });

    it('drops a diff section whose hunk no longer resolves, keeping the beat and its prose', () => {
      const files = [mkFile('src/a.ts', 1)]; // only hunkIndex 0 exists
      const narrative = mkNarrative([mkChapter({ title: 'Renamed', sections: [prose('intro'), diff('src/a.ts', 5)] })]);
      const beat = buildWalkthrough(narrative, files).beats[0]!;
      expect(beat.sections).toEqual([{ kind: 'prose', text: 'intro' }]);
      expect(beat.title).toBe('Renamed');
    });
  });

  describe('risk flags — "Risk + questions" policy', () => {
    it('flags high→risk, medium→warn, low→none when there are no concerns', () => {
      const narrative = mkNarrative([
        mkChapter({ title: 'hi', risk: 'high' }),
        mkChapter({ title: 'med', risk: 'medium' }),
        mkChapter({ title: 'lo', risk: 'low' }),
      ]);
      expect(buildWalkthrough(narrative, []).beats.map((b) => b.risk)).toEqual(['risk', 'warn', 'none']);
    });

    it('lights up a low-risk chapter that has an open concern as info', () => {
      const files = [mkFile('src/a.ts', 1)];
      const narrative = mkNarrative(
        [mkChapter({ risk: 'low', sections: [diff('src/a.ts', 0)] })],
        [mkConcern({ file: 'src/a.ts', line: 3 })],
      );
      expect(buildWalkthrough(narrative, files).beats[0]!.risk).toBe('info');
    });

    it('keeps the higher of chapter risk and concern severity', () => {
      const files = [mkFile('src/a.ts', 1)];
      const narrative = mkNarrative(
        [mkChapter({ risk: 'high', sections: [diff('src/a.ts', 0)] })],
        [mkConcern({ file: 'src/a.ts', line: 3 })],
      );
      expect(buildWalkthrough(narrative, files).beats[0]!.risk).toBe('risk');
    });
  });

  describe('concerns → resolve items', () => {
    it('has no resolve items and toResolve 0 when there are no concerns', () => {
      const model = buildWalkthrough(mkNarrative([mkChapter({ risk: 'high' })]), []);
      expect(model.toResolve).toBe(0);
      expect(model.beats[0]!.resolve).toEqual([]);
    });

    it('folds a concern into its owning beat as an open resolve item', () => {
      const files = [mkFile('src/a.ts', 1)];
      const narrative = mkNarrative(
        [mkChapter({ risk: 'medium', sections: [diff('src/a.ts', 0)] })],
        [mkConcern({ question: 'why mutate here?', file: 'src/a.ts', line: 5 })],
      );
      const model = buildWalkthrough(narrative, files);
      expect(model.toResolve).toBe(1);
      const item = model.beats[0]!.resolve[0]!;
      expect(item.question).toBe('why mutate here?');
      expect(item.status).toBe('open');
      expect(item.severity).toBe('warn'); // medium chapter
      expect(item.file).toBe('src/a.ts');
      expect(item.line).toBe(5);
      expect(item.beatId).toBe('ch-0');
      expect(item.chapterIndex).toBe(0);
    });

    it('normalizes git-style path prefixes so comment posting targets repo-relative paths', () => {
      const files = [mkFile('src/a.ts', 1)];
      const narrative = mkNarrative(
        [mkChapter({ sections: [diff('src/a.ts', 0)] })],
        [mkConcern({ file: 'a/src/a.ts' })],
      );
      const item = buildWalkthrough(narrative, files).beats[0]!.resolve[0]!;
      expect(item.file).toBe('src/a.ts'); // GitHub rejects the raw `a/`-prefixed planner path
    });

    it('counts many concerns across beats in toResolve', () => {
      const files = [mkFile('src/a.ts', 1), mkFile('src/b.ts', 1)];
      const narrative = mkNarrative(
        [
          mkChapter({ risk: 'low', sections: [diff('src/a.ts', 0)] }),
          mkChapter({ risk: 'low', sections: [diff('src/b.ts', 0)] }),
        ],
        [
          mkConcern({ file: 'src/a.ts', line: 2 }),
          mkConcern({ file: 'src/b.ts', line: 4 }),
          mkConcern({ file: 'src/b.ts', line: 6 }),
        ],
      );
      const model = buildWalkthrough(narrative, files);
      expect(model.toResolve).toBe(3);
      expect(model.beats[0]!.resolve).toHaveLength(1);
      expect(model.beats[1]!.resolve).toHaveLength(2);
    });
  });

  describe('orphaned concerns', () => {
    it('attaches a concern whose file matches no chapter to a trailing "Other" beat', () => {
      const files = [mkFile('src/a.ts', 1)];
      const narrative = mkNarrative(
        [mkChapter({ risk: 'low', sections: [diff('src/a.ts', 0)] })],
        [mkConcern({ file: 'src/ghost.ts', line: 9, question: 'where did this go?' })],
      );
      const model = buildWalkthrough(narrative, files);
      expect(model.beats).toHaveLength(2); // chapter beat + trailing Other beat
      const other = model.beats[1]!;
      expect(other.id).toBe('other');
      expect(other.chapterIndex).toBe(-1);
      expect(other.resolve).toHaveLength(1);
      const item = other.resolve[0]!;
      expect(item.question).toBe('where did this go?');
      expect(item.severity).toBe('info'); // no owning chapter → default info
      expect(other.risk).toBe('info');
      expect(model.toResolve).toBe(1); // orphans are never invisible — still counted
    });

    it('does not add an Other beat when every concern has an owner', () => {
      const files = [mkFile('src/a.ts', 1)];
      const narrative = mkNarrative(
        [mkChapter({ risk: 'low', sections: [diff('src/a.ts', 0)] })],
        [mkConcern({ file: 'src/a.ts', line: 2 })],
      );
      const model = buildWalkthrough(narrative, files);
      expect(model.beats).toHaveLength(1);
      expect(model.beats.some((b) => b.id === 'other')).toBe(false);
    });
  });

  describe('mid-stream resilience', () => {
    it('never throws when a streamed chapter has no sections and the narrative has no concerns', () => {
      // Mid-stream payloads arrive with array fields absent — the builder must not crash the tree.
      const narrative = {
        title: 't',
        tldr: '',
        verdict: 'safe',
        readingPlan: [],
        chapters: [{ title: 'Partial', summary: '', whyMatters: '', risk: 'low' }],
      } as unknown as NarrativeResponse;
      expect(() => buildWalkthrough(narrative, [])).not.toThrow();
      const model = buildWalkthrough(narrative, []);
      expect(model.beats).toHaveLength(1);
      expect(model.beats[0]!.sections).toEqual([]);
      expect(model.toResolve).toBe(0);
    });
  });
});
