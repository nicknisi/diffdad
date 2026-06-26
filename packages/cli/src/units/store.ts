import { mkdir, readdir, readFile, writeFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
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
        if (u && typeof u.unitId === 'string') initial.push(u);
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

  async add(input: NewReviewUnit): Promise<ReviewUnit> {
    const ts = this.now();
    const unit: ReviewUnit = {
      unitId: this.genId(),
      repo: input.repo,
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
