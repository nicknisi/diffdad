# Implementation Spec: Diff Dad Review Loop - Phase 2

**Contract**: ./contract.md
**Estimated Effort**: XL

## Technical Approach

Phase 2 turns dad from a per-invocation server into a long-lived, **per-machine daemon** that owns a cross-repo review-unit store, serves one command-center UI, and exposes the MCP endpoint agents submit finished work to. Build order *within* the phase (the high-risk slice deliberately last):

1. **Review-unit store** — the spine. Extend the `agent-comments/store.ts` pattern: in-memory + write-through JSON, keyed by `repo + unitId`, persisted under `~/.cache/diffdad/units/`. A unit owns its diff slice, its brief (Phase 1's `buildWalkthrough` output), a state-machine `status`, and a `toResolve` count.
2. **`submit_for_review` + decision-delivery MCP tools** — wired to the store; the agent submits, then parks on the decision channel.
3. **The daemon** — generalize `server.ts` into a long-lived process that multiplexes many units, runs a bounded review-worker pool (Phase 1's narrative→walkthrough pipeline per unit), serves the command center + MCP + per-unit review.
4. **Command-center UI** — needs-you / in-flight / cleared, status-grouped, cross-repo (the mockup you approved).
5. **launchd terminal-survival** — the hardening slice, last: the cross-repo list is usable when launched from a terminal before it survives one.

The store is the seam Phase 1 anticipated. `submit_for_review` computes the slice with the existing `buildLocalReview` (from watch mode); the review worker runs Phase 1's pipeline to produce the brief; the unit lands in the queue; the agent parks on `await_decision`. Decisions flow back over that channel — the *same* channel Phase 4's auto-clear will reuse, which is why P4 depends on this phase.

Key decisions: one daemon per machine (multi-machine sync is out of scope); the store is the single source of truth shared by MCP tools and HTTP routes (the discipline `agent-comments/store.ts` already enforces); generalize `server.ts` rather than fork it; launchd last because it is the highest-risk slice and adds nothing the in-terminal daemon hasn't already proven.

## Feedback Strategy

**Inner-loop command**: `cd packages/cli && npx vitest run src/units/__tests__/store.test.ts`

**Playground**: Vitest for the unit store + state machine + MCP tools (the bulk of the logic); the Vite dev server (`bun run dev` against a running `dad daemon`) for the command center; a `launchctl` smoke test for terminal-survival.

**Why this approach**: The unit store + state machine is the spine and is pure-logic testable in sub-second runs; the daemon process, UI, and launchd are validated out-of-band where unit tests can't reach.

## File Changes

### New Files

| File Path | Purpose |
| --------- | ------- |
| `packages/cli/src/units/store.ts` | `UnitStore`: lifecycle, state-machine transitions, write-through persistence (pattern: `agent-comments/store.ts`). |
| `packages/cli/src/units/types.ts` | `ReviewUnit`, `UnitStatus`, `Decision` types. |
| `packages/cli/src/units/__tests__/store.test.ts` | Lifecycle, transition validation, persistence round-trip. |
| `packages/cli/src/daemon/daemon.ts` | Long-lived process: owns the `UnitStore`, serves command center + MCP + per-unit review, runs the review-worker pool. |
| `packages/cli/src/daemon/launchd.ts` | Generate + load/unload the LaunchAgent plist (`dad daemon install/uninstall`). |
| `packages/cli/src/mcp/submit.ts` | `submit_for_review` + `await_decision` tool definitions. |
| `packages/cli/src/__tests__/mcp-submit.test.ts` | submit → unitId; decision round-trips via `await_decision`. |
| `packages/web/src/components/CommandCenter.tsx` | The dashboard: needs-you / in-flight / cleared, status-grouped. |
| `packages/web/src/components/UnitRow.tsx` | A queue / in-flight row (recommended action, repo·branch·task, to-resolve, status). |
| `packages/web/src/hooks/useUnits.ts` | Fetch `/api/units` + SSE live updates. |

### Modified Files

| File Path | Changes |
| --------- | ------- |
| `packages/cli/src/server.ts` | Generalize the route handlers to be unit-scoped so the daemon can host many units behind one app (rather than one PR per process). |
| `packages/cli/src/cli.ts` | Add `dad daemon` (start / install / uninstall / status). |
| `packages/cli/src/mcp/server.ts` | Register `submit_for_review` + `await_decision` alongside the existing three tools. |
| `packages/cli/src/local/diff-source.ts` | Reuse `buildLocalReview(baseRef)` against the submitted `worktreePath` to compute a unit's slice. |

## Implementation Details

### 1. Review-unit store (the spine)

**Pattern to follow**: `packages/cli/src/agent-comments/store.ts` (in-memory + write-through JSON, keyed, `load()`/`save()`).

```typescript
type UnitStatus = 'submitted' | 'reviewing' | 'queued' | 'approved' | 'changes_requested' | 'addressing' | 'done';
type Decision = { kind: 'approved' | 'changes_requested'; concerns?: ResolveItem[]; note?: string };
type ReviewUnit = {
  unitId: string; repo: string; worktreePath: string;
  taskLabel: string; intent: string; uncertainties: string[];
  baseRef: string; diffContentKey: string;
  status: UnitStatus; toResolve: number;
  brief?: WalkthroughModel;          // Phase 1 output
  decision?: Decision;
  createdAt: string; updatedAt: string;
};

class UnitStore {                    // file: ~/.cache/diffdad/units/<repo>-<unitId>.json
  add(input): ReviewUnit;            // status='submitted'
  setReviewing(id): void;
  setQueued(id, brief, toResolve): void;
  setDecision(id, decision): void;   // approved | changes_requested
  list(filter?: { status?; repo? }): ReviewUnit[];
}
```

**Key decisions**:
- Keyed by `repo + unitId` so the queue is genuinely cross-repo.
- Transitions are validated against the state machine (`submitted → reviewing → queued → {approved | changes_requested} → …`); an illegal jump throws (typed error, mapped by the MCP layer).
- Single-process synchronous mutations + `save()` after each — no real concurrency in Bun's loop (same reasoning as `agent-comments`).

**Feedback loop**:
- **Playground**: `store.test.ts`, fixture-prefixed key, cleaned in `afterEach`.
- **Experiment**: `submit → reviewing → queued → approved`; an illegal transition (`submitted → approved`) throws; reload from disk and assert equality.
- **Check command**: `cd packages/cli && npx vitest run src/units/__tests__/store.test.ts`.

### 2. `submit_for_review` + `await_decision` (MCP)

**Pattern to follow**: `packages/cli/src/mcp/tools.ts` (`registerTool`, closure over store + `broadcast`).

```typescript
// submit_for_review({ taskLabel, intent, uncertainties, repo, worktreePath, baseRef? }) → { unitId }
//   store.add(...) → buildLocalReview(worktreePath, baseRef) → enqueue for the review worker → return unitId
// await_decision({ unitId }) → { decision, concerns?, note? }
//   long-poll: resolve once the unit has a decision; bounded timeout the agent re-calls
```

**Key decisions**:
- `submit_for_review` returns immediately; the review runs async in the worker pool.
- `await_decision` is the FIX/approve channel; the existing `list_review_comments`/`reply_to_comment`/`resolve_comment` still serve per-concern threads.
- The agent stays connected on `await_decision` for its `unitId`.

**Feedback loop**:
- **Playground**: `mcp-submit.test.ts` driving the tool handlers in-process (pattern: `mcp-tools.test.ts`).
- **Experiment**: `submit_for_review` returns a `unitId` and the unit appears in `store.list()`; set a decision; `await_decision` returns it; unknown id → structured error.
- **Check command**: `cd packages/cli && npx vitest run src/__tests__/mcp-submit.test.ts`.

### 3. The daemon

**Pattern to follow**: `packages/cli/src/server.ts` (Hono app, SSE spine, `mountMcp`).

**Overview**: One long-lived Bun process. Owns the `UnitStore`; serves the command center at `/`, the units API, the MCP endpoint, and per-unit review (reuse Phase 1's review view, scoped by unit). A bounded review-worker pool (default 3–4, configurable) runs Phase 1's narrative→walkthrough pipeline per submitted unit → `setQueued(brief, toResolve)` → SSE broadcast.

**Key decisions**: generalize `server.ts`'s routes to be unit-scoped; the worker pool bounds cost/rate (excess units stay `submitted`, processed as slots free); reuse the existing SSE spine for live dashboard updates.

### 4. Command center UI

**Pattern to follow**: `WatchView.tsx` (self-contained shell) + the approved mockup.

**Overview**: Rows from `/api/units` grouped by status. **Needs-you**: recommended action + `toResolve` + checks. **In-flight**: agent units + working trees + open PRs, with live status + elapsed. **Cleared**: digest. Click a row → Phase 1's review view for that unit.

**Key decisions**: status-grouping primary (repo as a filter, per your call); recommended action derived from the brief's verdict + `toResolve`; live via SSE.

### 5. launchd terminal-survival (hardening — last)

**Pattern to follow**: none in repo (net-new).

**Overview**: Generate a per-user LaunchAgent plist; `dad daemon install` loads it (`launchctl`); the daemon survives terminal close and restarts on login. `dad daemon status/uninstall`.

**Key decisions**: bind a stable port; idempotent install; single-instance guard. Highest-risk slice — done only after the in-terminal daemon works.

**Feedback loop**:
- **Experiment**: `launchctl load`; close the launching terminal; `curl -s localhost:<port>/api/units` returns units submitted from two repos.

## Data Model

### State Machine

```
submitted → reviewing → queued → { approved | changes_requested }
changes_requested → addressing → (re-submit) → reviewing → …
approved → done   (agent opens the PR; Phase 4)
```

Persistence: `~/.cache/diffdad/units/<repo>-<unitId>.json` (pattern: `agent-comments`).

## API Design

### New Endpoints

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET`  | `/api/units` | List units (filter by `status`/`repo`). |
| `GET`  | `/api/units/:id` | One unit + its brief. |
| `POST` | `/api/units/:id/decision` | Record the decision (approve / changes_requested + curated concerns) → delivered to the agent via `await_decision`. |
| MCP    | `submit_for_review`, `await_decision` | (+ the existing three comment tools). |

## Testing Requirements

### Unit Tests

| Test File | Coverage |
| --------- | -------- |
| `packages/cli/src/units/__tests__/store.test.ts` | Lifecycle, transition validation, persistence round-trip. |
| `packages/cli/src/__tests__/mcp-submit.test.ts` | submit → unitId, decision round-trip, unknown-id error. |
| `packages/cli/src/__tests__/units-routes.test.ts` | `GET /api/units`, `POST /api/units/:id/decision` via `app.request()`. |

### Integration / Manual

- [ ] `dad daemon`; `submit_for_review` from repo A and repo B → both appear in `/api/units` and the command center.
- [ ] Approve one → that unit's `await_decision` returns `approved`.
- [ ] `dad daemon install`; close the terminal; daemon stays up and serves the queue.

## Error Handling

| Error Scenario | Handling Strategy |
| -------------- | ----------------- |
| Submit against a clean tree | Friendly no-op; no unit created. |
| `await_decision` times out | Agent re-calls (documented); decision persisted, never lost. |
| Daemon crash/restart | Units persisted; reload on start; in-flight reviews re-queued. |
| launchd plist fails to load | Clear error; daemon still runnable from a terminal. |
| Worker pool saturated | Excess units stay `submitted`, processed as slots free; log the backlog. |

## Failure Modes

| Component | Failure Mode | Trigger | Impact | Mitigation |
| --------- | ------------ | ------- | ------ | ---------- |
| UnitStore | Lost unit | Concurrent route + MCP write same tick | A mutation clobbers another | Single-process synchronous mutations + `save()` per change (no real concurrency). |
| Daemon | Two instances | launchd + a manual `dad daemon` | Port conflict / split queue | Single-instance guard (pidfile/port check). |
| Review worker | Stuck `reviewing` | Pipeline throws mid-review | Unit never queues | Wrap worker; on failure set `queued` with an error brief so it still reaches Nick. |
| await_decision | Agent never parks | Agent exits after submit | FIX can't be delivered | Persist the decision; on reconnect the agent re-calls `await_decision` (Phase 6 re-spawn is the deeper fallback, out of this phase). |

## Validation Commands

```bash
bun run typecheck
bun run lint
cd packages/cli && npx vitest run
cd packages/web && npx vitest run
bun run build
dad daemon status
```

## Open Items

- [ ] Decision delivery mechanics: long-poll `await_decision` vs short-poll `check_decision` — long-poll is simpler for the agent; short-poll is robust to HTTP timeouts. Settle during the MCP tool build.
- [ ] Daemon ↔ per-unit review: one multiplexed Hono app vs a sub-server per unit — resolve when generalizing `server.ts`.
- [ ] Single-instance guard + stable-port strategy for launchd vs manual launches.

---

_This spec is ready for implementation. Follow the patterns and validate at each step._
