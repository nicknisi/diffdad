import { describe, expect, it } from 'vitest';
import { DecisionChannel } from '../decision-channel';
import type { Decision } from '../types';

const APPROVED: Decision = { kind: 'approved' };

describe('DecisionChannel', () => {
  it('resolves a parked waiter when a decision is delivered', async () => {
    const ch = new DecisionChannel();
    const p = ch.wait('u1', 1000);
    ch.deliver('u1', APPROVED);
    expect(await p).toEqual(APPROVED);
  });

  it('resolves null on timeout when no decision arrives', async () => {
    const ch = new DecisionChannel();
    expect(await ch.wait('u1', 10)).toBeNull();
  });

  it('only wakes waiters for the matching unit', async () => {
    const ch = new DecisionChannel();
    const p1 = ch.wait('u1', 20);
    const p2 = ch.wait('u2', 1000);
    ch.deliver('u2', APPROVED);
    expect(await p2).toEqual(APPROVED);
    expect(await p1).toBeNull(); // u1 never received u2's decision; it times out
  });

  it('wakes multiple waiters on the same unit', async () => {
    const ch = new DecisionChannel();
    const a = ch.wait('u1', 1000);
    const b = ch.wait('u1', 1000);
    ch.deliver('u1', APPROVED);
    expect([await a, await b]).toEqual([APPROVED, APPROVED]);
  });

  it('delivering to a unit with no waiters is a no-op (decision lives on the unit anyway)', () => {
    const ch = new DecisionChannel();
    expect(() => ch.deliver('nobody', APPROVED)).not.toThrow();
  });
});
