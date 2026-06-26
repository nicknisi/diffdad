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
 * a `toResolve` count. Persisted one-file-per-unit under ~/.cache/diffdad/units/.
 */
export type ReviewUnit = {
  unitId: string;
  repo: string; // owner/name
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
  createdAt: string;
  updatedAt: string;
};

/** Input to `UnitStore.add` — identity, status, and timestamps are assigned by the store. */
export type NewReviewUnit = {
  repo: string;
  worktreePath: string;
  taskLabel: string;
  intent: string;
  uncertainties?: string[];
  baseRef: string;
  diffContentKey: string;
  files: DiffFile[];
  metadata: PRMetadata;
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
