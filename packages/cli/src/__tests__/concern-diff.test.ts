import { describe, expect, it } from 'vitest';
import { diffConcerns } from '../narrative/concern-diff';
import type { NarrativeResponse, Concern, Callout } from '../narrative/types';

function mkNarrative(overrides: Partial<NarrativeResponse> = {}): NarrativeResponse {
  return {
    title: '',
    tldr: '',
    verdict: 'safe',
    readingPlan: [],
    concerns: [],
    chapters: [],
    ...overrides,
  };
}

function mkConcern(overrides: Partial<Concern> = {}): Concern {
  return {
    question: 'Is this safe?',
    file: 'src/foo.ts',
    line: 42,
    category: 'logic',
    why: 'because',
    ...overrides,
  };
}

function mkCallout(overrides: Partial<Callout> = {}): Callout {
  return {
    file: 'src/bar.ts',
    line: 10,
    level: 'warning',
    message: 'Watch out',
    ...overrides,
  };
}

describe('diffConcerns', () => {
  it('marks unchanged concerns as unfixed', () => {
    const concern = mkConcern();
    const prev = mkNarrative({ concerns: [concern] });
    const curr = mkNarrative({ concerns: [concern] });
    const delta = diffConcerns(prev, curr);
    expect(delta.concerns).toHaveLength(1);
    expect(delta.concerns[0]!.status).toBe('unfixed');
    expect(delta.summary.unfixed).toBe(1);
  });

  it('marks removed concerns as fixed', () => {
    const prev = mkNarrative({ concerns: [mkConcern()] });
    const curr = mkNarrative({ concerns: [] });
    const delta = diffConcerns(prev, curr);
    expect(delta.concerns).toHaveLength(1);
    expect(delta.concerns[0]!.status).toBe('fixed');
    expect(delta.summary.fixed).toBe(1);
  });

  it('marks added concerns as new', () => {
    const prev = mkNarrative({ concerns: [] });
    const curr = mkNarrative({ concerns: [mkConcern()] });
    const delta = diffConcerns(prev, curr);
    expect(delta.concerns).toHaveLength(1);
    expect(delta.concerns[0]!.status).toBe('new');
    expect(delta.summary.new).toBe(1);
  });

  it('fuzzy matches within ±3 lines', () => {
    const prev = mkNarrative({ concerns: [mkConcern({ line: 42 })] });
    const curr = mkNarrative({ concerns: [mkConcern({ line: 44 })] });
    const delta = diffConcerns(prev, curr);
    expect(delta.concerns).toHaveLength(1);
    expect(delta.concerns[0]!.status).toBe('unfixed');
  });

  it('does not fuzzy match beyond ±3 lines', () => {
    const prev = mkNarrative({ concerns: [mkConcern({ line: 42 })] });
    const curr = mkNarrative({ concerns: [mkConcern({ line: 47 })] });
    const delta = diffConcerns(prev, curr);
    expect(delta.concerns).toHaveLength(2);
    expect(delta.concerns.find((c) => c.status === 'fixed')).toBeDefined();
    expect(delta.concerns.find((c) => c.status === 'new')).toBeDefined();
  });

  it('requires exact category match', () => {
    const prev = mkNarrative({ concerns: [mkConcern({ category: 'logic' })] });
    const curr = mkNarrative({ concerns: [mkConcern({ category: 'validation' })] });
    const delta = diffConcerns(prev, curr);
    expect(delta.concerns).toHaveLength(2);
    expect(delta.concerns.find((c) => c.status === 'fixed')?.category).toBe('logic');
    expect(delta.concerns.find((c) => c.status === 'new')?.category).toBe('validation');
  });

  it('normalizes paths (strips a/ b/ prefixes)', () => {
    const prev = mkNarrative({ concerns: [mkConcern({ file: 'a/src/foo.ts' })] });
    const curr = mkNarrative({ concerns: [mkConcern({ file: 'src/foo.ts' })] });
    const delta = diffConcerns(prev, curr);
    expect(delta.concerns).toHaveLength(1);
    expect(delta.concerns[0]!.status).toBe('unfixed');
  });

  it('handles happy path: 5 prev, 3 unchanged + 2 new = 2 fixed, 3 unfixed, 2 new', () => {
    const prev = mkNarrative({
      concerns: [
        mkConcern({ file: 'a.ts', line: 10, category: 'logic' }),
        mkConcern({ file: 'b.ts', line: 20, category: 'state' }),
        mkConcern({ file: 'c.ts', line: 30, category: 'security' }),
        mkConcern({ file: 'd.ts', line: 40, category: 'validation' }),
        mkConcern({ file: 'e.ts', line: 50, category: 'timing' }),
      ],
    });
    const curr = mkNarrative({
      concerns: [
        mkConcern({ file: 'a.ts', line: 10, category: 'logic' }),
        mkConcern({ file: 'b.ts', line: 20, category: 'state' }),
        mkConcern({ file: 'c.ts', line: 30, category: 'security' }),
        mkConcern({ file: 'f.ts', line: 60, category: 'logic' }),
        mkConcern({ file: 'g.ts', line: 70, category: 'state' }),
      ],
    });
    const delta = diffConcerns(prev, curr);
    expect(delta.summary).toEqual({ fixed: 2, unfixed: 3, new: 2 });
  });

  it('handles empty previous narrative — all concerns are new', () => {
    const curr = mkNarrative({
      concerns: [mkConcern({ file: 'x.ts' }), mkConcern({ file: 'y.ts' })],
    });
    const delta = diffConcerns(mkNarrative(), curr);
    expect(delta.summary).toEqual({ fixed: 0, unfixed: 0, new: 2 });
  });

  it('handles empty current narrative — all concerns are fixed', () => {
    const prev = mkNarrative({
      concerns: [mkConcern({ file: 'x.ts' }), mkConcern({ file: 'y.ts' })],
    });
    const delta = diffConcerns(prev, mkNarrative());
    expect(delta.summary).toEqual({ fixed: 2, unfixed: 0, new: 0 });
  });

  it('consumed concerns cannot match twice', () => {
    const prev = mkNarrative({
      concerns: [mkConcern({ file: 'a.ts', line: 10, category: 'logic' })],
    });
    const curr = mkNarrative({
      concerns: [
        mkConcern({ file: 'a.ts', line: 10, category: 'logic' }),
        mkConcern({ file: 'a.ts', line: 11, category: 'logic' }),
      ],
    });
    const delta = diffConcerns(prev, curr);
    expect(delta.concerns.filter((c) => c.status === 'unfixed')).toHaveLength(1);
    expect(delta.concerns.filter((c) => c.status === 'new')).toHaveLength(1);
  });

  describe('callouts', () => {
    it('matches callouts per chapter', () => {
      const prev = mkNarrative({
        chapters: [{ title: 'Ch1', summary: '', whyMatters: '', risk: 'low', sections: [], callouts: [mkCallout()] }],
      });
      const curr = mkNarrative({
        chapters: [{ title: 'Ch1', summary: '', whyMatters: '', risk: 'low', sections: [], callouts: [mkCallout()] }],
      });
      const delta = diffConcerns(prev, curr);
      expect(delta.callouts).toHaveLength(1);
      expect(delta.callouts[0]!.status).toBe('unfixed');
    });

    it('treats same callout in different chapters as different', () => {
      const callout = mkCallout();
      const prev = mkNarrative({
        chapters: [
          { title: 'Ch1', summary: '', whyMatters: '', risk: 'low', sections: [], callouts: [callout] },
          { title: 'Ch2', summary: '', whyMatters: '', risk: 'low', sections: [], callouts: [] },
        ],
      });
      const curr = mkNarrative({
        chapters: [
          { title: 'Ch1', summary: '', whyMatters: '', risk: 'low', sections: [], callouts: [] },
          { title: 'Ch2', summary: '', whyMatters: '', risk: 'low', sections: [], callouts: [callout] },
        ],
      });
      const delta = diffConcerns(prev, curr);
      expect(delta.callouts.find((c) => c.status === 'fixed')).toBeDefined();
      expect(delta.callouts.find((c) => c.status === 'new')).toBeDefined();
    });

    it('fuzzy matches callout lines', () => {
      const prev = mkNarrative({
        chapters: [
          {
            title: 'Ch1',
            summary: '',
            whyMatters: '',
            risk: 'low',
            sections: [],
            callouts: [mkCallout({ line: 10 })],
          },
        ],
      });
      const curr = mkNarrative({
        chapters: [
          {
            title: 'Ch1',
            summary: '',
            whyMatters: '',
            risk: 'low',
            sections: [],
            callouts: [mkCallout({ line: 12 })],
          },
        ],
      });
      const delta = diffConcerns(prev, curr);
      expect(delta.callouts).toHaveLength(1);
      expect(delta.callouts[0]!.status).toBe('unfixed');
    });

    it('includes callouts in summary counts', () => {
      const prev = mkNarrative({
        chapters: [
          {
            title: 'Ch1',
            summary: '',
            whyMatters: '',
            risk: 'low',
            sections: [],
            callouts: [mkCallout({ line: 10 }), mkCallout({ line: 50, level: 'nit' })],
          },
        ],
      });
      const curr = mkNarrative({
        chapters: [
          {
            title: 'Ch1',
            summary: '',
            whyMatters: '',
            risk: 'low',
            sections: [],
            callouts: [mkCallout({ line: 10 })],
          },
        ],
      });
      const delta = diffConcerns(prev, curr);
      expect(delta.summary.fixed).toBe(1);
      expect(delta.summary.unfixed).toBe(1);
    });
  });
});
