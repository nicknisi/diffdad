import type { CheckRun, PRReview, Unit, UnitStatus } from '../state/types';

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

/**
 * The visible "where did this unit come from" badge. The three ingestion doors read very
 * differently — an `agent` unit has a parked agent that pulls comments, a `cli` unit is a local
 * `dad add` diff, a `github` unit mirrors a real PR and comments post to GitHub — so making the
 * door legible is what gates the affordances (see {@link commentGoesToAgent}). An unset source
 * defaults to `agent`, matching the store's server-side back-compat default.
 */
export type SourceBadge = { label: string; title: string; tone: 'agent' | 'local' | 'github' };

export function sourceBadge(source: Unit['source']): SourceBadge {
  switch (source) {
    case 'github':
      return {
        label: 'GitHub',
        title: 'Pulled from a GitHub review request — comments post to the PR',
        tone: 'github',
      };
    case 'cli':
      return { label: 'local', title: 'Added locally via dad add', tone: 'local' };
    default:
      return { label: 'agent', title: 'Submitted by an agent via submit_for_review', tone: 'agent' };
  }
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

/**
 * Which API endpoint a review action should hit. In the daemon's command center, an open unit
 * drill-in talks to that unit's GitHub PR (`/api/units/:id/<resource>`); everywhere else (PR mode,
 * watch mode, the center root) it's the single-PR `/api/<resource>`. Pure so the surface routing is
 * unit-tested without rendering a hook.
 */
function resourceEndpoint(mode: 'pr' | 'watch' | 'command-center', route: Route, resource: string): string {
  if (mode === 'command-center' && route.name === 'unit') {
    return `/api/units/${encodeURIComponent(route.unitId)}/${resource}`;
  }
  return `/api/${resource}`;
}

/** Comments endpoint for `useComments`. (Watch mode's agent-comment path is handled in the hook.) */
export const commentsEndpoint = (mode: 'pr' | 'watch' | 'command-center', route: Route): string =>
  resourceEndpoint(mode, route, 'comments');

/** Review-submission endpoint for the submit bar/dialog. */
export const reviewEndpoint = (mode: 'pr' | 'watch' | 'command-center', route: Route): string =>
  resourceEndpoint(mode, route, 'review');

/** AI endpoint (summary draft, ask) for the submit dialog and ask-Dad features. */
export const aiEndpoint = (mode: 'pr' | 'watch' | 'command-center', route: Route): string =>
  resourceEndpoint(mode, route, 'ai');

/**
 * Agent-comment ("send to agent") endpoint. Per-unit in a command-center drill-in (each unit has its
 * own parked agent + mailbox); the single global mailbox in watch mode and at the center root.
 */
export const agentCommentsEndpoint = (mode: 'pr' | 'watch' | 'command-center', route: Route): string =>
  resourceEndpoint(mode, route, 'agent-comments');

/**
 * Where an inline comment on the current surface actually lands — the one fact that gates the
 * composer's copy and affordances:
 *   - `agent`  → the per-unit agent loop (watch mode; a local agent/cli daemon unit with a parked agent)
 *   - `github` → a real GitHub PR comment (a daemon `github` unit — the relabel "Comment on PR" case)
 *   - `review` → the standalone PR-review batch flow (pr mode, or the center root with no open unit)
 * Pure, so the routing is unit-tested without rendering a hook.
 */
export type CommentTarget = 'agent' | 'github' | 'review';

export function commentTarget(mode: 'pr' | 'watch' | 'command-center', route: Route, units: Unit[]): CommentTarget {
  if (mode === 'watch') return 'agent';
  if (mode === 'command-center' && route.name === 'unit') {
    const unit = units.find((u) => u.unitId === route.unitId);
    if (!unit) return 'review';
    return unit.source === 'github' ? 'github' : 'agent';
  }
  return 'review';
}

/**
 * Does an inline comment on the current surface go to the agent loop (vs a GitHub PR comment)? Thin
 * wrapper over {@link commentTarget} so callers that only need the agent/not-agent split stay simple.
 */
export function commentGoesToAgent(mode: 'pr' | 'watch' | 'command-center', route: Route, units: Unit[]): boolean {
  return commentTarget(mode, route, units) === 'agent';
}

// --- CI checks + reviews rollups (the drill-in's merge-readiness strip) ------------------------

const FAILED_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'cancelled',
  'action_required',
  'startup_failure',
  'stale',
]);

/** Roll up CI check runs into passed / failed / running counts. Neutral & skipped count as neither. */
export function summarizeChecks(checks: CheckRun[]): { passed: number; failed: number; running: number } {
  let passed = 0;
  let failed = 0;
  let running = 0;
  for (const c of checks) {
    if (c.status !== 'completed') running++;
    else if (c.conclusion === 'success') passed++;
    else if (c.conclusion && FAILED_CONCLUSIONS.has(c.conclusion)) failed++;
  }
  return { passed, failed, running };
}

/**
 * Roll up reviews into approved / changes-requested counts by each reviewer's *latest* verdict —
 * APPROVED / CHANGES_REQUESTED set it, DISMISSED clears it, COMMENTED / PENDING don't change it
 * (mirrors GitHub's own per-reviewer rollup, so one person can't be double-counted).
 */
export function summarizeReviews(reviews: PRReview[]): { approved: number; changesRequested: number } {
  const byUser = new Map<string, 'APPROVED' | 'CHANGES_REQUESTED'>();
  const ordered = [...reviews].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  for (const r of ordered) {
    if (r.state === 'APPROVED' || r.state === 'CHANGES_REQUESTED') byUser.set(r.user, r.state);
    else if (r.state === 'DISMISSED') byUser.delete(r.user);
  }
  let approved = 0;
  let changesRequested = 0;
  for (const v of byUser.values()) {
    if (v === 'APPROVED') approved++;
    else changesRequested++;
  }
  return { approved, changesRequested };
}
