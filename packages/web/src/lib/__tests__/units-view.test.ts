import { describe, expect, it } from 'vitest';
import {
  groupOf,
  groupUnits,
  parseRoute,
  recommendedAction,
  relativeTime,
  repoOptions,
  routePath,
  verdictTone,
} from '../units-view';
import type { Unit, UnitStatus } from '../../state/types';

function mkUnit(over: Partial<Unit> = {}): Unit {
  return {
    unitId: over.unitId ?? 'u1',
    repo: over.repo ?? 'workos/authkit',
    taskLabel: over.taskLabel ?? 'wire SAML callback',
    intent: over.intent ?? 'intent',
    status: over.status ?? 'queued',
    toResolve: over.toResolve ?? 0,
    verdict: over.verdict,
    error: over.error,
    createdAt: over.createdAt ?? '2026-06-26T00:00:00.000Z',
    updatedAt: over.updatedAt ?? '2026-06-26T00:00:00.000Z',
    ...over,
  };
}

describe('groupOf', () => {
  it('routes queued to needs-you (the actionable queue)', () => {
    expect(groupOf('queued')).toBe('needs-you');
  });

  it('routes work-in-motion statuses to in-flight', () => {
    const inflight: UnitStatus[] = ['submitted', 'reviewing', 'addressing', 'changes_requested'];
    for (const s of inflight) expect(groupOf(s)).toBe('in-flight');
  });

  it('routes resolved statuses to cleared', () => {
    expect(groupOf('approved')).toBe('cleared');
    expect(groupOf('done')).toBe('cleared');
  });
});

describe('groupUnits', () => {
  it('partitions units into the three command-center groups', () => {
    const units = [
      mkUnit({ unitId: 'a', status: 'queued' }),
      mkUnit({ unitId: 'b', status: 'reviewing' }),
      mkUnit({ unitId: 'c', status: 'approved' }),
      mkUnit({ unitId: 'd', status: 'submitted' }),
    ];
    const g = groupUnits(units);
    expect(g.needsYou.map((u) => u.unitId)).toEqual(['a']);
    expect(g.inFlight.map((u) => u.unitId).sort()).toEqual(['b', 'd']);
    expect(g.cleared.map((u) => u.unitId)).toEqual(['c']);
  });

  it('orders needs-you by risk first, then longest-waiting (oldest update) within a risk', () => {
    const units = [
      mkUnit({ unitId: 'safe-new', status: 'queued', verdict: 'safe', updatedAt: '2026-06-26T00:05:00.000Z' }),
      mkUnit({ unitId: 'risky-new', status: 'queued', verdict: 'risky', updatedAt: '2026-06-26T00:05:00.000Z' }),
      mkUnit({ unitId: 'risky-old', status: 'queued', verdict: 'risky', updatedAt: '2026-06-26T00:01:00.000Z' }),
    ];
    expect(groupUnits(units).needsYou.map((u) => u.unitId)).toEqual(['risky-old', 'risky-new', 'safe-new']);
  });

  it('orders in-flight and cleared by most-recent activity first', () => {
    const units = [
      mkUnit({ unitId: 'old', status: 'reviewing', updatedAt: '2026-06-26T00:01:00.000Z' }),
      mkUnit({ unitId: 'new', status: 'reviewing', updatedAt: '2026-06-26T00:09:00.000Z' }),
    ];
    expect(groupUnits(units).inFlight.map((u) => u.unitId)).toEqual(['new', 'old']);
  });
});

describe('verdictTone', () => {
  it('maps the three verdicts to rail tones, defaulting unknown to neutral', () => {
    expect(verdictTone('risky')).toBe('risk');
    expect(verdictTone('caution')).toBe('warn');
    expect(verdictTone('safe')).toBe('safe');
    expect(verdictTone(undefined)).toBe('neutral');
  });
});

describe('recommendedAction', () => {
  it('flags a failed review for attention regardless of verdict', () => {
    const a = recommendedAction(mkUnit({ error: 'pipeline blew up', verdict: 'safe' }));
    expect(a.primary).toBe('review');
    expect(a.tone).toBe('risk');
    expect(a.label.toLowerCase()).toContain('fail');
  });

  it('recommends resolving when there are open concerns, surfacing the count', () => {
    const a = recommendedAction(mkUnit({ toResolve: 3, verdict: 'caution' }));
    expect(a.primary).toBe('review');
    expect(a.label).toContain('3');
  });

  it('recommends a one-click approve only when safe with nothing to resolve', () => {
    const a = recommendedAction(mkUnit({ toResolve: 0, verdict: 'safe' }));
    expect(a.primary).toBe('approve');
    expect(a.tone).toBe('safe');
  });

  it('recommends review for a risky verdict even with nothing to resolve', () => {
    const a = recommendedAction(mkUnit({ toResolve: 0, verdict: 'risky' }));
    expect(a.primary).toBe('review');
    expect(a.tone).toBe('risk');
  });
});

describe('repoOptions', () => {
  it('returns the distinct repos, sorted, for the filter', () => {
    const units = [
      mkUnit({ repo: 'workos/node' }),
      mkUnit({ repo: 'workos/authkit' }),
      mkUnit({ repo: 'workos/node' }),
    ];
    expect(repoOptions(units)).toEqual(['workos/authkit', 'workos/node']);
  });
});

describe('relativeTime', () => {
  const base = Date.parse('2026-06-26T12:00:00.000Z');
  it('reads recent timestamps as "just now"', () => {
    expect(relativeTime('2026-06-26T11:59:30.000Z', base)).toBe('just now');
  });
  it('counts minutes, hours, then days', () => {
    expect(relativeTime('2026-06-26T11:55:00.000Z', base)).toBe('5m');
    expect(relativeTime('2026-06-26T09:00:00.000Z', base)).toBe('3h');
    expect(relativeTime('2026-06-24T12:00:00.000Z', base)).toBe('2d');
  });
  it('returns an empty string for an unparseable timestamp rather than NaN', () => {
    expect(relativeTime('not-a-date', base)).toBe('');
  });
});

describe('parseRoute / routePath', () => {
  it('parses the command-center root', () => {
    expect(parseRoute('/')).toEqual({ name: 'center' });
    expect(parseRoute('')).toEqual({ name: 'center' });
  });
  it('parses a per-unit route, decoding the id', () => {
    expect(parseRoute('/units/u_123')).toEqual({ name: 'unit', unitId: 'u_123' });
    expect(parseRoute('/units/u_123/')).toEqual({ name: 'unit', unitId: 'u_123' });
    expect(parseRoute('/units/a%2Fb')).toEqual({ name: 'unit', unitId: 'a/b' });
  });
  it('round-trips through routePath', () => {
    expect(routePath({ name: 'center' })).toBe('/');
    expect(routePath({ name: 'unit', unitId: 'u_123' })).toBe('/units/u_123');
    expect(parseRoute(routePath({ name: 'unit', unitId: 'a/b' }))).toEqual({ name: 'unit', unitId: 'a/b' });
  });
});
