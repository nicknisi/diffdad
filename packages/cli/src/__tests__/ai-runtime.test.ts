import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startHeartbeat } from '../narrative/ai-runtime';

describe('startHeartbeat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete process.env.DIFFDAD_HEARTBEAT_DISABLED;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('logs to stderr after 30s of silence', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const hb = startHeartbeat('Model is thinking');

    vi.advanceTimersByTime(25_000);
    expect(stderrSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10_000);
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(stderrSpy.mock.calls[0]![0]).toContain('30s since last output');

    hb.stop();
    stderrSpy.mockRestore();
  });

  it('logs again at 60s of continued silence', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const hb = startHeartbeat('Model is thinking');

    vi.advanceTimersByTime(35_000);
    expect(stderrSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(30_000);
    expect(stderrSpy).toHaveBeenCalledTimes(2);
    expect(stderrSpy.mock.calls[1]![0]).toContain('60s since last output');

    hb.stop();
    stderrSpy.mockRestore();
  });

  it('resets when tick() is called before 30s', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const hb = startHeartbeat('Model is thinking');

    vi.advanceTimersByTime(25_000);
    hb.tick();
    vi.advanceTimersByTime(25_000);
    expect(stderrSpy).not.toHaveBeenCalled();

    hb.stop();
    stderrSpy.mockRestore();
  });

  it('clears interval on stop()', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const hb = startHeartbeat('Model is thinking');

    hb.stop();
    vi.advanceTimersByTime(60_000);
    expect(stderrSpy).not.toHaveBeenCalled();

    stderrSpy.mockRestore();
  });

  it('returns no-op when DIFFDAD_HEARTBEAT_DISABLED is set', () => {
    process.env.DIFFDAD_HEARTBEAT_DISABLED = '1';
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const hb = startHeartbeat('Model is thinking');

    vi.advanceTimersByTime(120_000);
    expect(stderrSpy).not.toHaveBeenCalled();

    hb.stop();
    stderrSpy.mockRestore();
  });
});
