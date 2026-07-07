import { describe, expect, it } from 'vitest';
import {
  aiEndpoint,
  buildRepoFacets,
  commentsEndpoint,
  groupByOwner,
  groupOf,
  groupUnits,
  parseRoute,
  relativeTime,
  repoOptions,
  reviewEndpoint,
  commentTarget,
  routePath,
  sourceBadge,
  summarizeChecks,
  summarizeReviews,
  verdictTone,
} from '../units-view';
import type { CheckRun, PRReview, Unit, UnitStatus } from '../../state/types';

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

  it('routes changes_requested to in-flight (the ball is back with the author)', () => {
    const inflight: UnitStatus[] = ['changes_requested'];
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
      mkUnit({ unitId: 'b', status: 'changes_requested' }),
      mkUnit({ unitId: 'c', status: 'approved' }),
      mkUnit({ unitId: 'd', status: 'changes_requested' }),
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
      mkUnit({ unitId: 'old', status: 'changes_requested', updatedAt: '2026-06-26T00:01:00.000Z' }),
      mkUnit({ unitId: 'new', status: 'changes_requested', updatedAt: '2026-06-26T00:09:00.000Z' }),
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

describe('buildRepoFacets', () => {
  it('counts needs-you per repo from the unfiltered list and totals them for "All"', () => {
    const units = [
      mkUnit({ repo: 'workos/authkit', status: 'queued' }),
      mkUnit({ repo: 'workos/authkit', status: 'queued' }),
      mkUnit({ repo: 'workos/authkit', status: 'changes_requested' }), // in-flight, not needs-you
      mkUnit({ repo: 'workos/node', status: 'queued' }),
      mkUnit({ repo: 'workos/node', status: 'approved' }), // cleared
    ];
    const f = buildRepoFacets(units);
    expect(f.needsYou).toBe(3);
    expect(f.busy.find((r) => r.repo === 'workos/authkit')).toMatchObject({
      owner: 'workos',
      shortName: 'authkit',
      needsYou: 2,
      total: 3,
    });
  });

  it('sorts busy repos busiest-first (needs-you desc, then name)', () => {
    const units = [
      mkUnit({ repo: 'o/a', status: 'queued' }),
      mkUnit({ repo: 'o/b', status: 'queued' }),
      mkUnit({ repo: 'o/b', status: 'queued' }),
    ];
    expect(buildRepoFacets(units).busy.map((r) => r.repo)).toEqual(['o/b', 'o/a']);
  });

  it('splits repos with zero needs-you into quiet (still reachable), keeping their total', () => {
    const units = [
      mkUnit({ repo: 'o/busy', status: 'queued' }),
      mkUnit({ repo: 'o/quiet', status: 'changes_requested' }),
      mkUnit({ repo: 'o/quiet', status: 'approved' }),
    ];
    const f = buildRepoFacets(units);
    expect(f.busy.map((r) => r.repo)).toEqual(['o/busy']);
    expect(f.quiet.map((r) => r.repo)).toEqual(['o/quiet']);
    expect(f.quiet[0]).toMatchObject({ needsYou: 0, total: 2 });
  });

  it('flags multiple owners so the sidebar can label groups', () => {
    expect(buildRepoFacets([mkUnit({ repo: 'a/one' }), mkUnit({ repo: 'a/two' })]).multipleOwners).toBe(false);
    expect(buildRepoFacets([mkUnit({ repo: 'a/one' }), mkUnit({ repo: 'b/two' })]).multipleOwners).toBe(true);
  });

  it('handles a repo with no owner segment', () => {
    expect(buildRepoFacets([mkUnit({ repo: 'localonly', status: 'queued' })]).busy[0]).toMatchObject({
      owner: '',
      shortName: 'localonly',
    });
  });
});

describe('groupByOwner', () => {
  it('groups an already-sorted facet list by owner, preserving the busiest-first order', () => {
    const busy = buildRepoFacets([
      mkUnit({ repo: 'workos/authkit', status: 'queued' }),
      mkUnit({ repo: 'workos/authkit', status: 'queued' }),
      mkUnit({ repo: 'vercel/next', status: 'queued' }),
      mkUnit({ repo: 'workos/node', status: 'queued' }),
    ]).busy;
    const groups = groupByOwner(busy);
    // workos/authkit(2) leads → workos section first; node folds up into that same section.
    expect(groups.map((g) => g.owner)).toEqual(['workos', 'vercel']);
    expect(groups[0]?.repos.map((r) => r.shortName)).toEqual(['authkit', 'node']);
    expect(groups[1]?.repos.map((r) => r.shortName)).toEqual(['next']);
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
  it('parses the settings route (with or without a trailing slash)', () => {
    expect(parseRoute('/settings')).toEqual({ name: 'settings' });
    expect(parseRoute('/settings/')).toEqual({ name: 'settings' });
  });
  it('falls back to center for an unknown path', () => {
    expect(parseRoute('/nope')).toEqual({ name: 'center' });
  });
  it('round-trips through routePath', () => {
    expect(routePath({ name: 'center' })).toBe('/');
    expect(routePath({ name: 'unit', unitId: 'u_123' })).toBe('/units/u_123');
    expect(routePath({ name: 'settings' })).toBe('/settings');
    expect(parseRoute(routePath({ name: 'unit', unitId: 'a/b' }))).toEqual({ name: 'unit', unitId: 'a/b' });
    expect(parseRoute(routePath({ name: 'settings' }))).toEqual({ name: 'settings' });
  });
});

describe('commentsEndpoint', () => {
  it('targets the unit-scoped endpoint when drilled into a unit in command-center mode', () => {
    expect(commentsEndpoint('command-center', { name: 'unit', unitId: 'u_1' })).toBe('/api/units/u_1/comments');
    expect(commentsEndpoint('command-center', { name: 'unit', unitId: 'a/b' })).toBe('/api/units/a%2Fb/comments');
  });
  it('falls back to the PR endpoint at the command center root (no open unit)', () => {
    expect(commentsEndpoint('command-center', { name: 'center' })).toBe('/api/comments');
  });
  it('uses the PR endpoint in pr mode', () => {
    expect(commentsEndpoint('pr', { name: 'center' })).toBe('/api/comments');
  });
});

describe('reviewEndpoint / aiEndpoint', () => {
  it('are unit-scoped in a command-center drill-in', () => {
    const route = { name: 'unit', unitId: 'u_1' } as const;
    expect(reviewEndpoint('command-center', route)).toBe('/api/units/u_1/review');
    expect(aiEndpoint('command-center', route)).toBe('/api/units/u_1/ai');
  });
  it('fall back to the PR endpoints elsewhere', () => {
    expect(reviewEndpoint('pr', { name: 'center' })).toBe('/api/review');
    expect(aiEndpoint('pr', { name: 'center' })).toBe('/api/ai');
    expect(reviewEndpoint('command-center', { name: 'center' })).toBe('/api/review');
  });
});

describe('commentTarget', () => {
  it('targets the GitHub PR on a github daemon unit', () => {
    const units = [mkUnit({ unitId: 'g1', source: 'github' })];
    expect(commentTarget('command-center', { name: 'unit', unitId: 'g1' }, units)).toBe('github');
  });
  it('falls back to the PR review flow in pr mode and at the center root', () => {
    expect(commentTarget('pr', { name: 'center' }, [])).toBe('review');
    expect(commentTarget('command-center', { name: 'center' }, [])).toBe('review');
    expect(commentTarget('command-center', { name: 'unit', unitId: 'missing' }, [])).toBe('review');
  });
});

describe('sourceBadge', () => {
  it('labels the github door so the queue is legible', () => {
    expect(sourceBadge('github')).toMatchObject({ label: 'GitHub', tone: 'github' });
  });
  it('defaults an unset source to the github door', () => {
    expect(sourceBadge(undefined)).toMatchObject({ label: 'GitHub', tone: 'github' });
  });
  it('carries a human title explaining where the unit came from', () => {
    expect(sourceBadge('github').title).toMatch(/github/i);
  });
});

function mkCheck(over: Partial<CheckRun>): CheckRun {
  return {
    id: over.id ?? 1,
    name: over.name ?? 'ci',
    status: over.status ?? 'completed',
    conclusion: over.conclusion ?? null,
    startedAt: null,
    completedAt: null,
    detailsUrl: null,
    output: {},
  };
}
function mkReview(over: Partial<PRReview>): PRReview {
  return {
    id: over.id ?? 1,
    user: over.user ?? 'a',
    avatarUrl: '',
    state: over.state ?? 'COMMENTED',
    submittedAt: over.submittedAt ?? '1',
  };
}

describe('summarizeChecks', () => {
  it('counts passed / failed / running, ignoring neutral & skipped', () => {
    const checks = [
      mkCheck({ status: 'completed', conclusion: 'success' }),
      mkCheck({ status: 'completed', conclusion: 'failure' }),
      mkCheck({ status: 'completed', conclusion: 'timed_out' }),
      mkCheck({ status: 'in_progress', conclusion: null }),
      mkCheck({ status: 'completed', conclusion: 'neutral' }),
      mkCheck({ status: 'completed', conclusion: 'skipped' }),
    ];
    expect(summarizeChecks(checks)).toEqual({ passed: 1, failed: 2, running: 1 });
  });
  it('is all-zero for no checks', () => {
    expect(summarizeChecks([])).toEqual({ passed: 0, failed: 0, running: 0 });
  });
});

describe('summarizeReviews', () => {
  it('counts each reviewer’s latest verdict', () => {
    const reviews = [
      mkReview({ user: 'a', state: 'COMMENTED', submittedAt: '1' }),
      mkReview({ user: 'a', state: 'APPROVED', submittedAt: '2' }),
      mkReview({ user: 'b', state: 'CHANGES_REQUESTED', submittedAt: '1' }),
      mkReview({ user: 'b', state: 'APPROVED', submittedAt: '3' }), // changed their mind
    ];
    expect(summarizeReviews(reviews)).toEqual({ approved: 2, changesRequested: 0 });
  });
  it('a dismissed review clears that reviewer', () => {
    const reviews = [
      mkReview({ user: 'a', state: 'CHANGES_REQUESTED', submittedAt: '1' }),
      mkReview({ user: 'a', state: 'DISMISSED', submittedAt: '2' }),
    ];
    expect(summarizeReviews(reviews)).toEqual({ approved: 0, changesRequested: 0 });
  });
});
