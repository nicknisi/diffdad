# Implementation Spec: Review Triage - Phase 4

**Contract**: ./contract.md
**Estimated Effort**: S

## Technical Approach

`expectedHotspots` is declared on every fixture — `auth-token-validation.ts:197`, `cache-race-condition.ts:114`, `migration-without-rollback.ts:105`, and `safe-rename.ts:113` with an empty array — and read by nothing. Meanwhile the only ranking check the harness performs, `chaptersOrderedByRisk` at `judge.ts:215`, asserts that risk labels are non-increasing, which a narrative labelling every chapter `low` passes. The harness currently cannot tell a good triage from a lazy one.

This phase wires the dead field in. Hotspot scoring is deliberately **deterministic**, not LLM-judged: given a narrative, a fixture's `expectedHotspots`, and the collapse decisions from Phase 2, whether a hotspot landed in an expanded chapter is a set membership question. That keeps it testable with no provider and no tokens, which matters because this phase's own acceptance check is a unit test while the harness it feeds is a manual probe.

Line compression is explicitly **not** added here. The Phase 2 collapse test already measures it deterministically and for free on the same fixture. Re-implementing it inside a provider-backed run would grow `EvalRun` and `Baseline.aggregate` for a number no success criterion reads.

One structural change is required rather than optional: `aggregate` is module-private at `run.ts:130`, so a unit test cannot assert that the new field reaches the aggregate. It has to be exported. Without that export the criterion "reports it per run" is only half-checked, which was called out at contract review.

## Decisions Considered and Rejected

_Carried from the contract; consult before making gap decisions._

- **The hard gate is a unit test over a pure selection function; the eval harness is a manual probe** — rejected: asserting on the eval baseline as the blocking gate. A gate that needs a configured provider and spends tokens per run gets disabled, and then there is no gate at all. This phase builds the probe, and the probe is allowed to require a provider precisely because nothing blocks on it.
- **Author the large fixture and all recorded narratives in the phase that owns the safety gate** — rejected: authoring them here. That circularity is why fixture work moved to Phase 2; this phase consumes what Phase 2 registered and must not re-author it.
- **Drop line compression from `EvalRun` and the aggregate** — rejected: reporting it in both places. The deterministic collapse test already measures it on the same fixture; a second implementation inside a token-spending probe reports a number no criterion reads.
- **Measure compression in narrated diff lines** — rejected: chapter counts. Relevant here only as the reason line compression stays in Phase 2 rather than moving into the harness.

## Feedback Strategy

**Inner-loop command**: `bun test packages/cli/src/__tests__/eval-judge.test.ts`

**Playground**: The Bun test suite over the recorded narratives Phase 2 committed. Hotspot placement is a pure function, so the whole loop runs offline against fixed JSON.

**Why this approach**: The scoring logic is a data layer with no I/O and no model call; the only part that needs a provider is the surrounding harness, which is not what this phase's checks assert.

## File Changes

### New Files

| File Path                                       | Purpose                                                                     |
| ----------------------------------------------- | --------------------------------------------------------------------------- |
| `packages/cli/src/__tests__/eval-judge.test.ts` | Hotspot placement scoring, the not-applicable case, and aggregate reporting |

### Modified Files

| File Path                        | Changes                                                                                                                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/cli/src/eval/judge.ts` | Add `scoreHotspotPlacement(narrative, fixture, collapse)`, a pure function alongside the existing LLM-backed `scoreNarrative` and `scoreDefectDetection`                                                                             |
| `packages/cli/src/eval/types.ts` | Add `HotspotPlacementResult` and a `hotspotPlacement` field on `EvalRun`; add `avgHotspotPlacement` to `Baseline.aggregate`. Phase 2 already extended this file with `recordedNarrativePath` — read its current shape before editing |
| `packages/cli/src/eval/run.ts`   | Export `aggregate`; call `scoreHotspotPlacement` in `runOne`; include the new field in the written baseline and in the console summary                                                                                               |

## Implementation Details

### Hotspot placement scoring

**Pattern to follow**: `packages/cli/src/eval/judge.ts:195-228` — `countProseWords` and `chaptersOrderedByRisk` are the existing pure, exported, non-LLM scorers in this file, and this belongs beside them rather than beside the two `callAi` functions.

**Overview**: For each expected hotspot file, determine whether the narrative surfaced it and whether it survived collapse.

```typescript
export type HotspotPlacement = {
  file: string;
  /** Some chapter's diff sections reference this file. */
  covered: boolean;
  /** Covered AND the covering chapter is not collapsed. */
  expanded: boolean;
  /** 0-based index of the first chapter referencing it; null when uncovered. */
  chapterIndex: number | null;
};

export type HotspotPlacementResult = {
  /** 'n/a' when the fixture declares no hotspots. */
  status: 'scored' | 'n/a';
  placements: HotspotPlacement[];
  /** Count of hotspots in expanded chapters, over the count declared. */
  expandedOf: { expanded: number; total: number };
};

export function scoreHotspotPlacement(
  narrative: NarrativeResponse,
  fixture: EvalFixture,
  collapse: CollapseResult,
): HotspotPlacementResult;
```

**Key decisions**:

- **Deterministic, no `callAi`.** Set membership over normalized paths, so it costs nothing and never flakes. The LLM judge stays responsible for prose quality, which is what a model is actually needed for.
- **`safe-rename` declares an empty `expectedHotspots`.** That is `status: 'n/a'`, never a zero score. Counting a fixture with no hotspots as a total miss would drag the aggregate down for a fixture that is behaving correctly, and the aggregate must skip `n/a` runs rather than average them in as zero.
- **`covered` and `expanded` are separate booleans.** They fail differently: uncovered means the narrative never mentioned the file, expanded-false means it mentioned it and then hid it. The second is the failure this project exists to prevent, and collapsing them into one number would hide which happened.
- **Path comparison uses the existing `normalizePath` rules.** Fixture ground truth, diff parser output, and narrative sections have all disagreed about `a/` and `b/` prefixes before; this is the codebase's standing trap.

**Implementation steps**:

1. Write `eval-judge.test.ts` with a `describe` block and one smoke test asserting an empty `expectedHotspots` yields `status: 'n/a'`, before touching `judge.ts`.
2. Implement `scoreHotspotPlacement` over normalized paths.
3. Add the types to `eval/types.ts`.
4. Call it from `runOne` and include it in `EvalRun`.
5. Export `aggregate`, add `avgHotspotPlacement` skipping `n/a` runs, and print it in the console summary.

**Feedback loop**:

- **Playground**: `packages/cli/src/__tests__/eval-judge.test.ts` over Phase 2's committed recordings.
- **Experiment**: Score `auth-token-validation` with `collapse` empty (hotspot expanded), with a synthetic decision collapsing the hotspot's chapter (expanded false, covered true), with the hotspot file removed from every chapter (covered false, `chapterIndex` null), and `safe-rename` (`status: 'n/a'`). Then aggregate a run set mixing `scored` and `n/a` and assert the `n/a` run is skipped rather than counted as zero.
- **Check command**: `bun test packages/cli/src/__tests__/eval-judge.test.ts`

### Harness reporting

**Overview**: Surface the new number where a human running the probe will actually read it.

**Key decisions**:

- Print per-fixture in the console summary, not only in the baseline JSON. The probe is run by hand after a prompt change and the answer should be visible without opening a file.
- `avgHotspotPlacement` is the fraction of scored hotspots that landed in expanded chapters, over runs with `status: 'scored'` only.
- No thresholds and no exit-code behavior. This phase reports; nothing here gates a build. The judgment criterion is Nick reading the output.

**Implementation steps**:

1. Add the field to `Baseline.aggregate`.
2. Skip `n/a` runs in the average.
3. Extend the console summary line.

## Testing Requirements

### Unit Tests

| Test File                                       | Coverage                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `packages/cli/src/__tests__/eval-judge.test.ts` | Placement scoring across covered/expanded/uncovered, the `n/a` case, and aggregate skipping |

**Key test cases**:

- Hotspot in an expanded chapter → `covered: true, expanded: true`, `chapterIndex` set.
- Hotspot in a collapsed chapter → `covered: true, expanded: false`. This is the case the whole project guards against, and the harness must be able to see it.
- Hotspot in no chapter → `covered: false, expanded: false, chapterIndex: null`.
- Empty `expectedHotspots` → `status: 'n/a'` with empty placements.
- `aggregate` over a mixed run set skips `n/a` rather than averaging it as zero.
- Paths differing only by an `a/` or `b/` prefix still match.

### Manual Testing

- [ ] `bun run eval` with a configured provider; confirm per-fixture hotspot placement prints and lands in the baseline
- [ ] `bun run eval --fixture=large-refactor`; confirm the 40+ file fixture registered in Phase 2 actually runs

## Failure Modes

| Component         | Failure Mode           | Trigger                                                                 | Impact                                                             | Mitigation                                                                            |
| ----------------- | ---------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Placement scoring | Path mismatch          | Ground truth, diff parser, and narrative disagree on `a/`/`b/` prefixes | Every hotspot reads as uncovered and the metric is uniformly wrong | Normalize both sides with the existing `normalizePath`; the prefix test pins it       |
| Placement scoring | `n/a` averaged as zero | `safe-rename` counted as a total miss                                   | Aggregate drags down for a fixture behaving correctly              | Skip `status: 'n/a'` in the aggregate; the mixed-run-set test pins it                 |
| Aggregate         | Unreachable from tests | `aggregate` left module-private at `run.ts:130`                         | The "reports it per run" criterion is only half-checked            | Export it; this is a requirement, not a preference                                    |
| Harness           | Fixture never runs     | `large-refactor` missing from the hand-maintained `FIXTURES` array      | The one fixture the project exists for is silently excluded        | Phase 2 registers it; assert `FIXTURES` contains it here as a cheap cross-phase guard |

## Validation Commands

```bash
bun test packages/cli/src/__tests__/eval-judge.test.ts
bun run test
bun run typecheck
bun run lint
```

## Open Items

_None._

---

_This spec is ready for implementation. Follow the patterns and validate at each step._
