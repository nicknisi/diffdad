# Implementation Spec: Review Triage - Phase 2

**Contract**: ./contract.md
**Estimated Effort**: L

## Technical Approach

This phase owns the safety-critical decision: which chapters disappear from view. The whole design exists to make that decision cheap to verify, so the core is a pure function — `selectCollapsible(chapters, risks, repoContext)` — with no I/O, no async, and no model call. Everything it needs is already computed by the time a narrative is served.

Collapse is computed at serve time and never persisted. This is not a style preference. `narrativeCachePath()` keys on `{owner}-{repo}-{number}-{sha}-{metaHash}.v3.p{rev}-{rev}.{provider}` and carries no component describing repo state, so a narrative generated while repo context was unavailable would cache with nothing collapsed, and every later request at that same SHA — including ones where the snapshot is now warm — would hit that cache and still collapse nothing. Persisting the decision would bake a silent, permanent failure into the exact scenario the feature is for.

Chapters are not reordered. `prompt.ts:229` already instructs the model to order by risk descending with mechanical changes last, and `eval/judge.ts:215` already asserts it. Collapse happens in place: mark the chapters the evidence supports, draw one divider before the first collapsed chapter, and leave the sequence alone. A reordering pass over a list capped at seven would duplicate behavior the pipeline already performs.

The phase also authors its own test inputs, which is unusual and deliberate. `selectCollapsible` needs chapters; `EvalFixture` carries `pr`, `files`, `fileTree`, and `groundTruth` and no narrative. Three critics independently found the same circularity in the original plan, where the fixture that the compression gate measures was authored in a later phase that listed this one as its prerequisite. The gate and its inputs ship together or the gate is vacuous.

Finally, `PromptCapStats` is plumbed out here rather than in Phase 3. `runPlanner` returns `{plan, provider, usage}` and `NarrativeGenerationResult` is `{narrative, provider}`, so the stats are computed and dropped. Phase 3 is forbidden from editing `narrative/` internals, so the plumbing has to exist before it runs.

## Decisions Considered and Rejected

_Carried from the contract; consult before making gap decisions._

- **Compute collapse state at serve time and never persist it** — rejected: carrying collapse fields through the narrative cache and normalization. `narrativeCachePath()` has no repo-state component, so a narrative generated while context was unavailable would keep collapsing nothing at that SHA forever, silently defeating the safety and compression goals.
- **Collapse chapters in place, in the order the model already produced** — rejected: a separate ranking pass that reorders chapters before drawing the boundary. `prompt.ts:229` already instructs risk-descending order with mechanical changes last, and `chaptersOrderedByRisk` asserts it.
- **Collapse engages only when positive evidence exists for that chapter** — rejected: always rendering the boundary, and gating additionally on PR size. `readingPlan` was pulled from the UI for being always-on meta-output that usually said nothing; a size threshold adds a number to tune without adding safety.
- **Author the large fixture and all recorded narratives in the same phase that owns the safety gate** — rejected: tiering the large fixture as Full and authoring it in a later, non-blocking phase. The gate needs chapters, `EvalFixture` carries none, and the only planned recorded narrative lived in a phase that listed the gate's phase as its prerequisite.
- **The hard gate is a unit test over a pure selection function; the eval harness is a manual probe** — rejected: asserting on the eval baseline as the blocking gate. A gate that needs a configured provider and spends tokens per run gets disabled, and then there is no gate at all.
- **Measure compression in narrated diff lines** — rejected: percentage of chapters collapsed. Chapter counts are gameable by collapsing many tiny chapters while the two open ones still hold most of the code.
- **Guard every name-filtered test command with a pass-count check** — rejected: bare `bun test <file> -t <name>`. A `-t` filter matching nothing exits 0, so three goals hung on checks that pass whether or not the test was ever written.

## Feedback Strategy

**Inner-loop command**: `bun test packages/cli/src/__tests__/collapse.test.ts`

**Playground**: The Bun test suite over committed recorded narratives. `selectCollapsible` is pure, so the loop is a function call against fixed JSON — the fastest possible cycle, with no network, no provider, and no server.

**Why this approach**: The component under development is the one with the highest consequence and the lowest I/O, which is the ideal shape for a test-driven loop. Every safety property is expressible as an assertion over a committed input.

## File Changes

### New Files

| File Path                                                                           | Purpose                                                                                                       |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `packages/cli/src/narrative/collapse.ts`                                            | `selectCollapsible` and its supporting evidence types; pure, sync, no imports from `engine` or `server`       |
| `packages/cli/src/eval/fixtures/large-refactor.ts`                                  | 40+ file fixture with ground-truth hotspots, the case that motivated the project                              |
| `packages/cli/src/eval/fixtures/recorded/auth-token-validation.narrative.json`      | Recorded narrative for the existing fixture                                                                   |
| `packages/cli/src/eval/fixtures/recorded/cache-race-condition.narrative.json`       | Recorded narrative for the existing fixture                                                                   |
| `packages/cli/src/eval/fixtures/recorded/migration-without-rollback.narrative.json` | Recorded narrative for the existing fixture                                                                   |
| `packages/cli/src/eval/fixtures/recorded/safe-rename.narrative.json`                | Recorded narrative; this fixture declares an empty `expectedHotspots`, so it is the everything-collapses case |
| `packages/cli/src/eval/fixtures/recorded/large-refactor.narrative.json`             | Recorded narrative for the large fixture; the compression gate's only input                                   |
| `packages/cli/src/__tests__/collapse.test.ts`                                       | The hard gate: `safety`, `evidence`, `unavailable`, and `compression`                                         |

### Modified Files

| File Path                                 | Changes                                                                                                                                                                                             |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/cli/src/narrative/types.ts`     | Add the `CollapseDecision` type and the response-level `collapse` block; do **not** add fields to `NarrativeChapter` or touch `normalizeNarrative`, since nothing here is serialized into the cache |
| `packages/cli/src/narrative/planner.ts`   | Return `stats` alongside `{plan, provider, usage}` from `runPlanner`                                                                                                                                |
| `packages/cli/src/narrative/engine.ts`    | Add `capStats` to `NarrativeGenerationResult`, populated on both the single-pass and two-pass paths                                                                                                 |
| `packages/cli/src/eval/types.ts`          | Add an optional `recordedNarrativePath` to `EvalFixture` so tests and the harness resolve recordings the same way                                                                                   |
| `packages/cli/src/eval/fixtures/index.ts` | Register `large-refactor` in the hand-maintained `FIXTURES` array; without this the fixture never runs and the safety gate silently excludes the one fixture the project exists for                 |

## Implementation Details

### selectCollapsible

**Pattern to follow**: `packages/cli/src/narrative/risk.ts` — a pure module over diff data with no I/O, exercised entirely from `risk.test.ts`.

**Overview**: Given a narrative's chapters, per-file risk signals, and repo context, decide which chapters collapse and why.

```typescript
export type CollapseEvidence =
  | { kind: 'no-external-callers'; file: string; knownCallers: 0 }
  | { kind: 'test-only'; files: string[] }
  | { kind: 'generated'; files: string[] };

export type CollapseDecision = {
  /** Index into narrative.chapters. */
  chapterIndex: number;
  /** One line, shown on the collapsed row. Must state the fact, not a judgment. */
  reason: string;
  evidence: CollapseEvidence;
};

export type CollapseResult =
  | { available: true; decisions: CollapseDecision[]; dividerBefore: number | null }
  // Phase 1 shipped a fourth reason, 'empty-tree' (a successful fetch whose tree indexed zero source
  // files), because the failure-modes table required `filesScanned === 0` to map to unavailable. Mirror
  // the union from `RepoContext` rather than restating three members, and cover the case in the renderer.
  | { available: false; reason: 'size-cap' | 'fetch-failed' | 'extract-failed' | 'empty-tree' };

export function selectCollapsible(chapters: NarrativeChapter[], risks: FileRisk[], repo: RepoContext): CollapseResult;
```

**Key decisions**:

- **Unavailable short-circuits before any evidence is considered.** When `repo.available === false`, return the unavailable variant immediately with zero decisions. Collapse is never a guess.
- **Evidence is a closed union, not a free-text field.** Every collapse traces to one of three checkable facts. A model-authored justification string would reintroduce exactly the meta-output problem `readingPlan` had.
- **A chapter collapses only if _every_ file it touches supports collapse.** Mixed chapters stay open. This is the asymmetry that makes the safety invariant hold: the failure mode is leaving something expanded, which costs attention, not hiding something, which costs correctness.
- **`knownCallers`, not `callers`.** The import index misses dynamic imports and barrel re-exports, so the reason line says "0 known callers." Claiming certainty the index cannot deliver is how a wrong collapse gets trusted.
- **`filesScanned === 0` is not evidence.** An empty index means the walk failed, not that nothing imports anything. Phase 1 maps that to `available: false`; this function must not paper over it if it arrives anyway.
- **`dividerBefore` is the lowest collapsed index, or `null`.** When no chapter collapses there is no divider and no chrome, which is the evidence gate rendered.

**Implementation steps**:

1. Write `collapse.test.ts` with a `describe` block and one smoke test asserting an empty chapter list yields zero decisions.
2. Implement the unavailable short-circuit and prove it with the `unavailable` case.
3. Implement per-chapter file collection: for each chapter, gather the distinct `file` values across its `sections` of type `diff`. Normalize with the existing `normalizePath` rules.
4. Implement the three evidence checks against `risks` and `repo.index`.
5. Implement the all-files-agree rule and `dividerBefore`.
6. Add a `narratedDiffLines(chapters)` helper — sum of `endLine - startLine + 1` across diff sections — used by the compression test and later by the UI.

**Feedback loop**:

- **Playground**: `packages/cli/src/__tests__/collapse.test.ts`, created before `collapse.ts` exists.
- **Experiment**: Run against all five recorded narratives. Assert with zero-evidence input that `decisions` is empty and `dividerBefore` is `null`; with `available: false` that the unavailable variant returns regardless of how collapsible the chapters look; with a chapter touching one test file and one source file that it does **not** collapse.
- **Check command**: `bun test packages/cli/src/__tests__/collapse.test.ts`

### Recorded narratives

**Overview**: Committed JSON narratives, one per fixture, giving the gate real chapters to run against.

**Key decisions**:

- **Record from a real generation where possible.** Run `bun run eval --fixture={id}` with a configured provider and commit the resulting narrative. A hand-authored narrative is a legitimate fallback, but it is authored by the same person writing the assertions, which is how a gate ends up testing its author's expectations rather than the system.
- **At least one recording must be adversarial.** For `auth-token-validation`, the recording must place the hotspot (`src/auth/token-validator.ts`) in a chapter that looks collapsible by the other signals — low churn, no criticality keyword in the path of its sibling files. If every hotspot sits in an obviously high-risk chapter, the safety test passes without doing any work. Construct this deliberately and say so in a comment at the top of the file.
- **`safe-rename` declares `expectedHotspots: []`.** It is the fixture where near-total collapse is correct, and it is the only guard against a build that satisfies safety by collapsing nothing.
- **Recordings are inputs, not expectations.** Nothing asserts a recording is a _good_ narrative. They exist so the selection logic has chapters. Narrative quality is the eval probe's job.

**Implementation steps**:

1. Generate or author one narrative per fixture and commit under `eval/fixtures/recorded/`.
2. Add `recordedNarrativePath` to `EvalFixture` and populate it on all five.
3. Construct the `auth-token-validation` recording adversarially, with the comment explaining why.
4. Verify by hand that the large-refactor recording has both a substantial mechanical tail and hotspots outside it — otherwise the 40% floor is either unreachable or trivially met.

**Feedback loop**:

- **Playground**: The same test file.
- **Experiment**: Assert every recording parses, every fixture resolves a recording, and the union of files referenced by each recording's diff sections is a subset of that fixture's `files`.
- **Check command**: `bun test packages/cli/src/__tests__/collapse.test.ts -t recorded`

### The large-refactor fixture

**Pattern to follow**: `packages/cli/src/eval/fixtures/auth-token-validation.ts` — the same `EvalFixture` shape, roughly ten times the size.

**Overview**: A 40+ file PR mixing a genuine hotspot with a large mechanical tail, which is the shape that motivated this project.

**Key decisions**:

- **Mechanical mass is the point.** The tail should be a wide rename plus test-fixture churn — high line count, zero external callers, no behavioral delta. Without it the compression floor is unreachable for reasons that have nothing to do with the implementation.
- **Two or three real hotspots, not one.** A single hotspot lets a lucky selection pass. Give it a signature change with unchanged callers, and a migration.
- **`expectedHotspots` names files, not chapters**, matching the existing fixtures and the field the eval harness will consume in Phase 4.

**Implementation steps**:

1. Author the fixture with 40+ entries in `files`, most of them mechanical.
2. Populate `groundTruth.expectedConcerns`, `expectedHotspots`, and `shouldNotBeSafe`.
3. Register in `FIXTURES`.
4. Record its narrative.
5. Assert the compression floor is actually achievable by running the selection by hand before writing the assertion.

**Feedback loop**:

- **Playground**: A throwaway `bun` one-liner that loads the fixture and its recording, runs `selectCollapsible`, and prints `collapsedLines / totalNarratedLines`. Authoring this fixture is iterative — the mechanical tail gets tuned until the ratio clears the floor for real reasons — so the ratio needs to be visible on every edit rather than only when the test runs.
- **Experiment**: Print the ratio after each batch of files added. Check three shapes: mechanical tail only (ratio should approach 1.0 and the safety test should have nothing to guard), hotspots only (ratio near 0, floor unreachable), and the intended mix (ratio comfortably above 0.4 without being trivially 0.9, since a fixture that collapses almost everything tests nothing).
- **Check command**: `bun test packages/cli/src/__tests__/collapse.test.ts -t compression`

### Cap-stats plumbing

**Overview**: Stop discarding `PromptCapStats`.

```typescript
// planner.ts
return { plan, provider: result.provider, usage: result.usage, stats: prompt.stats };

// engine.ts
export type NarrativeGenerationResult = {
  narrative: NarrativeResponse;
  provider: string;
  capStats?: PromptCapStats;
};
```

**Key decisions**:

- Optional on the result, because a cache hit has no stats to report. A cached narrative should surface "generated from a truncated diff" as unknown rather than as false, and Phase 3 renders nothing when it is absent.
- No new computation. `buildPlannerPrompt` already returns `stats`; this is threading only.

**Implementation steps**:

1. Widen `runPlanner`'s return type.
2. Add `capStats` to `NarrativeGenerationResult` and populate on both paths.
3. Confirm `bun run typecheck` passes — `engine-plan-cache.test.ts` constructs these shapes.

## Testing Requirements

### Unit Tests

| Test File                                              | Coverage                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------- |
| `packages/cli/src/__tests__/collapse.test.ts`          | The four gate cases plus recording integrity                               |
| `packages/cli/src/__tests__/engine-plan-cache.test.ts` | Existing; verify `capStats` threading did not break its constructed shapes |

**Key test cases**, with the exact filter tokens the acceptance commands depend on:

- **`safety`** — for every fixture with a non-empty `expectedHotspots`, no returned `CollapseDecision` names a chapter whose diff sections reference a hotspot file. Iterate all five recordings in one test whose name contains `safety`.
- **`evidence`** — with risks carrying no mechanical signals and a warm repo context, `decisions` is `[]` and `dividerBefore` is `null`.
- **`unavailable`** — with `{available: false, reason: 'size-cap'}`, the result is the unavailable variant with that reason, even when the chapters would otherwise collapse.
- **`compression`** — over `large-refactor.narrative.json`, collapsed chapters account for at least 40% of narrated diff lines.
- **`recorded`** — every fixture resolves a parseable recording whose referenced files are a subset of its `files`.
- Mixed chapter (one test file, one source file) does not collapse.
- `filesScanned === 0` produces no decisions.

## Failure Modes

| Component           | Failure Mode                  | Trigger                                                                | Impact                                                                  | Mitigation                                                                                                                                             |
| ------------------- | ----------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| selectCollapsible   | Wrong collapse                | Import index undercounts a module (dynamic import, barrel re-export)   | A chapter that mattered is hidden; the reviewer never learns it existed | The all-files-agree rule plus "0 known callers" wording; the safety test over adversarial recordings is the standing guard                             |
| selectCollapsible   | Vacuous safety                | Every hotspot happens to sit in an obviously high-risk chapter         | Test passes without exercising the logic                                | The adversarial `auth-token-validation` recording, constructed so the hotspot's chapter looks collapsible by other signals                             |
| selectCollapsible   | Collapse-nothing build        | A bug makes evidence never match                                       | Feature is inert but every safety assertion passes                      | The `compression` test over `large-refactor` fails, which is exactly why the floor exists                                                              |
| selectCollapsible   | Empty index read as certainty | Index build failed, `filesScanned` is 0                                | Every chapter reports zero callers and everything collapses             | Explicit `filesScanned === 0` guard producing no decisions                                                                                             |
| Recorded narratives | Drift                         | A prompt revision changes narrative shape; recordings keep the old one | Gate measures a shape production no longer produces                     | Recordings are inputs to a pure function, so shape drift surfaces as a type error rather than a silent pass; re-record when `NarrativeChapter` changes |
| Large fixture       | Unreachable floor             | Mechanical tail too small relative to hotspot chapters                 | `compression` fails for authoring reasons, not implementation reasons   | Run the selection by hand before writing the assertion                                                                                                 |
| Cap-stats plumbing  | Cache hit reports false       | `capStats` defaulted to an empty object rather than left undefined     | UI claims a truncated diff was complete                                 | Keep it optional and absent on cache hits; Phase 3 renders nothing when absent                                                                         |

## Validation Commands

```bash
bun test packages/cli/src/__tests__/collapse.test.ts
bun test packages/cli/src/__tests__/collapse.test.ts -t safety 2>&1 | grep -qE '[1-9][0-9]* pass'
bun test packages/cli/src/__tests__/collapse.test.ts -t compression 2>&1 | grep -qE '[1-9][0-9]* pass'
bun run test
bun run typecheck
bun run lint
```

## Open Items

- [ ] Decide whether the five recordings come from real generations or are hand-authored. Real is strongly preferred; if hand-authored, note it at the top of each file so a future reader knows the provenance.

---

_This spec is ready for implementation. Follow the patterns and validate at each step._
