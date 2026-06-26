import type { Unit, UnitStatus } from '../state/types';

/**
 * The command center's three lanes. Status grouping is primary (repo is a filter, per the
 * contract): `needs-you` is the actionable queue — review done, your call — while `in-flight`
 * is work still in motion (the agent or the review worker owns it) and `cleared` is the digest.
 */
export type UnitGroupKey = 'needs-you' | 'in-flight' | 'cleared';

export function groupOf(status: UnitStatus): UnitGroupKey {
  switch (status) {
    case 'queued':
      return 'needs-you';
    case 'approved':
    case 'done':
      return 'cleared';
    // submitted | reviewing | addressing | changes_requested — the ball is with the agent/worker.
    default:
      return 'in-flight';
  }
}

/** Rail tone vocabulary, shared with the walkthrough rail. `neutral` = no verdict yet. */
export type VerdictTone = 'risk' | 'warn' | 'safe' | 'neutral';

export function verdictTone(verdict: Unit['verdict']): VerdictTone {
  return verdict === 'risky' ? 'risk' : verdict === 'caution' ? 'warn' : verdict === 'safe' ? 'safe' : 'neutral';
}

const VERDICT_RANK: Record<VerdictTone, number> = { risk: 3, warn: 2, safe: 1, neutral: 0 };

function updatedAtMs(u: Unit): number {
  const t = Date.parse(u.updatedAt);
  return Number.isNaN(t) ? 0 : t;
}

export type GroupedUnits = { needsYou: Unit[]; inFlight: Unit[]; cleared: Unit[] };

/**
 * Partition + order units for display. needs-you leads with the riskiest, and within a risk the
 * longest-waiting first — the queue should pull Nick back to stale, high-stakes work. in-flight
 * and cleared show most-recent activity first.
 */
export function groupUnits(units: Unit[]): GroupedUnits {
  const needsYou: Unit[] = [];
  const inFlight: Unit[] = [];
  const cleared: Unit[] = [];
  for (const u of units) {
    const g = groupOf(u.status);
    if (g === 'needs-you') needsYou.push(u);
    else if (g === 'cleared') cleared.push(u);
    else inFlight.push(u);
  }
  needsYou.sort((a, b) => {
    const rank = VERDICT_RANK[verdictTone(b.verdict)] - VERDICT_RANK[verdictTone(a.verdict)];
    return rank !== 0 ? rank : updatedAtMs(a) - updatedAtMs(b); // oldest (longest-waiting) first
  });
  const recentFirst = (a: Unit, b: Unit) => updatedAtMs(b) - updatedAtMs(a);
  inFlight.sort(recentFirst);
  cleared.sort(recentFirst);
  return { needsYou, inFlight, cleared };
}

/** The verdict + to-resolve count distilled into the one move Nick should make on a unit. */
export type RecommendedAction = {
  primary: 'review' | 'approve';
  label: string;
  tone: VerdictTone;
};

export function recommendedAction(unit: Unit): RecommendedAction {
  if (unit.error) return { primary: 'review', label: 'Review (failed)', tone: 'risk' };
  const tone = verdictTone(unit.verdict);
  if (unit.toResolve > 0) {
    return {
      primary: 'review',
      label: `Review · ${unit.toResolve} to resolve`,
      tone: tone === 'neutral' ? 'warn' : tone,
    };
  }
  if (unit.verdict === 'safe') return { primary: 'approve', label: 'Approve', tone: 'safe' };
  return { primary: 'review', label: 'Review', tone };
}

/** Distinct repos across the queue, sorted — the repo filter's option list. */
export function repoOptions(units: Unit[]): string[] {
  return [...new Set(units.map((u) => u.repo))].sort();
}

/** Compact elapsed label ("just now" / "5m" / "3h" / "2d"). Empty string for an unparseable date. */
export function relativeTime(iso: string, nowMs: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const secs = Math.max(0, Math.round((nowMs - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// --- Client-side routing (the daemon serves index.html for any path, so deep links work) ------

export type Route = { name: 'center' } | { name: 'unit'; unitId: string };

export function parseRoute(pathname: string): Route {
  const trimmed = pathname.replace(/\/+$/, ''); // drop trailing slashes
  const match = trimmed.match(/^\/units\/(.+)$/);
  if (match) return { name: 'unit', unitId: decodeURIComponent(match[1]!) };
  return { name: 'center' };
}

export function routePath(route: Route): string {
  return route.name === 'unit' ? `/units/${encodeURIComponent(route.unitId)}` : '/';
}
