import { mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import type { DiffFile, PRMetadata } from '../github/types';
import type { NarrativeResponse } from '../narrative/types';
import {
  type Decision,
  IllegalTransitionError,
  type NewReviewUnit,
  type ReviewUnit,
  type UnitStatus,
  UnknownUnitError,
} from './types';

const DEFAULT_DIR = join(homedir(), '.cache', 'diffdad', 'units');

/** Permitted state-machine edges (spec-phase-2 Data Model). An unlisted edge throws. */
const TRANSITIONS: Record<UnitStatus, UnitStatus[]> = {
  submitted: ['reviewing'],
  reviewing: ['queued'],
  queued: ['approved', 'changes_requested'],
  approved: ['done'],
  changes_requested: ['addressing'],
  addressing: ['reviewing'],
  done: [],
};

/** Sanitize a unit's `<repo>-<unitId>` key into a safe filename (repo carries a slash). */
function unitFile(dir: string, repo: string, unitId: string): string {
  const safe = `${repo}-${unitId}`.replace(/[^a-zA-Z0-9._-]/g, '-');
  return join(dir, `${safe}.json`);
}

export type StoreOptions = {
  /** Injectable for deterministic tests / isolation from the real cache dir. */
  dir?: string;
  now?: () => string;
  genId?: () => string;
};

export type UnitFilter = { status?: UnitStatus; repo?: string };

/** A fresh diff slice re-ingested into an existing local unit (re-`add` dedup, or retry of a review). */
export type ResubmitInput = {
  taskLabel?: string;
  intent?: string;
  baseRef: string;
  diffContentKey: string;
  files: DiffFile[];
  metadata: PRMetadata;
};

/**
 * The cross-repo review-unit store — the spine of the daemon, shared by the MCP tools and the
 * HTTP routes. In-memory (keyed by globally-unique `unitId`) with best-effort write-through to
 * one JSON file per unit under ~/.cache/diffdad/units/. Single-process synchronous mutations +
 * `save()` after each — no real concurrency in Bun's loop (same reasoning as agent-comments).
 * Mutations validate against the state machine; an illegal jump throws a typed error the MCP
 * layer maps to a tool error.
 */
export class UnitStore {
  private units = new Map<string, ReviewUnit>();
  private readonly dir: string;
  private readonly now: () => string;
  private readonly genId: () => string;

  constructor(initial: ReviewUnit[] = [], opts: StoreOptions = {}) {
    this.dir = opts.dir ?? DEFAULT_DIR;
    for (const u of initial) this.units.set(u.unitId, u);
    this.now = opts.now ?? (() => new Date().toISOString());
    this.genId = opts.genId ?? (() => crypto.randomUUID());
  }

  /** Load every persisted unit from disk (or start empty if the dir is absent/unreadable). */
  static async load(opts: StoreOptions = {}): Promise<UnitStore> {
    const dir = opts.dir ?? DEFAULT_DIR;
    const initial: ReviewUnit[] = [];
    try {
      const names = await readdir(dir);
      const parsed = await Promise.all(
        names
          .filter((n) => n.endsWith('.json'))
          .map(async (n) => {
            try {
              return JSON.parse(await readFile(join(dir, n), 'utf-8')) as ReviewUnit;
            } catch {
              return null; // skip a corrupt file rather than failing the whole load
            }
          }),
      );
      for (const u of parsed) {
        if (u && typeof u.unitId === 'string') {
          u.source ??= 'agent'; // back-compat: files written before the discriminator existed
          initial.push(u);
        }
      }
    } catch {
      // dir missing — start clean
    }
    return new UnitStore(initial, opts);
  }

  get(unitId: string): ReviewUnit | undefined {
    return this.units.get(unitId);
  }

  list(filter: UnitFilter = {}): ReviewUnit[] {
    let out = [...this.units.values()];
    if (filter.status) out = out.filter((u) => u.status === filter.status);
    if (filter.repo) out = out.filter((u) => u.repo === filter.repo);
    return out;
  }

  /**
   * Drop a unit from memory and disk; returns whether it existed. The only removal path — used by the
   * DELETE route so the reviewer can clear failed or stale units, which the forward-only state machine
   * has no edge to retire on its own.
   */
  async remove(unitId: string): Promise<boolean> {
    const unit = this.units.get(unitId);
    if (!unit) return false;
    this.units.delete(unitId);
    try {
      await unlink(unitFile(this.dir, unit.repo, unitId));
    } catch {
      // never persisted, or already gone — the in-memory delete is what's authoritative
    }
    return true;
  }

  /**
   * Find a local (cli/agent) unit by its worktree path — the dedup/retry identity. A second `dad add`
   * from the same checkout updates this unit in place rather than minting a duplicate. github units
   * carry no worktree (`''`), so they never match.
   */
  findByWorktree(worktreePath: string): ReviewUnit | undefined {
    for (const u of this.units.values()) {
      if (u.source !== 'github' && u.worktreePath === worktreePath) return u;
    }
    return undefined;
  }

  /**
   * Re-ingest a fresh slice into an existing local unit: back to `submitted` for re-review, prior
   * narrative / verdict / decision / error cleared. Deliberately bypasses the forward-only machine —
   * this is new content for the same worktree (a re-`add` or a retry of a failed review), not a state
   * transition — which is also the only way a `queued` (failed) unit can re-enter the worker pool.
   */
  async resubmit(unitId: string, input: ResubmitInput): Promise<ReviewUnit> {
    const unit = this.require(unitId);
    unit.status = 'submitted';
    unit.baseRef = input.baseRef;
    unit.diffContentKey = input.diffContentKey;
    unit.files = input.files;
    unit.metadata = input.metadata;
    if (input.taskLabel !== undefined) unit.taskLabel = input.taskLabel;
    if (input.intent !== undefined) unit.intent = input.intent;
    unit.narrative = undefined;
    unit.verdict = undefined;
    unit.decision = undefined;
    unit.error = undefined;
    unit.toResolve = 0;
    unit.updatedAt = this.now();
    await this.save(unit);
    return unit;
  }

  async add(input: NewReviewUnit): Promise<ReviewUnit> {
    const ts = this.now();
    const unit: ReviewUnit = {
      unitId: this.genId(),
      repo: input.repo,
      source: input.source ?? 'agent',
      worktreePath: input.worktreePath,
      taskLabel: input.taskLabel,
      intent: input.intent,
      uncertainties: input.uncertainties ?? [],
      baseRef: input.baseRef,
      diffContentKey: input.diffContentKey,
      status: 'submitted',
      toResolve: 0,
      files: input.files,
      metadata: input.metadata,
      createdAt: ts,
      updatedAt: ts,
    };
    this.units.set(unit.unitId, unit);
    await this.save(unit);
    return unit;
  }

  /**
   * Mint a `github` unit from polled PR metadata. Unlike `add()`, it is born **`queued`**, not
   * `submitted` — github units must never enter the local worker pool (which only claims
   * `submitted`/`reviewing`); their walkthrough is generated lazily on open. The `headSha` keys the
   * (lazy) narrative cache via `diffContentKey`, and `files` start empty until that fetch.
   *
   * Synchronous (returns the unit immediately for the poller's reducer); the disk write goes through
   * the same best-effort `save()` path as every other mutation, the in-memory copy authoritative.
   */
  addGithubUnit(input: {
    owner: string;
    repo: string;
    number: number;
    title: string;
    headBranch: string;
    headSha: string;
    author: string;
    url: string;
    baseRef?: string;
    metadata: PRMetadata;
  }): ReviewUnit {
    const ts = this.now();
    const unit: ReviewUnit = {
      unitId: this.genId(),
      repo: `${input.owner}/${input.repo}`,
      source: 'github',
      worktreePath: '',
      taskLabel: input.title,
      intent: '',
      uncertainties: [],
      baseRef: input.baseRef ?? 'main',
      diffContentKey: input.headSha,
      status: 'queued',
      toResolve: 0,
      files: [],
      metadata: input.metadata,
      prNumber: input.number,
      prUrl: input.url,
      prAuthor: input.author,
      lastReviewedSha: undefined,
      createdAt: ts,
      updatedAt: ts,
    };
    this.units.set(unit.unitId, unit);
    void this.save(unit);
    return unit;
  }

  /**
   * Attach PR linkage to an EXISTING agent/cli unit the poller matched by repo + branch. Status is
   * left untouched (the unit keeps advancing through the agent loop); only PR identity + the current
   * `metadata.headSha` are recorded. Synchronous; persistence is best-effort via `save()`.
   */
  linkPr(unitId: string, link: { prNumber: number; prUrl: string; prAuthor: string; headSha: string }): ReviewUnit {
    const unit = this.require(unitId);
    unit.prNumber = link.prNumber;
    unit.prUrl = link.prUrl;
    unit.prAuthor = link.prAuthor;
    unit.metadata = { ...unit.metadata, headSha: link.headSha };
    unit.updatedAt = this.now();
    void this.save(unit);
    return unit;
  }

  /**
   * Record the head SHA a decision was made against (freshness). A later push past this SHA is what
   * lets the poller re-open the review. Used by the decision-dispatch slice. Synchronous.
   */
  setReviewedSha(unitId: string, sha: string): ReviewUnit {
    const unit = this.require(unitId);
    unit.lastReviewedSha = sha;
    unit.updatedAt = this.now();
    void this.save(unit);
    return unit;
  }

  /**
   * Re-open a reviewed `github` unit when the author pushes again: back to `queued`, decision cleared,
   * `metadata.headSha` advanced. This is the one source-gated reverse edge (`approved|changes_requested
   * → queued`); it lives here rather than in the shared `TRANSITIONS` table so the strict forward-only
   * machine the agent loop relies on stays intact. Throws if the unit isn't a github unit in a reviewed
   * state. Synchronous.
   */
  resurfaceForNewPush(unitId: string, headSha: string): ReviewUnit {
    const unit = this.require(unitId);
    if (unit.source !== 'github') {
      throw new IllegalTransitionError(unit.status, 'queued', unitId);
    }
    if (unit.status !== 'approved' && unit.status !== 'changes_requested') {
      throw new IllegalTransitionError(unit.status, 'queued', unitId);
    }
    unit.status = 'queued';
    unit.decision = undefined;
    unit.metadata = { ...unit.metadata, headSha };
    // Mirror the mint-time invariant (diffContentKey = headSha): the narrative cache key must advance
    // with the head, else a re-review re-uses the stale cache entry keyed on the old sha.
    unit.diffContentKey = headSha;
    // Drop the prior push's walkthrough so the lazy-hydrate route (a no-op when a narrative exists)
    // re-fetches + re-narrates the NEW diff — otherwise the reviewer reads a stale walkthrough.
    unit.narrative = undefined;
    unit.files = [];
    unit.verdict = undefined;
    unit.toResolve = 0;
    unit.updatedAt = this.now();
    void this.save(unit);
    return unit;
  }

  /**
   * Lazy-hydration write for `github` units: attach the fetched diff + generated narrative WITHOUT a
   * status transition (a github unit stays `queued`). Distinct from `setQueued`, which owns the
   * reviewing→queued edge for the agent/cli worker-pool path; here the unit is already `queued` and we
   * only fill in the deferred walkthrough. Synchronous; persistence is best-effort via `save()`.
   */
  attachReview(unitId: string, files: DiffFile[], narrative: NarrativeResponse, toResolve: number): ReviewUnit {
    const unit = this.require(unitId);
    unit.files = files;
    unit.narrative = narrative;
    unit.verdict = narrative.verdict;
    unit.toResolve = toResolve;
    unit.updatedAt = this.now();
    void this.save(unit);
    return unit;
  }

  async setReviewing(unitId: string): Promise<ReviewUnit> {
    return this.mutate(unitId, 'reviewing', () => {});
  }

  async setQueued(unitId: string, narrative: NarrativeResponse, toResolve: number): Promise<ReviewUnit> {
    return this.mutate(unitId, 'queued', (u) => {
      u.narrative = narrative;
      u.verdict = narrative.verdict;
      u.toResolve = toResolve;
      u.error = undefined;
    });
  }

  /** Review worker threw: queue the unit anyway with an error so it still reaches the reviewer. */
  async setReviewFailed(unitId: string, error: string): Promise<ReviewUnit> {
    return this.mutate(unitId, 'queued', (u) => {
      u.error = error;
      u.toResolve = 0;
    });
  }

  async setDecision(unitId: string, decision: Decision): Promise<ReviewUnit> {
    return this.mutate(unitId, decision.kind, (u) => {
      u.decision = decision;
    });
  }

  /** Validate the transition, apply `mutator`, stamp `updatedAt`, and persist. */
  private async mutate(unitId: string, to: UnitStatus, mutator: (u: ReviewUnit) => void): Promise<ReviewUnit> {
    const unit = this.require(unitId);
    if (!TRANSITIONS[unit.status].includes(to)) {
      throw new IllegalTransitionError(unit.status, to, unitId);
    }
    unit.status = to;
    mutator(unit);
    unit.updatedAt = this.now();
    await this.save(unit);
    return unit;
  }

  private require(unitId: string): ReviewUnit {
    const unit = this.units.get(unitId);
    if (!unit) throw new UnknownUnitError(unitId);
    return unit;
  }

  /** Best-effort persistence: on failure the in-memory copy stays authoritative. */
  private async save(unit: ReviewUnit): Promise<void> {
    try {
      await mkdir(this.dir, { recursive: true });
      await writeFile(unitFile(this.dir, unit.repo, unit.unitId), JSON.stringify(unit, null, 2));
    } catch (err) {
      console.warn(`[diffdad] failed to persist review unit: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
