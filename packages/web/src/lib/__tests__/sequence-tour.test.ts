import { describe, expect, it } from 'vitest';
import { clampStep, currentMessage, nextStep, prevStep } from '../sequence-tour';
import type { SequenceMessage } from '../../state/types';

function msg(label: string): SequenceMessage {
  return { from: 'A', to: 'B', label };
}

describe('sequence-tour', () => {
  it('clamps into range and handles empty lists', () => {
    expect(clampStep(-3, 4)).toBe(0);
    expect(clampStep(9, 4)).toBe(3);
    expect(clampStep(2, 4)).toBe(2);
    expect(clampStep(1, 0)).toBe(0);
  });

  it('advances without wrapping past the last step', () => {
    expect(nextStep({ index: 0 }, 3)).toEqual({ index: 1 });
    expect(nextStep({ index: 2 }, 3)).toEqual({ index: 2 }); // saturates
  });

  it('steps back without wrapping past the first step', () => {
    expect(prevStep({ index: 2 }, 3)).toEqual({ index: 1 });
    expect(prevStep({ index: 0 }, 3)).toEqual({ index: 0 }); // saturates
  });

  it('resolves the current message and returns null when empty', () => {
    const messages = [msg('one'), msg('two'), msg('three')];
    expect(currentMessage(messages, { index: 1 })?.label).toBe('two');
    expect(currentMessage(messages, { index: 99 })?.label).toBe('three'); // clamped
    expect(currentMessage([], { index: 0 })).toBeNull();
  });
});
