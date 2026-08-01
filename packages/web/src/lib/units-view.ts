import type { CheckRun, Lane, PRReview, TriageKind, TriagedFile, Unit, UnitStatus } from '../state/types';

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
    // changes_requested — the ball is back with the author.
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

/**
 * The lane a row renders in — **read from the server, never derived**.
 *
 * `laneOf` lives in `packages/cli/src/units/lane.ts` and stays there by contract decision: the daemon
 * logs lane splits while this renders them, and two implementations of one rule would drift, corrupting
 * exactly the data the "am I opening fewer PRs I didn't need to?" judgment rests on. So the server sends
 * the answer and this reads it.
 *
 * The fallback is not a second implementation — it is what the queue did before lanes existed. A payload
 * from an older daemon carries no `lane`, and degrading to today's status grouping beats an empty screen.
 */
export function laneOf(unit: Unit): Lane {
  return unit.lane ?? groupOf(unit.status);
}

/** Whether ✕ has hidden this row. Mirrors `isDismissed` in the CLI's lane module. */
function isDismissed(unit: Unit): boolean {
  return typeof unit.dismissedAtSha === 'string' && unit.dismissedAtSha.length > 0;
}

export type GroupedUnits = {
  needsYou: Unit[];
  probablyNot: Unit[];
  inFlight: Unit[];
  cleared: Unit[];
  /** Not a lane — a count behind a reveal. Dismissed rows are excluded from all four buckets. */
  dismissedCount: number;
};

/** Criticality outranks everything: a tagged PR leads the queue whatever else is true of it. */
const hasCriticality = (u: Unit): number => (u.triage && u.triage.criticality.length > 0 ? 1 : 0);

/** Nobody has approved yet ⇒ you may be the only thing standing between this and main. Sorts first. */
const unapproved = (u: Unit): number => (u.reviewRollup && u.reviewRollup.approved > 0 ? 0 : 1);

/**
 * Partition + order units for display, on the lane the server assigned.
 *
 * needs-you leads with criticality, then with work nobody else has approved, then oldest-first — the
 * queue should still pull toward stale work. probably-not sorts oldest-first only: ranking within a lane
 * you are being told not to read is wasted signal. in-flight and cleared are untouched by this feature
 * and keep their most-recent-activity order.
 */
export function groupUnits(units: Unit[]): GroupedUnits {
  const needsYou: Unit[] = [];
  const probablyNot: Unit[] = [];
  const inFlight: Unit[] = [];
  const cleared: Unit[] = [];
  let dismissedCount = 0;
  for (const u of units) {
    if (isDismissed(u)) {
      dismissedCount++;
      continue;
    }
    const lane = laneOf(u);
    if (lane === 'needs-you') needsYou.push(u);
    else if (lane === 'probably-not') probablyNot.push(u);
    else if (lane === 'cleared') cleared.push(u);
    else inFlight.push(u);
  }
  const oldestFirst = (a: Unit, b: Unit) => updatedAtMs(a) - updatedAtMs(b);
  // Criticality, then work nobody has approved, then — for units actually opened — the narrative's own
  // verdict, then oldest-first. The verdict key is kept rather than dropped: it is uniformly `neutral`
  // across unhydrated rows (so it costs nothing there, which is precisely why it was never a usable lead
  // signal), but on a PR that *has* been read it is a real measurement, and this feature has no business
  // discarding one.
  needsYou.sort(
    (a, b) =>
      hasCriticality(b) - hasCriticality(a) ||
      unapproved(b) - unapproved(a) ||
      VERDICT_RANK[verdictTone(b.verdict)] - VERDICT_RANK[verdictTone(a.verdict)] ||
      oldestFirst(a, b),
  );
  probablyNot.sort(oldestFirst);
  const recentFirst = (a: Unit, b: Unit) => updatedAtMs(b) - updatedAtMs(a);
  inFlight.sort(recentFirst);
  cleared.sort(recentFirst);
  return { needsYou, probablyNot, inFlight, cleared, dismissedCount };
}

// --- Row evidence (the reason line + visual weight) --------------------------------------------

/**
 * Mirror of `isMechanicalKind` in `packages/cli/src/narrative/triage.ts`, expressed as the complement of
 * `source` rather than as a copy of its ten-member set — because that is what the CLI's own type doc says
 * `source` *means*: "classifies as nothing mechanical". Mirroring the rule instead of the enumeration is
 * what keeps the two from silently disagreeing the day a new mechanical kind is added CLI-side.
 */
const isMechanicalKind = (kind: TriageKind): boolean => kind !== 'source';

/** What a fully-mechanical PR is made of: 'docs only' / 'tests only' / 'lockfile + manifest' / 'a + b'. */
function kindSummary(files: TriagedFile[]): string {
  const kinds = [...new Set(files.map((f) => f.kind))];
  if (kinds.length === 1) {
    const only = kinds[0]!;
    return only === 'docs' ? 'docs only' : only === 'test-only' ? 'tests only' : only;
  }
  if (kinds.every((k) => k === 'manifest' || k === 'lockfile')) return 'lockfile + manifest';
  return kinds.join(' + ');
}

/** The copy for a unit nobody has measured — an absence, stated as one. Never a verdict. */
export const NOT_MEASURED = 'not looked at yet';

/**
 * The one line under the title: why this row is where it is, in facts.
 *
 * It states what was *found*, never what to do about it — no "safe", no "fine", no "approved". The
 * advisory lane earns its keep by being auditable, and a line that reads as a safety claim is exactly
 * what the rejected approve-button decision was protecting against.
 *
 * The branch order mirrors `needsYouReason` in the CLI's lane module, and the probably-not case defers to
 * the lane outright rather than re-deriving it. What that ordering buys is narrow but worth stating: every
 * branch below states a fact that is true of the PR independent of which branch won, so if the two ever
 * fall out of step the row shows a *different true fact*, never a false one.
 */
export function reasonLine(unit: Unit): string {
  const t = unit.triage;
  if (!t || t.files.length === 0) return NOT_MEASURED;
  // The lane already certified every veto clear for this one, so the only honest line is what the files are.
  if (laneOf(unit) === 'probably-not') return kindSummary(t.files);
  if (t.truncated) return 'over 100 files';
  if (t.criticality.length > 0) return t.criticality.join(' · ');
  const source = t.files.filter((f) => !isMechanicalKind(f.kind));
  if (source.length > 0) return source.length === 1 ? '1 source file' : `${source.length} source files`;
  return kindSummary(t.files);
}

/**
 * The one sentence under the evidence drawer's file table: what the list above actually establishes.
 *
 * This is the trust mechanism. "Probably not" has to be auditable in one click or it is a claim taken on
 * faith, which is the thing the rejected approve-button decision was guarding against — so the sentence
 * describes the *method* (paths were classified) and never vouches for the code.
 */
export function drawerNote(unit: Unit): string {
  const lane = laneOf(unit);
  if (lane === 'in-flight' || lane === 'cleared') {
    return 'Not triaged by lane at all — this row is here because of its status, not its files.';
  }
  const t = unit.triage;
  if (!t || t.files.length === 0) {
    return 'No file list was gathered for this PR, so there is nothing above to weigh. Absence of evidence is not evidence of absence, which is why it sits in the lane that needs you.';
  }
  if (lane === 'probably-not') {
    return 'Every file above classifies as mechanical and no path matched a criticality keyword. That is the entire basis for this row — the code was never read.';
  }
  if (t.truncated) {
    return 'This PR has more files than one request returns, so the list above is partial. A PR too large to see at once is not a low-stakes one under any reading.';
  }
  if (t.criticality.length > 0) {
    return `Paths matched criticality keywords: ${t.criticality.join(', ')}. That is a match on a file path, not a judgment about what the code does.`;
  }
  const source = t.files.filter((f) => !isMechanicalKind(f.kind)).length;
  return `${source === 1 ? 'One file classifies' : `${source} files classify`} as ordinary source. One is enough to keep a PR out of the low-attention lane.`;
}

/**
 * Visual weight only — never lane membership. A four-line typo fix and a nine-hundred-line auth refactor
 * render identically today, which is the specific thing that makes the queue unscannable.
 *
 * A unit with no triage sits at `mid`: it is not known to be small, and inflating it to `high` would make
 * every un-backfilled row shout.
 */
export function stakesOf(unit: Unit): 'high' | 'mid' | 'low' {
  const t = unit.triage;
  if (!t) return 'mid';
  if (t.criticality.length > 0 || t.truncated) return 'high';
  const churn = t.additions + t.deletions;
  if (churn >= 200 || t.files.length >= 10) return 'high';
  if (churn <= 20 && t.files.length <= 2) return 'low';
  return 'mid';
}

/** Distinct repos across the queue, sorted — the repo filter's option list. */
export function repoOptions(units: Unit[]): string[] {
  return [...new Set(units.map((u) => u.repo))].sort();
}

// --- Repo facets (the command-center sidebar) --------------------------------------------------

/**
 * One repo's row in the facet sidebar: the repo split into owner + short name, plus how many of its
 * units currently need Nick (`needs-you`, via `groupOf`) and its total unit count. Counts are always
 * derived from the UNFILTERED queue so selecting a facet never changes them.
 */
export type RepoFacet = {
  repo: string; // full "owner/name" — the value handed to setRepoFilter
  owner: string; // "workos" ('' when the repo has no owner segment)
  shortName: string; // "authkit" (the whole repo when there's no owner segment)
  needsYou: number;
  total: number;
};

export type RepoFacets = {
  /** Total needs-you across every repo — the "All" facet's count. */
  needsYou: number;
  /** More than one distinct owner present — the cue to label owner groups (short names collide otherwise). */
  multipleOwners: boolean;
  /** Repos with work waiting on Nick, busiest-first. */
  busy: RepoFacet[];
  /** Repos holding only in-flight/cleared units (0 needs-you) — folded behind the "quiet" toggle. */
  quiet: RepoFacet[];
};

function splitRepo(repo: string): { owner: string; shortName: string } {
  const slash = repo.indexOf('/');
  if (slash === -1) return { owner: '', shortName: repo };
  return { owner: repo.slice(0, slash), shortName: repo.slice(slash + 1) };
}

// Busiest-first: most work waiting on you, then most units overall, then alphabetical for a stable order.
const byBusiest = (a: RepoFacet, b: RepoFacet): number =>
  b.needsYou - a.needsYou || b.total - a.total || a.repo.localeCompare(b.repo);

/**
 * Fold the queue into sidebar facets. Per-repo `needs-you` reads the same server-assigned lane the
 * "Needs you" header counts, so the two can never disagree — on `groupOf` alone the sidebar would keep
 * counting probably-not units and quietly claim more work than the lane shows. Repos with none drop into
 * `quiet` (they still hold other units, so they stay reachable behind the toggle).
 */
export function buildRepoFacets(units: Unit[]): RepoFacets {
  const byRepo = new Map<string, RepoFacet>();
  let needsYou = 0;
  for (const u of units) {
    let facet = byRepo.get(u.repo);
    if (!facet) {
      facet = { repo: u.repo, ...splitRepo(u.repo), needsYou: 0, total: 0 };
      byRepo.set(u.repo, facet);
    }
    facet.total++;
    if (laneOf(u) === 'needs-you') {
      facet.needsYou++;
      needsYou++;
    }
  }
  const facets = [...byRepo.values()];
  const multipleOwners = new Set(facets.map((f) => f.owner)).size > 1;
  const busy = facets.filter((f) => f.needsYou > 0).sort(byBusiest);
  const quiet = facets.filter((f) => f.needsYou === 0).sort(byBusiest);
  return { needsYou, multipleOwners, busy, quiet };
}

export type OwnerGroup = { owner: string; repos: RepoFacet[] };

/**
 * Group an already-sorted facet list into owner sections, preserving the incoming order — so the
 * busiest owner leads and rows stay busiest-first within a section. Used only when more than one
 * owner is present; single-owner lists render flat, without labels.
 */
export function groupByOwner(facets: RepoFacet[]): OwnerGroup[] {
  const groups: OwnerGroup[] = [];
  const index = new Map<string, OwnerGroup>();
  for (const facet of facets) {
    let group = index.get(facet.owner);
    if (!group) {
      group = { owner: facet.owner, repos: [] };
      index.set(facet.owner, group);
      groups.push(group);
    }
    group.repos.push(facet);
  }
  return groups;
}

/**
 * The visible "where did this unit come from" badge. Every unit mirrors a real GitHub PR and comments
 * post back to it; what differs is which door it came through — GitHub asked you (the poller), or you
 * asked for it (the add-PR field). Worth distinguishing on the row because the two behave differently:
 * a polled unit leaves the queue on its own once the request is gone, an added one stays until you
 * remove it.
 */
export type SourceBadge = { label: string; title: string; tone: 'github' | 'added' };

export function sourceBadge(unit: Pick<Unit, 'pinned'>): SourceBadge {
  if (unit.pinned) {
    return {
      label: 'Added',
      title: 'A PR you added by hand — it stays in your queue until you remove it. Comments post to the PR.',
      tone: 'added',
    };
  }
  return {
    label: 'GitHub',
    title: 'Pulled from a GitHub review request — comments post to the PR',
    tone: 'github',
  };
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

export type Route = { name: 'center' } | { name: 'unit'; unitId: string } | { name: 'settings' };

export function parseRoute(pathname: string): Route {
  const trimmed = pathname.replace(/\/+$/, ''); // drop trailing slashes
  const match = trimmed.match(/^\/units\/(.+)$/);
  if (match) return { name: 'unit', unitId: decodeURIComponent(match[1]!) };
  if (trimmed === '/settings') return { name: 'settings' };
  return { name: 'center' };
}

export function routePath(route: Route): string {
  if (route.name === 'unit') return `/units/${encodeURIComponent(route.unitId)}`;
  if (route.name === 'settings') return '/settings';
  return '/';
}

/**
 * Which API endpoint a review action should hit. In the daemon's command center, an open unit
 * drill-in talks to that unit's GitHub PR (`/api/units/:id/<resource>`); everywhere else (PR mode,
 * the center root) it's the single-PR `/api/<resource>`. Pure so the surface routing is
 * unit-tested without rendering a hook.
 */
function resourceEndpoint(mode: 'pr' | 'command-center', route: Route, resource: string): string {
  if (mode === 'command-center' && route.name === 'unit') {
    return `/api/units/${encodeURIComponent(route.unitId)}/${resource}`;
  }
  return `/api/${resource}`;
}

/** Comments endpoint for `useComments` (PR `/api/comments`, or a unit's PR in the daemon drill-in). */
export const commentsEndpoint = (mode: 'pr' | 'command-center', route: Route): string =>
  resourceEndpoint(mode, route, 'comments');

/** Review-submission endpoint for the submit bar/dialog. */
export const reviewEndpoint = (mode: 'pr' | 'command-center', route: Route): string =>
  resourceEndpoint(mode, route, 'review');

/** AI endpoint (summary draft, ask) for the submit dialog and ask-Dad features. */
export const aiEndpoint = (mode: 'pr' | 'command-center', route: Route): string => resourceEndpoint(mode, route, 'ai');

/**
 * Where an inline comment on the current surface actually lands — the one fact that gates the
 * composer's copy:
 *   - `github` → a real GitHub PR comment (a daemon `github` unit — the "Comment on PR" case)
 *   - `review` → the standalone PR-review batch flow (pr mode, or the center root with no open unit)
 * Pure, so the routing is unit-tested without rendering a hook.
 */
export type CommentTarget = 'github' | 'review';

export function commentTarget(mode: 'pr' | 'command-center', route: Route, units: Unit[]): CommentTarget {
  if (mode === 'command-center' && route.name === 'unit') {
    const unit = units.find((u) => u.unitId === route.unitId);
    if (!unit) return 'review';
    return 'github';
  }
  return 'review';
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
