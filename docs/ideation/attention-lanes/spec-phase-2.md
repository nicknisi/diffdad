# Implementation Spec: Attention Lanes - Phase 2

**Contract**: ./contract.md
**Design reference**: ./mockup.html — open it. Row anatomy, the evidence drawer, lane copy, and the before/after contrast are all settled there; this spec describes the same thing in prose but the mockup is the artifact to match.
**Estimated Effort**: S

## Technical Approach

This phase is **rendering only**. Phase 1 assigned every unit a lane; phase 2 shows it. The single most important constraint: the web package must **never recompute a lane**. `laneOf` is CLI-side by decision, because the daemon's lane-split log and the browser's lane labels are two consumers of one rule, and two implementations would drift — corrupting the data the two-week judgment (G7) rests on. If phase 2 needs a lane, it reads the one the server sent.

The change to `units-view.ts` is smaller than it looks. `groupUnits` today partitions on `groupOf(status)` into three buckets. It gains a fourth bucket by partitioning on the unit's server-assigned lane instead, with `groupOf` retained for units that predate the field. The existing `in-flight` and `cleared` lanes are untouched — the contract explicitly excludes restructuring them, since `changes_requested` already means the ball is with the author and was never part of the stated problem.

The row is where the visible work is. Today `UnitRow` leads with a verdict glyph that is a grey bullet for every unopened PR, and prints `${unit.toResolve} to resolve` where `toResolve` is the `0` it was initialised to at `store.ts:146` — a placeholder rendered as a measurement. Both go. The row leads with the evidence reason instead, and sizes itself by stakes so a four-line typo fix and a nine-hundred-line auth refactor stop rendering identically.

## Decisions Considered and Rejected

_Carried from the contract; consult before making gap decisions._

- **The lane function lives CLI-side and phase 1 owns it** — rejected: defining it web-side in `units-view.ts` alongside `groupUnits`. Phase 1 logs lane splits while phase 2 renders them; two implementations of one rule would drift and corrupt G7's data.
- **One new lane, inserted into the existing three** — rejected: a two-lane model replacing the current grouping, and a four-attention-lane taxonomy. Keeping `In flight` untouched is both the smallest diff and the honest state.
- **Restructuring the In flight or Cleared lanes** — rejected. `changes_requested` already leaves the actionable queue.
- **Rows sized by stakes, leading with the reason, `0 to resolve` removed** — the placeholder asserts a measurement never taken. Row weight is covered by the judgment criterion so it can be neither silently dropped nor silently expanded into a full visual redesign.
- **`✕` soft-deletes with a dismissal SHA** — rejected: a permanent dismissal and a dedicated Dismissed tab. Dismiss-until-push self-clears, so the UI needs only a count and a reveal, not an un-dismiss flow.
- **Archived PRs are filtered silently** — rejected: a filtered-count note. There is no action available on a read-only repo.
- **The lane is advisory; the gate was strict** — the approve button is out of v1 entirely. "Probably not" must never render anything that reads as a safety claim.
- **Gate and lane evidence quantifies over the PR's file list** — rejected: quantifying over narrative chapters. This is why the drawer can list every file: the evidence _is_ the file list.

## Feedback Strategy

**Inner-loop command**: `bun run --filter '@diffdad/web' test -- -t "lane"`

**Playground**: Vitest over `units-view.ts`, plus `bun run dev` for the visual pass against `mockup.html`.

**Why this approach**: The grouping and reason-line logic are pure functions over `Unit[]`, so they are fully testable with no DOM. Only the visual weight and spacing need the dev server, and the mockup is the reference to diff against by eye.

**Test environment constraint** — read before adding any test: vitest's environment is deliberately `node` (`packages/web/vite.config.ts:22`), because `state/__tests__/durable-review-state.test.ts` shims `globalThis.localStorage`, which a DOM environment owns as a read-only accessor. A test needing a real DOM opts in **per file** with `// @vitest-environment happy-dom` — **happy-dom, not jsdom**; jsdom is not a dependency and a spec followed verbatim with it would fail at test time. **Do not flip the global default.** The lane tests in this phase are pure and need no DOM at all.

## File Changes

### New Files

None.

### Modified Files

| File Path                                           | Changes                                                                                                                                                                                                                                |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/cli/src/daemon/app.ts`                    | Extend `unitsPayload()` to attach `lane: laneOf(unit)` to every emitted unit — the browser cannot import the lane function across the package boundary, so the server has to send the answer. |
| `packages/cli/src/daemon/poller.ts`                 | Same attachment on the post-pass broadcast, so a row's lane does not depend on which message painted it. |
| `packages/web/src/state/types.ts`                   | Add `lane?`, `triage?`, `dismissedAtSha?`, `reviewRollup?` to the web `Unit` mirror, matching the CLI shape. Add the `Lane` union.                                                                                                              |
| `packages/web/src/lib/units-view.ts`                | `groupUnits` partitions on the server-assigned lane into four buckets; add `reasonLine(unit)` and `stakesOf(unit)`; extend the needs-you sort with the review rollup; filter dismissed units out of every lane and return their count. |
| `packages/web/src/components/UnitRow.tsx`           | Lead with the reason line, not the verdict glyph; remove the `to resolve` placeholder; size by stakes; add the expandable evidence drawer; `✕` tooltip says "Dismiss until they push".                                                 |
| `packages/web/src/components/CommandCenter.tsx`     | Render four lanes; add the dismissed count + reveal beside Cleared; keep the existing loading/empty/error branches.                                                                                                                    |
| `packages/web/src/lib/__tests__/units-view.test.ts` | Lane partitioning, reason lines, sort with rollup, dismissed filtering.                                                                                                                                                                |

### Deleted Files

None.

## Implementation Details

### 1. `units-view.ts` — partition, reason, sort

**Pattern to follow**: the existing `groupUnits` / `groupOf` pair in the same file — keep the same shape, widen the result.

```typescript
export type GroupedUnits = {
  needsYou: Unit[];
  probablyNot: Unit[]; // new
  inFlight: Unit[];
  cleared: Unit[];
  dismissedCount: number; // not a lane — a count behind a reveal
};

/** The one line under the title. Derived from triage, never from a narrative. */
export function reasonLine(unit: Unit): string;

/** Visual weight only. Never affects lane membership. */
export function stakesOf(unit: Unit): 'high' | 'mid' | 'low';
```

**Key decisions**:

- **Read the lane, don't compute it — and phase 1 did not put one on the wire.** Raised by the phase-1 reviewer and settled here rather than at the keyboard: payload units carry `status` and `triage`, not a computed lane. The web package cannot import `units/lane.ts` (the same package boundary that forced `web/src/lib/collapse.ts` to keep a local copy of `narratedDiffLines`), so importing the pure function cross-package is not an option. **The server must attach it.** Extend phase 1's `unitsPayload()` helper in `daemon/app.ts` to map each unit to `{ ...unit, lane: laneOf(unit) }`, and do the same in the poller's post-pass broadcast — every emission point, or a row's lane changes depending on which message painted it. This is a small phase-1-side change made in phase 2, and it is the correct place for it: it exists only because the browser needs it.
- **Fall back when the lane is absent.** A payload from an older daemon carries no `lane`; use today's `groupOf(status)` so the queue degrades to current behavior rather than to an empty screen.
- **`reasonLine` states facts, never judgments.** Criticality tags render as tags (`auth`, `session`); a fully-mechanical PR renders its kind summary (`docs only`, `lockfile + manifest`, `tests only`); truncation renders `over 100 files`. It must never say "safe", "fine", or "approved".
- **Sort within `needs-you`**: criticality present first, then units where nobody has approved ahead of units where someone has (`reviewRollup.approved === 0` first), then oldest-first. The existing oldest-first tiebreak is retained — the queue should still pull toward stale work.
- **`probably-not` sorts oldest-first only.** Ranking within a lane you are being told not to read is wasted signal.
- **Dismissed units are filtered from every bucket** and surface only as `dismissedCount`.

**Feedback loop**:

- **Playground**: `packages/web/src/lib/__tests__/units-view.test.ts`, which already holds 36 passing tests over this module.
- **Experiment**: a fixture queue of eight units covering all four lanes plus one dismissed; assert bucket membership, that `probablyNot` is non-empty, that the dismissed unit appears in no bucket, and that a unit with `triage: undefined` lands in `needsYou` via the `groupOf` fallback.
- **Check command**: `bun run --filter '@diffdad/web' test -- -t "lane"`

### 2. `UnitRow.tsx` — reason-led rows

**Pattern to follow**: the current `UnitRow` structure — a single full-width button as the click target, `SOURCE_TONE`-style records for tone lookup, colors only via CSS custom properties.

**Key decisions**:

- **Delete the `to resolve` meta entry** (`UnitRow.tsx:51`). It renders `0` for every unhydrated unit. Nothing replaces it; the reason line carries the information now.
- **The lead glyph stays but stops being the signal**: `▲` for needs-you, `○` for probably-not, existing status glyphs for the other two. The reason line does the work.
- **Stakes sizing is typography and padding only** — `high` gets a larger, heavier title; `low` gets tighter vertical padding. No color changes, no icons, no layout reflow. This is the boundary that keeps "rows sized by stakes" from becoming a visual redesign, which two critics flagged as the risk.
- **The evidence drawer** expands inline beneath the row and lists every file with its kind, then one plain sentence. It is the trust mechanism: "Probably not" must always be auditable in one click, never a claim to be taken on faith. See `mockup.html` for the exact anatomy.
- **`✕` tooltip** becomes "Dismiss until they push" — the behavior changed in phase 1 and the affordance must say so.

**Feedback loop**:

- **Playground**: `bun run build && bun packages/cli/src/cli.ts daemon --port=45677 --no-open`, then compare against `mockup.html` side by side.
- **Experiment**: render the queue at both themes and at a narrow viewport; confirm the reason line wraps rather than truncating, and that a 39-file reason line does not push the row to three lines.
- **Check command**: `bun run --filter '@diffdad/web' test -- -t "reason"`

### 3. `CommandCenter.tsx` — four lanes

**Key decisions**:

- Insert `Probably not` **between** `Needs you` and `In flight`. Reuse the existing `GroupLabel` and `Panel` components unchanged.
- The lane header carries a short subtitle stating the rule (`every file classified mechanical · no criticality keyword`) — the rule is the product, so it should be visible without opening a row.
- The dismissed count sits beside `Cleared` with a `show` toggle, matching the existing `showCleared` pattern exactly.
- **Nothing renders for archived PRs** — no note, no count. They never reach the client.
- `Probably not` renders nothing at all when empty. An empty lane with a "0" is chrome.

**Feedback loop**:

- **Playground**: `bun run build` then the daemon on a scratch port per the repo's `verify` skill, with `mockup.html` open in a second tab.
- **Experiment**: render four states — a queue with all four lanes populated; one with `probablyNot` empty (assert the lane header is absent, not zeroed); one with only dismissed units; and the existing cold-start loading branch — confirming none of the pre-existing loading/empty/error branches regressed.
- **Check command**: `bun run --filter '@diffdad/web' test -- -t "command center"`

## Testing Requirements

### Unit Tests

| Test File                                           | Coverage                                                                                                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/web/src/lib/__tests__/units-view.test.ts` | Four-way partitioning; `groupOf` fallback for lane-less units; dismissed filtering and count; `reasonLine` text per kind; `stakesOf`; needs-you sort with the review rollup. |

**Key test cases**:

- Eight-unit fixture queue → correct bucket for each; `probablyNot` non-empty (a degenerate implementation must fail).
- A unit with no lane and no `triage` → `needsYou` via fallback, never dropped.
- A dismissed unit appears in no bucket and increments `dismissedCount`.
- Two otherwise-identical needs-you units, one with `reviewRollup.approved === 2` → it sorts second.
- `reasonLine` for: docs-only, lockfile+manifest, tests-only, criticality-tagged, truncated.
- No rendered row contains the string `to resolve`.

### Manual Testing

- [ ] `bun run build`, run the daemon, compare the live queue against `mockup.html` in both themes.
- [ ] Confirm no row shows "0 to resolve".
- [ ] Click a "Probably not" row; confirm the drawer lists every file and the sentence reads as a fact, not a recommendation.
- [ ] `✕` a row; confirm it leaves every lane and the dismissed count increments.

## Failure Modes

| Component       | Failure Mode            | Trigger                                                   | Impact                                                                                           | Mitigation                                                                                           |
| --------------- | ----------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `groupUnits`    | Lane drift              | A future edit recomputes the lane client-side             | Browser and daemon log disagree; G7's data becomes unreliable                                    | Read the server field only; a comment at the partition site states why, citing the contract decision |
| `groupUnits`    | Empty queue on old data | Units predate phase 1's backfill                          | Reviewer sees nothing where work exists                                                          | `groupOf(status)` fallback, tested explicitly                                                        |
| `reasonLine`    | Overclaiming            | Copy drifts toward "safe"/"fine"                          | The advisory lane reads as a safety claim, which the approve-button decision explicitly rejected | Test asserts the rendered strings; reviewer checks copy against the mockup                           |
| Stakes sizing   | Layout thrash           | A long title at `high` stakes beside a one-line `low` row | Scan rhythm breaks; the lane is harder to read than a uniform list                               | Typography + padding only; verify at narrow viewport before merging                                  |
| Evidence drawer | Unbounded height        | A 100-file PR (`truncated`) expands to a wall of paths    | Drawer dominates the page                                                                        | Cap the visible list and state the remainder (`…and 61 more`)                                        |

## Validation Commands

```bash
bun run typecheck
bun run lint
bun run format:check
bun run --filter '@diffdad/web' test -- -t "lane render"
bun run test
bun run build
```

## Rollout Considerations

- **Feature flag**: none. Additive, with a fallback to current behavior for lane-less units.
- **Rollback plan**: revert the branch. Phase 1's fields are optional and ignored by an older frontend.
- **Note**: `bun run build` is required before the daemon serves the new UI — the server reads `packages/web/dist`, and a stale bundle presenting a new backend is a failure mode this project has hit twice before.

## Open Items

None.

---

_This spec is ready for implementation. Follow the patterns and validate at each step._
