import { describe, expect, it } from 'vitest';
import {
  agentCommentsEndpoint,
  agentPresence,
  aiEndpoint,
  commentGoesToAgent,
  commentsEndpoint,
  groupOf,
  groupUnits,
  parseRoute,
  recommendedAction,
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

describe('commentsEndpoint', () => {
  it('targets the unit-scoped endpoint when drilled into a unit in command-center mode', () => {
    expect(commentsEndpoint('command-center', { name: 'unit', unitId: 'u_1' })).toBe('/api/units/u_1/comments');
    expect(commentsEndpoint('command-center', { name: 'unit', unitId: 'a/b' })).toBe('/api/units/a%2Fb/comments');
  });
  it('falls back to the PR endpoint at the command center root (no open unit)', () => {
    expect(commentsEndpoint('command-center', { name: 'center' })).toBe('/api/comments');
  });
  it('uses the PR endpoint in pr and watch modes', () => {
    expect(commentsEndpoint('pr', { name: 'center' })).toBe('/api/comments');
    expect(commentsEndpoint('watch', { name: 'unit', unitId: 'u_1' })).toBe('/api/comments');
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

describe('agentCommentsEndpoint', () => {
  it('targets the unit-scoped endpoint in a command-center drill-in', () => {
    expect(agentCommentsEndpoint('command-center', { name: 'unit', unitId: 'u_1' })).toBe(
      '/api/units/u_1/agent-comments',
    );
  });
  it('falls back to the single-mailbox endpoint in watch mode and at the center root', () => {
    expect(agentCommentsEndpoint('watch', { name: 'center' })).toBe('/api/agent-comments');
    expect(agentCommentsEndpoint('command-center', { name: 'center' })).toBe('/api/agent-comments');
  });
});

describe('commentTarget', () => {
  it('sends to the agent loop in watch mode and on local daemon units', () => {
    expect(commentTarget('watch', { name: 'center' }, [])).toBe('agent');
    const units = [mkUnit({ unitId: 'u1', source: 'cli' }), mkUnit({ unitId: 'u2', source: 'agent' })];
    expect(commentTarget('command-center', { name: 'unit', unitId: 'u1' }, units)).toBe('agent');
    expect(commentTarget('command-center', { name: 'unit', unitId: 'u2' }, units)).toBe('agent');
  });
  it('targets the GitHub PR on a github daemon unit (the relabel case)', () => {
    const units = [mkUnit({ unitId: 'g1', source: 'github' })];
    expect(commentTarget('command-center', { name: 'unit', unitId: 'g1' }, units)).toBe('github');
  });
  it('falls back to the PR review flow in pr mode and at the center root', () => {
    expect(commentTarget('pr', { name: 'center' }, [])).toBe('review');
    expect(commentTarget('command-center', { name: 'center' }, [])).toBe('review');
    expect(commentTarget('command-center', { name: 'unit', unitId: 'missing' }, [])).toBe('review');
  });
});

describe('commentGoesToAgent', () => {
  it('always routes to the agent loop in watch mode', () => {
    expect(commentGoesToAgent('watch', { name: 'center' }, [])).toBe(true);
  });
  it('routes to GitHub in pr mode', () => {
    expect(commentGoesToAgent('pr', { name: 'center' }, [])).toBe(false);
  });
  it('routes a LOCAL daemon unit (agent/cli) to the agent loop', () => {
    const units = [mkUnit({ unitId: 'u1', source: 'cli' }), mkUnit({ unitId: 'u2', source: 'agent' })];
    expect(commentGoesToAgent('command-center', { name: 'unit', unitId: 'u1' }, units)).toBe(true);
    expect(commentGoesToAgent('command-center', { name: 'unit', unitId: 'u2' }, units)).toBe(true);
  });
  it('routes a GITHUB daemon unit to GitHub (it has a real PR)', () => {
    const units = [mkUnit({ unitId: 'g1', source: 'github' })];
    expect(commentGoesToAgent('command-center', { name: 'unit', unitId: 'g1' }, units)).toBe(false);
  });
  it('routes to GitHub at the center root or for an unknown unit', () => {
    expect(commentGoesToAgent('command-center', { name: 'center' }, [])).toBe(false);
    expect(commentGoesToAgent('command-center', { name: 'unit', unitId: 'missing' }, [])).toBe(false);
  });
});

describe('sourceBadge', () => {
  it('labels each ingestion door distinctly so the queue is legible', () => {
    expect(sourceBadge('agent')).toMatchObject({ label: 'agent', tone: 'agent' });
    expect(sourceBadge('cli')).toMatchObject({ label: 'local', tone: 'local' });
    expect(sourceBadge('github')).toMatchObject({ label: 'GitHub', tone: 'github' });
  });
  it('defaults an unset source to the agent door (matches server back-compat)', () => {
    expect(sourceBadge(undefined)).toMatchObject({ label: 'agent', tone: 'agent' });
  });
  it('carries a human title explaining where the unit came from', () => {
    expect(sourceBadge('github').title).toMatch(/github/i);
    expect(sourceBadge('cli').title).toMatch(/dad add/i);
  });
});

describe('agentPresence', () => {
  const now = Date.parse('2026-06-26T12:00:00.000Z');
  it('reads as disconnected when an agent has never been seen', () => {
    expect(agentPresence(null, now)).toEqual({ connected: false, label: 'no agent connected' });
    expect(agentPresence(undefined, now)).toEqual({ connected: false, label: 'no agent connected' });
  });
  it('reads as connected when the agent checked in within the freshness window', () => {
    expect(agentPresence(now - 60_000, now)).toEqual({ connected: true, label: 'agent connected' });
  });
  it('goes stale (disconnected) once the last check-in is past the window', () => {
    expect(agentPresence(now - 10 * 60_000, now)).toEqual({ connected: false, label: 'no agent connected' });
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
