import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPoller } from '../daemon/daemon';

// startPoller returns a stop handle and fires an immediate first tick, then one per interval. The
// handle is what makes a live re-wire possible — stop the old loop before starting a new cadence,
// so two poll loops never overlap.
describe('startPoller handle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // The fake poll increments synchronously on each call, so tick counts are deterministic under
  // fake timers (the immediate tick calls poll() before its first await).
  function counter() {
    let n = 0;
    return {
      poll: () => {
        n++;
        return Promise.resolve();
      },
      count: () => n,
    };
  }

  it('ticks immediately, then once per interval', () => {
    const { poll, count } = counter();
    const handle = startPoller(poll, 60_000);
    expect(count()).toBe(1); // immediate first pass
    vi.advanceTimersByTime(120_000);
    expect(count()).toBe(3); // +2 interval ticks
    handle.stop();
  });

  it('stop() halts the interval and is idempotent', () => {
    const { poll, count } = counter();
    const handle = startPoller(poll, 60_000);
    vi.advanceTimersByTime(60_000);
    expect(count()).toBe(2);
    handle.stop();
    handle.stop(); // safe to call twice
    vi.advanceTimersByTime(600_000);
    expect(count()).toBe(2); // no ticks after stop
  });

  it('a fresh handle restarts at the new cadence independently of a stopped one', () => {
    const { poll, count } = counter();
    const first = startPoller(poll, 60_000); // tick 1
    first.stop();
    const second = startPoller(poll, 30_000); // tick 2 (immediate)
    expect(count()).toBe(2);
    vi.advanceTimersByTime(60_000);
    expect(count()).toBe(4); // +2 at the 30s cadence; the stopped 60s loop contributes nothing
    second.stop();
  });

  it('a throwing poll never escapes the tick (logged, loop continues)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      let n = 0;
      const handle = startPoller(() => {
        n++;
        return Promise.reject(new Error('github search failed'));
      }, 60_000);
      vi.advanceTimersByTime(120_000);
      expect(n).toBe(3); // still ticking despite each pass rejecting
      handle.stop();
    } finally {
      warn.mockRestore();
    }
  });
});
