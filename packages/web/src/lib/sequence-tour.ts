/**
 * Pure stepper logic for the sequence-diagram guided tour. Kept DOM-free so the next/prev/clamp and
 * current-message rules are unit-testable in isolation from the SVG renderer and its keyboard wiring.
 */
import type { SequenceMessage } from '../state/types';

export type TourState = { index: number };

/** Clamp a step index into `[0, count)`. An empty message list clamps to 0. */
export function clampStep(index: number, count: number): number {
  if (count <= 0) return 0;
  if (index < 0) return 0;
  if (index >= count) return count - 1;
  return index;
}

/** Advance one step, saturating at the last message (no wraparound). */
export function nextStep(state: TourState, count: number): TourState {
  return { index: clampStep(state.index + 1, count) };
}

/** Step back one, saturating at the first message (no wraparound). */
export function prevStep(state: TourState, count: number): TourState {
  return { index: clampStep(state.index - 1, count) };
}

/** The message the tour currently points at, or null when there are none. */
export function currentMessage(messages: SequenceMessage[], state: TourState): SequenceMessage | null {
  if (messages.length === 0) return null;
  return messages[clampStep(state.index, messages.length)] ?? null;
}
