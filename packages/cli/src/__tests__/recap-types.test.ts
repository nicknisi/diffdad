import { describe, expect, it } from 'vitest';
import { normalizeRecap } from '../recap/types';

describe('normalizeRecap', () => {
  it('fills missing fields with safe defaults', () => {
    const out = normalizeRecap({});
    expect(out.goal).toBe('');
    expect(out.stateOfPlay).toEqual({ done: [], wip: [], notStarted: [] });
    expect(out.decisions).toEqual([]);
    expect(out.blockers).toEqual([]);
    expect(out.mentalModel).toEqual({ coreFiles: [], touchpoints: [], sketch: '' });
    expect(out.howToHelp).toEqual([]);
  });

  it('survives null/undefined input', () => {
    expect(normalizeRecap(null).goal).toBe('');
    expect(normalizeRecap(undefined).goal).toBe('');
  });

  it('preserves valid shaped input', () => {
    const input = {
      goal: 'Ship feature X',
      stateOfPlay: {
        done: ['parser', 'tests'],
        wip: ['UI'],
        notStarted: ['docs'],
      },
      decisions: [
        {
          decision: 'Use Hono',
          reason: 'small footprint',
          source: { type: 'commit', ref: 'abc123' },
          alternativesRuledOut: ['Express'],
        },
      ],
      blockers: [{ issue: 'CI red', evidence: 'lint failed', type: 'ci' }],
      mentalModel: {
        coreFiles: ['src/x.ts'],
        touchpoints: ['src/index.ts'],
        sketch: 'A -> B -> C',
      },
      howToHelp: [{ suggestion: 'Run lint', why: 'CI is red' }],
    };
    const out = normalizeRecap(input);
    expect(out.goal).toBe('Ship feature X');
    expect(out.decisions).toHaveLength(1);
    expect(out.decisions[0]?.source.type).toBe('commit');
    expect(out.decisions[0]?.alternativesRuledOut).toEqual(['Express']);
    expect(out.blockers).toHaveLength(1);
    expect(out.blockers[0]?.type).toBe('ci');
    expect(out.howToHelp[0]?.suggestion).toBe('Run lint');
  });

  it('drops decisions with no decision string and clamps unknown source types', () => {
    const out = normalizeRecap({
      decisions: [
        { decision: '', reason: 'r', source: { type: 'commit', ref: 'a' } },
        { decision: 'good', reason: 'r', source: { type: 'WAT', ref: 'a' } },
      ],
    });
    expect(out.decisions).toHaveLength(1);
    expect(out.decisions[0]?.decision).toBe('good');
    expect(out.decisions[0]?.source.type).toBe('commit'); // unknown -> default
  });

  it('drops blockers with no issue and clamps unknown blocker types', () => {
    const out = normalizeRecap({
      blockers: [
        { issue: '', evidence: 'e', type: 'ci' },
        { issue: 'x', evidence: 'e', type: 'WAT' },
      ],
    });
    expect(out.blockers).toHaveLength(1);
    expect(out.blockers[0]?.type).toBe('todo'); // unknown -> default
  });

  it('drops howToHelp entries missing a suggestion', () => {
    const out = normalizeRecap({
      howToHelp: [
        { suggestion: '', why: 'w' },
        { suggestion: 'do it', why: 'because' },
      ],
    });
    expect(out.howToHelp).toHaveLength(1);
    expect(out.howToHelp[0]?.suggestion).toBe('do it');
  });

  it('filters non-string entries from string arrays', () => {
    const out = normalizeRecap({
      stateOfPlay: { done: ['ok', 1, null, 'two'], wip: 'not-an-array', notStarted: undefined },
      mentalModel: { coreFiles: ['a', 2, 'b'] },
    });
    expect(out.stateOfPlay.done).toEqual(['ok', 'two']);
    expect(out.stateOfPlay.wip).toEqual([]);
    expect(out.stateOfPlay.notStarted).toEqual([]);
    expect(out.mentalModel.coreFiles).toEqual(['a', 'b']);
  });
});
