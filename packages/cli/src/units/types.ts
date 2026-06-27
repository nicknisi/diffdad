import type { DiffFile, PRMetadata } from '../github/types';
import type { Concern, NarrativeResponse } from '../narrative/types';

/**
 * State machine (see spec-phase-2 Data Model):
 *   submitted → reviewing → queued → { approved | changes_requested }
 *   changes_requested → addressing → reviewing → …
 *   approved → done
 */
export type UnitStatus =
  | 'submitted'
  | 'reviewing'
  | 'queued'
  | 'approved'
  | 'changes_requested'
  | 'addressing'
  | 'done';

/** Which door a unit entered the queue through (multi-source ingestion). Defaults to `'agent'`. */
export type UnitSource = 'agent' | 'cli' | 'github';

/** The reviewer's verdict on a unit, delivered back to the agent over `await_decision`. */
export type Decision = {
  kind: 'approved' | 'changes_requested';
  /** Curated concerns the agent should address (changes_requested). CLI-native shape. */
  concerns?: Concern[];
  note?: string;
};

/**
 * A unit of agent work submitted for review. Owns its diff slice (`files`/`metadata`), the
 * Phase-1 review output (`narrative` — the brief is derived in the UI via `buildWalkthrough`,
 * since `WalkthroughModel` is a web type the CLI can't produce), a state-machine `status`, and
 * a `toResolve` count. Persisted one-file-per-unit under <dataDir>/units/ (see paths.ts).
 */
export type ReviewUnit = {
  unitId: string;
  repo: string; // owner/name
  /** Which door this unit entered through; defaults to `'agent'` on load for back-compat. */
  source: UnitSource;
  worktreePath: string;
  taskLabel: string;
  intent: string;
  uncertainties: string[];
  baseRef: string;
  diffContentKey: string;
  status: UnitStatus;
  toResolve: number;
  files: DiffFile[];
  metadata: PRMetadata;
  /** Phase-1 narrative; absent until the review worker queues the unit. */
  narrative?: NarrativeResponse;
  /** Cached from `narrative.verdict` for the dashboard's recommended action. */
  verdict?: NarrativeResponse['verdict'];
  decision?: Decision;
  /** Set when the review worker threw — the unit still queues so it reaches the reviewer. */
  error?: string;
  // --- github-source fields (multi-source ingestion) ---
  /** The PR this unit tracks (github units; also set on agent/cli units once linked to a PR). */
  prNumber?: number;
  /** The PR's html URL. */
  prUrl?: string;
  /** The PR author's login — so the row can show whose PR it is. */
  prAuthor?: string;
  /** Freshness: the head SHA the last decision was recorded against. A newer push re-opens review. */
  lastReviewedSha?: string;
  createdAt: string;
  updatedAt: string;
};

/** Input to `UnitStore.add` — identity, status, and timestamps are assigned by the store. */
export type NewReviewUnit = {
  repo: string;
  /** Defaults to `'agent'` when omitted (set by the store). */
  source?: UnitSource;
  worktreePath: string;
  taskLabel: string;
  intent: string;
  uncertainties?: string[];
  baseRef: string;
  diffContentKey: string;
  files: DiffFile[];
  metadata: PRMetadata;
  /** Optional PR linkage, carried through when a unit is born already tied to a PR. */
  prNumber?: number;
  prUrl?: string;
  prAuthor?: string;
};

/**
 * A PR returned by the background review-request poller — only the cheap metadata needed to mint or
 * link a `github` unit (the diff/narrative are fetched lazily on open, not here).
 */
export type PolledPr = {
  owner: string;
  repo: string;
  number: number;
  title: string;
  headBranch: string;
  headSha: string;
  /** The PR's base branch (e.g. `main`/`develop`), straight from the PR fetch — not assumed. */
  base: string;
  author: string;
  url: string;
  updatedAt: string;
};

/** Thrown when a mutation references a unit id the store doesn't hold. */
export class UnknownUnitError extends Error {
  constructor(public readonly unitId: string) {
    super(`unknown review unit id: ${unitId}`);
    this.name = 'UnknownUnitError';
  }
}

/** Thrown when a transition is not permitted by the state machine. Mapped to an MCP error. */
export class IllegalTransitionError extends Error {
  constructor(
    public readonly from: UnitStatus,
    public readonly to: UnitStatus,
    public readonly unitId: string,
  ) {
    super(`illegal unit transition ${from} → ${to} (unit ${unitId})`);
    this.name = 'IllegalTransitionError';
  }
}
