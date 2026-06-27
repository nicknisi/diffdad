import type { NarrativeResponse } from '../narrative/types';
import type { Broadcast } from '../mcp/tools';
import type { UnitStore } from '../units/store';
import type { ReviewUnit } from '../units/types';

/** What a single unit's review produces: the Phase-1 narrative + the count of concerns to resolve. */
export type ReviewResult = { narrative: NarrativeResponse; toResolve: number };

/** Runs Phase 1's narrative pipeline for one unit. Injected so the pool is testable without an LLM. */
export type ReviewFn = (unit: ReviewUnit) => Promise<ReviewResult>;

export type ReviewWorkerPoolOptions = {
  store: UnitStore;
  review: ReviewFn;
  broadcast: Broadcast;
  /** Max reviews in flight at once. Excess units stay `submitted`, picked up as slots free. */
  concurrency?: number;
};

const DEFAULT_CONCURRENCY = 3;

/**
 * Bounded pool that drains the review queue. `kick()` fills free slots from units awaiting review
 * (`submitted`, plus any `reviewing` left over from a crashed run) and is called again whenever a
 * unit is submitted or a slot frees. A review that throws still queues the unit (with an error), so
 * it always reaches the reviewer rather than getting stuck mid-flight.
 *
 * Single-threaded by Bun's event loop: `kick()` claims into `inFlight` synchronously before any
 * `await`, so the same unit can never be double-claimed even while `setReviewing` is in flight.
 */
export class ReviewWorkerPool {
  private readonly store: UnitStore;
  private readonly review: ReviewFn;
  private readonly broadcast: Broadcast;
  private readonly concurrency: number;
  private readonly inFlight = new Set<string>();

  constructor(opts: ReviewWorkerPoolOptions) {
    this.store = opts.store;
    this.review = opts.review;
    this.broadcast = opts.broadcast;
    this.concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;
  }

  /** Number of reviews currently running. */
  get active(): number {
    return this.inFlight.size;
  }

  /** Fill free slots from the pending queue. Safe to call repeatedly; a no-op when full or drained. */
  kick(): void {
    while (this.inFlight.size < this.concurrency) {
      const next = this.store
        .list()
        .find((u) => (u.status === 'submitted' || u.status === 'reviewing') && !this.inFlight.has(u.unitId));
      if (!next) break;
      this.inFlight.add(next.unitId); // claim synchronously, before any await
      void this.run(next.unitId);
    }
  }

  private async run(unitId: string): Promise<void> {
    try {
      const unit = this.store.get(unitId);
      if (!unit) return;
      // A crash-recovered unit is already `reviewing`; a fresh one is `submitted` and needs the edge.
      if (unit.status === 'submitted') await this.store.setReviewing(unitId);
      this.broadcast('units', { units: this.store.list() });

      const { narrative, toResolve } = await this.review(this.store.get(unitId)!);
      await this.store.setQueued(unitId, narrative, toResolve);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // The unit must still surface to the reviewer. setReviewFailed only applies from `reviewing`;
      // if claiming itself failed (status moved on), leave it be.
      try {
        if (this.store.get(unitId)?.status === 'reviewing') await this.store.setReviewFailed(unitId, msg);
      } catch {
        // illegal transition — the store already logged any persistence issue
      }
    } finally {
      this.inFlight.delete(unitId);
      this.broadcast('units', { units: this.store.list() });
      this.kick(); // a slot just freed
    }
  }
}
