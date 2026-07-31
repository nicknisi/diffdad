# Review Triage Contract

**Created**: 2026-07-31
**Readiness**: All 5 gates ready
**Status**: Approved
**Approval**: Express — single consolidated confirmation, no per-artifact review
**Supersedes**: None

## Problem Statement

Reviewing a large PR in Diff Dad produces six or seven chapters that each read well in isolation and give no sense of which two or three actually decide whether to approve. The result is a skim, an approval, and unease. The story is a nicer-looking full diff rather than a triage.

The signals that could fix this are wrong or unused. `narrative/risk.ts:170-180` computes inbound references only among files already inside the diff, so blast radius today means 'how many other changed files import you' rather than how many unchanged files do. `generateNarrative` is called with `fileTree: []` at every production site (`cli.ts:330`, `server.ts:364`, `daemon/daemon.ts:262`), so the model has never seen anything outside the PR. Every fixture in `eval/fixtures/` declares `expectedHotspots` and nothing in `eval/judge.ts` reads it; the only ranking check, `chaptersOrderedByRisk`, asserts the risk labels are non-increasing, which a narrative that labels everything low passes.

Large PRs also lose content silently. `MAX_TOTAL_DIFF_LINES = 12000` causes `prompt.ts:495` to drop whole files, and `engine.ts:76-80` prints that warning to the terminal only. In the browser there is no indication that the story was built from a partial diff.

There is a live precedent for how this fails. The LLM `readingPlan` was built, shipped, and then pulled from the UI because 'most of the time it just says to read the chapters in order.' A collapse boundary is the same genre of meta-output and will meet the same fate unless every collapse is backed by a fact the chapter list does not already imply.

## Goals

1. Zero collapse-safety violations: no file listed in a fixture's `expectedHotspots` ever appears inside a collapsed chapter, across every recorded fixture narrative, enforced by a test that fails the build.
2. At least 40% of narrated diff lines sit inside collapsed chapters on the large-PR fixture, measured in lines rather than chapter count so tiny-chapter collapsing cannot game it.
3. Inbound-reference counts reflect the whole repository rather than only the diff, and the risk score's centrality term discriminates across that wider range instead of saturating at its current cap of ten.
4. Collapse never renders without positive evidence: an input with no mechanical signals produces zero collapsed chapters and no divider, leaving the story visually identical to today.
5. Repo context resolves identically in `dad review` and in the daemon, with the unavailable state reserved for a repository above the size cap or a failed fetch, and naming which.
6. Prompt-budget truncation is visible in the browser: when files are dropped or truncated before the model sees them, the review says so instead of looking complete.

## Success Criteria

- [ ] Repo snapshots fetch, extract safely, and build an import index; extraction rejects path traversal and symlink escapes — check: `bun test packages/cli/src/__tests__/repo-snapshot.test.ts 2>&1 | grep -qE '[1-9][0-9]* pass'` → exits 0, and the guard proves at least one test actually ran
- [ ] Inbound reference counts include callers that are not part of the diff — check: `bun test packages/cli/src/__tests__/repo-snapshot.test.ts -t 'callers outside the diff' 2>&1 | grep -qE '[1-9][0-9]* pass'` → exits 0, and the guard proves the named test exists
- [ ] The risk score's centrality term discriminates across repo-wide counts rather than saturating at ten — check: `bun test packages/cli/src/__tests__/risk.test.ts -t centrality 2>&1 | grep -qE '[1-9][0-9]* pass'` → exits 0, and the guard proves the named test exists
- [ ] Safety invariant: no chapter containing a fixture's expectedHotspots file is ever marked collapsible, over every recorded fixture narrative — check: `bun test packages/cli/src/__tests__/collapse.test.ts -t safety 2>&1 | grep -qE '[1-9][0-9]* pass'` → exits 0, and the guard proves the named test exists
- [ ] Evidence gate: input carrying no mechanical signals produces zero collapsed chapters and no divider — check: `bun test packages/cli/src/__tests__/collapse.test.ts -t evidence 2>&1 | grep -qE '[1-9][0-9]* pass'` → exits 0, and the guard proves the named test exists
- [ ] Degrade path: unavailable repo context collapses nothing and carries a reason naming size-cap or fetch failure — check: `bun test packages/cli/src/__tests__/collapse.test.ts -t unavailable 2>&1 | grep -qE '[1-9][0-9]* pass'` → exits 0, and the guard proves the named test exists
- [ ] Compression floor: the large-PR fixture with its recorded narrative collapses at least 40% of narrated diff lines — check: `bun test packages/cli/src/__tests__/collapse.test.ts -t compression 2>&1 | grep -qE '[1-9][0-9]* pass'` → exits 0, and the guard proves the named test exists
- [ ] Prompt-cap statistics survive planner and engine and are exposed on the narrative API response — check: `bun test packages/cli/src/__tests__/server.test.ts -t promptCapStats 2>&1 | grep -qE '[1-9][0-9]* pass'` → exits 0; the filter token is absent from the file today so a vacuous match is impossible
- [ ] The eval harness scores hotspot placement against expectedHotspots and reports it per run — check: `bun test packages/cli/src/__tests__/eval-judge.test.ts 2>&1 | grep -qE '[1-9][0-9]* pass'` → exits 0, and the guard proves at least one test actually ran
- [ ] Both test suites and both TypeScript projects stay green — check: `bun run test && bun run --filter '@diffdad/web' test && bun run typecheck` → exits 0
- [ ] Real generations place the hotspot in an expanded chapter for every fixture that declares a non-empty expectedHotspots — judgment call: Nick runs `bun run eval` with a configured provider and reads the per-run hotspot placement in the written baseline before calling the work done
- [ ] The collapse boundary, the unavailable notice, and the truncation banner read correctly on a real large PR — judgment call: Nick opens a 40+ file PR with `dad review` and judges the three new surfaces against his own UI taste

## Scope Boundaries

### In Scope

- Repo snapshot: fetch the base ref tarball into a size-capped, age-bounded cache under the regenerable cache dir, extract with path-traversal and symlink guards, and build an import index in the same pass — Indexing during extraction avoids a second full read and removes any dependency on ripgrep or git being installed; the cache dir choice follows the durable-versus-regenerable split already documented in paths.ts
- Repo-wide inbound references in risk.ts, with the score's centrality term rescaled so it still discriminates once counts are no longer bounded by the diff — computeScore currently caps the term at `Math.min(inboundRefs, 10) * 4`, which repo-wide counts saturate for nearly every non-leaf file, turning centrality into a constant and reproducing the exact no-discrimination symptom the project exists to fix
- Pure collapse-selection function over (chapters, risk signals, repo context) returning which chapters collapse and the one-line evidence for each, computed at serve time and never persisted — Purity is what makes the safety gate free and deterministic, and serve-time computation avoids a cache-key defect: narrativeCachePath() carries no repo-state component, so a narrative generated while context was unavailable would keep collapsing nothing at that SHA forever
- Large-PR fixture (40+ files) with ground-truth hotspots, plus recorded narratives for it and the four existing fixtures — selectCollapsible needs chapters and EvalFixture carries none, so without recorded narratives the safety and compression gates have no input and would report a vacuous pass
- Collapse rendering in the story view: one divider before the first collapsed chapter, the evidence line on each, and an unavailable notice when repo context could not be resolved — Chapter.tsx:271 already owns a `collapsed` state seeded from `reviewed`, so this seeds that existing state rather than introducing a second driver; the unavailable notice is the only surface that delivers the repo-context goal
- Score expectedHotspots in eval/judge.ts and report placement per run in EvalRun and the aggregate — The ground-truth field is declared on every fixture and read by nothing; wiring it is what makes the manual eval probe worth running after a prompt change
- Prompt-cap statistics plumbed from the planner through the engine to the narrative API, and a truncation banner in the web UI — runPlanner returns only {plan, provider, usage} and NarrativeGenerationResult only {narrative, provider}, so the stats are computed and discarded today; a story built from a truncated diff currently looks identical to a complete one
- Collapse state and the unavailable notice carried through the daemon's own Hono app and unit persistence — The daemon serves from daemon/app.ts with its own routes and persists units through units/store.ts, so nothing reaches the daemon drill-in by way of the CLI server
- Expandable caller list per chapter: click the evidence line to see which unchanged files import the changed module — Turns the evidence from a claim into something checkable without leaving the review; the import index already holds the data
- Snapshot prefetch on daemon poll, so context is warm before a review is opened — Removes first-open latency, but only matters once the snapshot path has proven itself in normal use

### Out of Scope

- changeKind classification (adds / extends / composes a primitive) — Without a primitives manifest the model guesses, and 'adds a primitive' degrades into 'adds a file', which risk.ts already approximates from churn plus new-file
- A per-repo primitives manifest — Requires deciding what a primitive means for each repo; a separate project with its own interview
- Mermaid system map and change-flow diagrams — Kent reports his own system map needs work, and the flow diagram is unproven against the stated triage problem
- A separate ranking pass that reorders chapters — prompt.ts:229 already instructs the model to order by risk descending with mechanical changes last; collapse happens in place, and reordering a five-element list adds a mechanism that duplicates one the pipeline performs
- Local checkout detection as a fast path when the current directory is already the repo — A second provider means two sets of edge cases and results that differ by where the command was run; the snapshot path is uniform and the cache makes the repeat cost negligible
- Per-symbol caller resolution — computeRisk stores one integer per file and formatRiskHints prints it as inbound=N, so file-and-module granularity is all any MVP consumer reads; symbol granularity is only needed once the stretch-tier caller list is scheduled
- Feeding recap's recovered decisions (commits, threads, force pushes, linked issues) into narrative generation — A real opportunity and entirely separable from triage; mixing it in doubles the surface under test
- Changing MAX_TOTAL_DIFF_LINES, per-file caps, or MAX_CHAPTERS — This project makes truncation visible rather than adjusting it; retuning caps is a different investigation with its own cost curve

### Future Considerations

- changeKind plus a primitives manifest, once a repo-level primitives concept exists to classify against
- Handing recap's recovered intent to the narrative engine so the story reflects what the author decided rather than what the diff implies
- Cross-PR blast radius: does this PR's changed surface collide with another open PR
- Repo context in the prompt beyond risk hints, once snapshots have proven their latency and disk cost in normal use

## Decisions Considered and Rejected

- **Source repo context from cached tarball snapshots, uniform in the CLI and the daemon** — rejected: Local git grep against a checkout, with an explicit unavailable state when the repo is not on disk. Reversed after the hidden-dependency critic found the daemon has no checkout-resolution mechanism at all — units/store.ts:133 mints an empty worktreePath that nothing sets, launchd.ts:87-112 sets no WorkingDirectory, and inferRepoFromGit reads cwd — so the local-git plan would have reported unavailable on 100% of daemon PRs, against a standing daemon-parity goal
- **Fetch a tarball rather than cloning** — rejected: git clone --depth 1, and a bare mirror per repo. Grep needs file contents, not history; a shallow clone drags an object store that is never read, and --filter=blob:none is actively wrong because grep would trigger a network fetch per file
- **Build the import index during extraction and persist it beside the snapshot** — rejected: Shelling out to ripgrep or git grep at query time. One pass over files already being written, no dependency on a binary that may not be installed, and caller lookup becomes a map read rather than a scan
- **Compute collapse state at serve time and never persist it** — rejected: Carrying collapse fields through the narrative cache and normalization. narrativeCachePath() keys on owner-repo-number-sha-metaHash-provider with no repo-state component, so a narrative generated while context was unavailable would keep collapsing nothing at that SHA forever, silently defeating the safety and compression goals
- **Collapse chapters in place, in the order the model already produced** — rejected: A separate ranking pass that reorders chapters before drawing the boundary. prompt.ts:229 already instructs risk-descending order with mechanical changes last, and chaptersOrderedByRisk asserts it; a reorder over a list capped at seven is machinery duplicating existing behavior
- **Author the large fixture and all recorded narratives in the same phase that owns the safety gate** — rejected: Tiering the large fixture as Full and authoring it in a later, non-blocking phase. Three critics independently found the same circularity: the gate needs chapters, EvalFixture carries none, and the only planned recorded narrative lived in a phase that listed the gate's phase as its prerequisite
- **Guard every name-filtered test command with a pass-count check** — rejected: Bare `bun test <file> -t <name>` commands. A -t filter matching nothing exits 0, so three of the goals hung on checks that pass whether or not the test was ever written; separately `-t cap` matched the existing recap tests at server.test.ts:169 and :175 and passed on main before any work
- **Rescale the centrality term in computeScore** — rejected: Leaving Math.min(inboundRefs, 10) * 4 and simply widening what inboundRefs counts. Repo-wide counts saturate that cap for essentially every non-leaf file, turning the term into a constant 40 and reproducing the no-discrimination symptom the project exists to fix
- **Run both test suites in the acceptance command** — rejected: `bun run test && bun run typecheck` alone. Root `test` is `bun test packages/cli/src/__tests__/` and never touches the 11 vitest files under packages/web/src, which is where the only new UI code lives
- **Build repo context plus collapse signals** — rejected: The video's path: changeKind classification, a primitives manifest, and mermaid change-flow diagrams. That approach works because the authoring agent already holds the repo; Diff Dad reconstructs from an API response, so the classification would rest on structure it cannot see
- **The hard gate is a unit test over a pure selection function; the eval harness is a manual probe** — rejected: Asserting on the eval baseline as the blocking gate. A gate that needs a configured provider and spends tokens per run gets disabled, and then there is no gate at all
- **Measure compression in narrated diff lines** — rejected: Percentage of chapters collapsed. Chapter counts are gameable by collapsing many tiny chapters while the two open ones still hold most of the code
- **Collapse engages only when positive evidence exists for that chapter** — rejected: Always rendering the boundary, and gating additionally on PR size. readingPlan was pulled from the UI for being always-on meta-output that usually said nothing; a size threshold adds a number to tune without adding safety

## Execution Plan

_Added during Phase 5 handoff. Pick up this contract cold and know exactly how to execute._

### Dependency Graph

```
Repo snapshot and import index
  └── Collapse selection, cap stats, and fixtures  (blocked by Repo snapshot and import index)
        ├── Review surfaces  (blocked by Collapse selection, cap stats, and fixtures)
        └── Eval hotspot scoring  (blocked by Collapse selection, cap stats, and fixtures)
```

### Execution Steps

**Run the project** (recommended) — autopilot reads this contract, plans dependency waves, runs independent phases in parallel, and gates on failure:

```bash
/ideation:autopilot docs/ideation/review-triage/contract.md
```

**Or run it unattended** — a `/goal` is a durability wrapper around the same autopilot run: Claude re-checks the condition before it is allowed to stop, so failures get repaired and re-run. Generated by `contract-gen --print-goal`; this is the only copy of that string:

```
/goal Drive the Review Triage contract (review-triage) to completion with /ideation:autopilot.

1. Run `/ideation:autopilot docs/ideation/review-triage/contract.md`. All commits belong on branch ideation/review-triage — switch to it before any run.
2. It dispatches a BACKGROUND workflow. Wait for the completion notification — never start a second autopilot run while one is in flight.
3. Then run the ideation plugin's `scripts/verify.mjs` against `docs/ideation/review-triage/contract-data.json` and leave its VERIFY line in the conversation. Resolve the plugin's install directory first — `${CLAUDE_PLUGIN_ROOT}/scripts/verify.mjs` is a placeholder, not a shell variable, and bash will not expand it. That line is the only evidence this goal is judged on.
4. If anything failed, fix the spec or the implementation and go back to step 1. Autopilot skips phases that already have commits.

Done when the most recent VERIFY line reads fail=0 and commits=4/4 — or when two consecutive VERIFY lines are identical and still failing, in which case name the failing checks and stop, because a contract whose checks have rotted must not trap the run.
```

**Or run phases manually** in dependency order:

**Strategy**: Hybrid

1. **Phase 1** — Repo snapshot and import index _(blocking)_

   ```bash
   /ideation:execute-spec docs/ideation/review-triage/spec-phase-1.md
   ```

2. **Phase 2** — Collapse selection, cap stats, and fixtures _(blocking)_

   ```bash
   /ideation:execute-spec docs/ideation/review-triage/spec-phase-2.md
   ```

3. **Phase 3** — Review surfaces _(blocked by Collapse selection, cap stats, and fixtures)_

   ```bash
   /ideation:execute-spec docs/ideation/review-triage/spec-phase-3.md
   ```

4. **Phase 4** — Eval hotspot scoring _(blocked by Collapse selection, cap stats, and fixtures)_

   ```bash
   /ideation:execute-spec docs/ideation/review-triage/spec-phase-4.md
   ```

### Agent Team Prompt

```
Phases 3 (Review surfaces) and 4 (Eval hotspot scoring) are both blocked only by Phase 2 and touch disjoint files, so run them in parallel once Phase 2 lands. Phase 3 owns packages/web, packages/cli/src/server.ts, packages/cli/src/daemon and packages/cli/src/units. Phase 4 owns packages/cli/src/eval, except eval/types.ts which Phase 2 has already extended — read its current shape before editing. Neither phase may edit packages/cli/src/narrative: that shape is frozen by Phase 2, and needing a change there means stopping and revising Phase 2's spec rather than patching around it.
```

---

_This contract was generated from brain dump input. Review and approve before proceeding to specification._
