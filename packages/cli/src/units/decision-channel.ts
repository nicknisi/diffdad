import type { Decision } from './types';

/**
 * The live rendezvous for a unit's decision. The decision route calls `deliver` after persisting
 * via the store; `await_decision` parks on `wait`. Persistence-first: the decision also lives on
 * the unit, so a timed-out or disconnected agent simply re-calls `await_decision` and reads it
 * from the store — the channel only short-circuits the wait when both sides are connected at once.
 * (Phase 4's auto-clear reuses this same channel.)
 */
export class DecisionChannel {
  private waiters = new Map<string, Set<(d: Decision) => void>>();

  /** Park until a decision is delivered for `unitId`, or resolve `null` after `timeoutMs`. */
  wait(unitId: string, timeoutMs: number): Promise<Decision | null> {
    return new Promise((resolve) => {
      const set = this.waiters.get(unitId) ?? new Set<(d: Decision) => void>();
      this.waiters.set(unitId, set);

      let settled = false;
      const finish = (d: Decision | null) => {
        if (settled) return;
        settled = true;
        set.delete(cb);
        if (set.size === 0) this.waiters.delete(unitId);
        clearTimeout(timer);
        resolve(d);
      };
      const cb = (d: Decision) => finish(d);
      set.add(cb);

      const timer = setTimeout(() => finish(null), timeoutMs);
      // Don't let a parked waiter keep the process (or a test runner) alive on its own.
      (timer as { unref?: () => void }).unref?.();
    });
  }

  /** Wake every current waiter for `unitId` with the decision. No-op if none are parked. */
  deliver(unitId: string, decision: Decision): void {
    const set = this.waiters.get(unitId);
    if (!set) return;
    // Snapshot first: each callback deletes itself from `set` as it settles.
    for (const cb of Array.from(set)) cb(decision);
  }
}
