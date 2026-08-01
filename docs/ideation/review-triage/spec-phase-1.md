# Implementation Spec: Review Triage - Phase 1

**Contract**: ./contract.md
**Estimated Effort**: L

## Technical Approach

Diff Dad currently reasons about a PR using nothing but the PR. `generateNarrative` is called with `fileTree: []` at all three production sites, and `computeRisk` counts inbound references only among files that appear in the diff. This phase gives the pipeline a view of the whole repository so "blast radius" stops meaning "how many other changed files import you."

The mechanism is a cached repository snapshot, not a checkout. Grep needs file contents, not history, so the phase fetches `GET /repos/{owner}/{repo}/tarball/{base}` — one request that returns the entire tree — extracts it under the regenerable cache directory, and builds an import index during the same pass. Indexing while writing avoids a second full read of every file and removes any dependency on `git` or `ripgrep` being installed. Caller lookup then becomes a map read rather than a scan.

The awkward part is plumbing, not fetching. `computeRisk` is invoked _inside_ the synchronous prompt builders (`prompt.ts:589`, `:603`, `:679`), while snapshot resolution is async. Resolved context therefore has to be resolved before prompt construction and threaded down as a parameter: `generateNarrative` gains it, passes it to `runPlanner` and `writeChapter`, and all three production call sites (`cli.ts:330`, `server.ts:364`, `daemon/daemon.ts:262`) supply it. This is the phase's main risk, and the reason it is sequenced first and alone.

One correctness trap sits at the end of the pipeline. `computeScore` scores centrality as `Math.min(input.inboundRefs, 10) * 4`. That cap was calibrated for diff-internal counts, which are tiny. Repo-wide counts saturate it for essentially every non-leaf file, which turns the centrality term into a constant 40 and destroys exactly the discrimination this project exists to create. The term is rescaled logarithmically, matching how churn is already handled at `risk.ts:152`.

## Decisions Considered and Rejected

_Carried from the contract; consult before making gap decisions._

- **Source repo context from cached tarball snapshots, uniform in the CLI and the daemon** — rejected: local git grep against a checkout with an explicit unavailable state. Reversed after the hidden-dependency critic found the daemon has no checkout-resolution mechanism at all: `units/store.ts:133` mints an empty `worktreePath` that nothing sets, `launchd.ts:87-112` sets no `WorkingDirectory`, and `inferRepoFromGit` reads cwd. The local-git plan would have reported unavailable on 100% of daemon PRs, against a standing daemon-parity goal.
- **Fetch a tarball rather than cloning** — rejected: `git clone --depth 1`, and a bare mirror per repo. Grep needs file contents, not history; a shallow clone drags an object store that is never read, and `--filter=blob:none` is actively wrong because grep would trigger a network fetch per file.
- **Build the import index during extraction and persist it beside the snapshot** — rejected: shelling out to ripgrep or git grep at query time. One pass over files already being written, no dependency on a binary that may not be installed, and caller lookup becomes a map read rather than a scan.
- **Rescale the centrality term in computeScore** — rejected: leaving `Math.min(inboundRefs, 10) * 4` and simply widening what `inboundRefs` counts. Repo-wide counts saturate that cap for essentially every non-leaf file, turning the term into a constant 40 and reproducing the no-discrimination symptom the project exists to fix.
- **Local checkout detection as a fast path** — rejected: using cwd when it is already the repo. A second provider means two sets of edge cases and results that differ by where the command was run; the snapshot path is uniform and the cache makes the repeat cost negligible.
- **Per-symbol caller resolution** — rejected for this phase. `computeRisk` stores one integer per file and `formatRiskHints` prints it as `inbound=N`, so file-and-module granularity is all any consumer reads. The index does store the caller _file list_ per module, because the Stretch-tier caller list reads it, but no symbol extraction happens.

## Feedback Strategy

**Inner-loop command**: `bun test packages/cli/src/__tests__/repo-snapshot.test.ts`

**Playground**: The Bun test suite, seeded with a hand-built fixture tarball committed under `packages/cli/src/__tests__/fixtures/`. Extraction, indexing, and caller resolution are all pure-ish functions over a local archive, so no network and no provider are needed at any point in the loop.

**Why this approach**: Every component in this phase is a data/logic layer whose correctness is checkable from a fixed input, and the two riskiest behaviors (archive-escape rejection and index accuracy) are precisely the kind that need many iterations against fixed inputs.

## File Changes

### New Files

| File Path                                               | Purpose                                                                                                                      |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `packages/cli/src/repo/snapshot.ts`                     | Fetch, extract, cache, and evict repository snapshots; owns the size cap, staleness bound, and the `RepoContext` result type |
| `packages/cli/src/repo/import-index.ts`                 | Build and query the module-to-callers index; one pass during extraction, JSON-persisted beside the snapshot                  |
| `packages/cli/src/__tests__/repo-snapshot.test.ts`      | Extraction safety, index accuracy, staleness, size-cap degrade, and callers-outside-the-diff                                 |
| `packages/cli/src/__tests__/fixtures/mini-repo.tar.gz`  | Small committed archive used by every test in this phase                                                                     |
| `packages/cli/src/__tests__/fixtures/evil-paths.tar.gz` | Archive containing `../` entries and an escaping symlink, for the rejection tests                                            |

### Modified Files

| File Path                                 | Changes                                                                                                                                                                                                |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/cli/src/github/client.ts`       | Add `getTarball(owner, repo, ref): Promise<ReadableStream>` using the existing private `fetch` with `Accept: application/vnd.github+json`; GitHub 302s to codeload, which `fetch` follows by default   |
| `packages/cli/src/paths.ts`               | Add `repoSnapshotDir()` under `legacyDir()` (`~/.cache/diffdad`), not `dataDir()` — snapshots are regenerable, and the file's own doc comment already draws that line                                  |
| `packages/cli/src/narrative/risk.ts`      | `computeRisk` takes an optional `RepoContext`; `inboundRefs` reads the index when present and falls back to today's diff-internal count when absent; rescale the centrality term in `computeScore`     |
| `packages/cli/src/narrative/prompt.ts`    | `NarrativePromptInput` gains `repoContext`; pass it through to `computeRisk` at the three call sites; `formatRiskHints` labels counts as repo-wide or diff-only so the model knows which it is reading |
| `packages/cli/src/narrative/planner.ts`   | `PlannerInput` gains `repoContext`, forwarded to `buildPlannerPrompt`                                                                                                                                  |
| `packages/cli/src/narrative/writer.ts`    | `WriterInput` gains `repoContext`, forwarded to `buildWriterPrompt`                                                                                                                                    |
| `packages/cli/src/narrative/engine.ts`    | `generateNarrative` gains a `repoContext` option, threaded into both the single-pass and two-pass paths                                                                                                |
| `packages/cli/src/cli.ts`                 | Resolve the snapshot before `generateNarrative` (line 330); log a one-line status so a slow first fetch is not silent                                                                                  |
| `packages/cli/src/server.ts`              | Same resolution before the regenerate path at line 364                                                                                                                                                 |
| `packages/cli/src/daemon/daemon.ts`       | Same resolution before line 262                                                                                                                                                                        |
| `packages/cli/src/__tests__/risk.test.ts` | Line 66 asserts the diff-internal inbound-ref behavior being replaced; rewrite it, and add the `centrality` case proving the rescaled term still discriminates above ten                               |

## Implementation Details

### Repository snapshot

**Pattern to follow**: `packages/cli/src/narrative/cache.ts` for the cache-path-plus-read-plus-write shape, and `packages/cli/src/paths.ts` for the durable-versus-regenerable split.

**Overview**: Resolve a repository to a local extracted tree plus an import index, or to an explicit unavailable reason. Everything downstream consumes the same union.

```typescript
export type RepoContext =
  | { available: true; root: string; ref: string; fetchedAt: number; index: ImportIndex }
  | { available: false; reason: 'size-cap' | 'fetch-failed' | 'extract-failed' };

export type SnapshotOptions = {
  /** Reject archives whose extracted size exceeds this. Default 500 MB. */
  maxBytes?: number;
  /** Refetch when the cached snapshot is older than this. Default 24h. */
  maxAgeMs?: number;
};

export async function resolveRepoContext(
  client: GitHubClient,
  owner: string,
  repo: string,
  ref: string,
  opts?: SnapshotOptions,
): Promise<RepoContext>;
```

**Key decisions**:

- Cache key is `{owner}-{repo}` with the ref and fetch time recorded in a sidecar `.meta.json`, not `{owner}-{repo}-{sha}`. Caller counts answer "roughly who depends on this," which tolerates a base a few commits stale; per-SHA keying would thrash the cache on every push to the base branch for no accuracy that any consumer reads.
- The staleness bound is a refetch trigger, never a hard failure. A stale snapshot beats no snapshot, so if a refetch fails and a cached tree exists, serve the cached tree.
- The size cap is checked during extraction against the running total, not against a `Content-Length` header. Tarballs are gzipped and the header describes the compressed stream.
- `unavailable` carries a discriminated reason because the UI renders it. "Unavailable" with no cause is the kind of dead meta-output this project exists to avoid.

**Implementation steps**:

1. Write `repoSnapshotDir()` in `paths.ts` and confirm it lands under `~/.cache/diffdad/repos`.
2. Add `getTarball` to `GitHubClient`, returning the response body stream.
3. Write `resolveRepoContext`: read the sidecar, decide fresh-or-refetch, and on refetch stream through extraction.
4. Extract with `Bun.spawn(['tar', '-xzf', '-', '-C', dest])` fed from the stream, **after** a validation pass that rejects unsafe entries (see failure modes). If validating and extracting in one pass proves awkward, extract into a scratch sibling directory and rename on success, so a rejected archive never leaves a partial tree at the real path.
5. Evict: after a successful write, delete snapshot directories whose sidecar `fetchedAt` is older than 7 days.
6. Return the union.

**Feedback loop**:

- **Playground**: `packages/cli/src/__tests__/repo-snapshot.test.ts` with a `describe` block and one smoke test asserting `mini-repo.tar.gz` extracts and reports `available: true`, written before `snapshot.ts` exists.
- **Experiment**: Extract `mini-repo.tar.gz` (should succeed), `evil-paths.tar.gz` (should reject both the `../` entry and the escaping symlink and leave no directory behind), and `mini-repo.tar.gz` with `maxBytes: 1` (should return `{available: false, reason: 'size-cap'}`). Then extract twice and assert the second call performs no fetch.
- **Check command**: `bun test packages/cli/src/__tests__/repo-snapshot.test.ts`

### Import index

**Pattern to follow**: `packages/cli/src/narrative/risk.ts:68-106` — `IMPORT_RE`, `extractImports`, `moduleNameFromPath`, and `importTargetsFile` already encode this project's matching rules and should be reused rather than reinvented.

**Overview**: A map from module name to the list of repository files that import it, built while the snapshot's files are read.

```typescript
export type ImportIndex = {
  /** module name (basename without extension) -> repo-relative paths that import it */
  callers: Map<string, string[]>;
  /** Total files scanned — lets callers distinguish "0 callers" from "index is empty". */
  filesScanned: number;
};

export function buildImportIndex(root: string): Promise<ImportIndex>;
export function callersOf(index: ImportIndex, filePath: string, exclude: Set<string>): string[];
```

**Key decisions**:

- `callersOf` takes an `exclude` set of the diff's file paths so the count reported is specifically _unchanged_ callers. That is the number the evidence line claims, and computing it here keeps `collapse.ts` in Phase 2 pure.
- Store the caller list, not a count. The count is `.length`, and the Stretch-tier caller list needs the paths.
- Scan only text files with source-like extensions. A snapshot contains images and binaries, and running `IMPORT_RE` over a PNG is wasted work.
- `filesScanned` exists so a downstream consumer can tell "genuinely nothing imports this" from "the index never got built." Those two states must not both render as `0 external callers`.

**Implementation steps**:

1. Walk the extracted tree, skipping the same directories `diff-filter.ts` already treats as noise (`node_modules/`, `dist/`, `vendor/`, `.next/`).
2. For each source file, run the existing `extractImports` logic and record `import target -> this file`.
3. Resolve targets to module names with the existing `moduleNameFromPath` and `importTargetsFile` rules.
4. Persist as JSON beside the snapshot so a warm cache skips the walk entirely.

**Feedback loop**:

- **Playground**: The same test file. Build `mini-repo.tar.gz` so it contains a known shape: `src/util.ts`, three files importing it, and one file importing nothing.
- **Experiment**: Assert `callersOf(index, 'src/util.ts', new Set())` returns exactly 3 paths; assert `callersOf(index, 'src/util.ts', new Set(['src/a.ts']))` returns exactly 2; assert a module nobody imports returns `[]` while `filesScanned > 0`.
- **Check command**: `bun test packages/cli/src/__tests__/repo-snapshot.test.ts -t index`

### Risk rescoring

**Pattern to follow**: `packages/cli/src/narrative/risk.ts:152` — churn is already log-scaled for exactly this reason, and the comment there states the rationale.

**Overview**: `computeRisk` consumes repo context when it has it, and the centrality term stops saturating.

```typescript
export function computeRisk(files: DiffFile[], repo?: RepoContext): FileRisk[];

// FileRisk gains:
//   inboundRefs: number          // now repo-wide when repo?.available
//   inboundScope: 'repo' | 'diff' // which universe the count came from
```

**Key decisions**:

- Keep the field name `inboundRefs` and change its meaning rather than adding a parallel field. Two similarly named counts is how the wrong one gets read six months from now. `inboundScope` records which universe produced it, which is what a reader actually needs.
- Score with `Math.log10(max(inboundRefs, 1)) * K` rather than a linear term with a cap. Pick `K` so a file with ~100 repo-wide callers scores roughly where a file with 10 diff-internal callers scored before, keeping the relative weight of centrality against churn and criticality stable.
- `formatRiskHints` must label the scope. The model is being handed a number whose meaning changed; leaving it as a bare `inbound=N` invites it to reason with the old semantics.

**Implementation steps**:

1. Widen `computeRisk`'s signature and `FileRisk`.
2. Branch inbound counting on `repo?.available`, falling back to today's `inboundCounts` loop.
3. Rescale the centrality term in `computeScore` and delete the `Math.min(..., 10)` cap.
4. Update `formatRiskHints` to emit `inbound=N(repo)` or `inbound=N(diff)`.
5. Rewrite `risk.test.ts:66` and add the `centrality` case.

**Feedback loop**:

- **Playground**: `packages/cli/src/__tests__/risk.test.ts`, which already exists and already calls `computeRisk` at five sites.
- **Experiment**: Score two synthetic files with 12 and 240 repo-wide callers and assert their scores differ; under the old cap both would score identically. Also assert `computeRisk(files)` with no repo argument produces the same ordering it produces today.
- **Check command**: `bun test packages/cli/src/__tests__/risk.test.ts`

### Context threading

**Overview**: No logic, all signature. Resolve once per generation, pass down, supply at every call site.

**Key decisions**:

- Resolve in the callers, not inside `generateNarrative`. The daemon may want to prefetch (Stretch) and the CLI wants to print a status line, and both need the resolution to be a visible step rather than a hidden side effect.
- `repoContext` is optional on every signature it touches. Every consumer already has a defined behavior for its absence, and making it required would force the eval harness and every existing test to construct one.

**Implementation steps**:

1. Add the optional field to `NarrativePromptInput`, `PlannerInput`, `WriterInput`, and `generateNarrative`'s options.
2. Pass through at `prompt.ts:589`, `:603`, `:679`.
3. Resolve and supply at `cli.ts:330`, `server.ts:364`, `daemon/daemon.ts:262`.
4. Run `bun run typecheck` — the compiler finds any site missed.

## Testing Requirements

### Unit Tests

| Test File                                          | Coverage                                                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `packages/cli/src/__tests__/repo-snapshot.test.ts` | Extraction safety, cache reuse, staleness, size cap, index accuracy, callers-outside-the-diff         |
| `packages/cli/src/__tests__/risk.test.ts`          | Rescored centrality, repo-wide versus diff-internal counting, unchanged behavior without repo context |

**Key test cases**:

- `mini-repo.tar.gz` extracts, indexes, and reports the expected caller counts.
- A named test `callers outside the diff` asserts a module whose only importers are absent from the diff still reports a nonzero count. This is the criterion that proves the whole phase.
- A named test `centrality` asserts two files with 12 and 240 callers score differently.
- `evil-paths.tar.gz` is rejected and leaves no directory behind.
- Size cap exceeded returns `{available: false, reason: 'size-cap'}`.
- A second `resolveRepoContext` call within the staleness window performs no fetch — assert against a call-counting stub client.
- A refetch failure with a cached tree present serves the cached tree rather than returning unavailable.
- `computeRisk(files)` with no repo argument produces today's ordering.

### Manual Testing

- [ ] `bun packages/cli/src/cli.ts review <owner>/<repo>#<n>` on a repo you have never cloned, confirming the snapshot fetches and the status line appears
- [ ] Re-run the same command, confirming no second fetch
- [ ] Inspect `~/.cache/diffdad/repos/` for the extracted tree, the sidecar, and the persisted index

## Error Handling

| Error Scenario                            | Handling Strategy                                                                                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tarball request fails (404, 403, network) | Return `{available: false, reason: 'fetch-failed'}`; never throw into the narrative path — a missing snapshot degrades the review, it does not break it |
| Extraction fails midway                   | Delete the scratch directory, return `{available: false, reason: 'extract-failed'}`                                                                     |
| Archive exceeds the size cap              | Abort the stream, delete the scratch directory, return `{available: false, reason: 'size-cap'}`                                                         |
| Cache directory is unwritable             | Treat as `extract-failed`; the review proceeds without repo context                                                                                     |
| Persisted index JSON is corrupt           | Rebuild from the extracted tree; if the tree is also gone, refetch                                                                                      |

## Failure Modes

| Component         | Failure Mode                  | Trigger                                                                | Impact                                                                                  | Mitigation                                                                                                                                                          |
| ----------------- | ----------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Snapshot          | Archive escape                | Tarball entry with `../` or a symlink pointing outside the destination | Arbitrary file write outside the cache directory                                        | Validate every entry path resolves under the destination before extracting; reject the whole archive on any violation                                               |
| Snapshot          | Disk exhaustion               | Large monorepo, or many repos accumulating over weeks                  | Cache fills the disk                                                                    | Size cap per snapshot plus 7-day eviction on write                                                                                                                  |
| Snapshot          | Stale tree served silently    | Base branch moved after the last fetch                                 | Caller counts slightly behind reality                                                   | Accepted by design; the staleness bound triggers a refetch and counts tolerate drift. Record `fetchedAt` so a future surface can show it                            |
| Snapshot          | Fetch succeeds, tree is empty | Repository is genuinely empty, or the ref does not exist               | Index reports zero callers for everything, which reads as "safe to collapse everything" | `filesScanned === 0` must map to `available: false`, not to an empty index                                                                                          |
| Import index      | Basename collision            | Two files named `types.ts` in different directories                    | Callers of one attributed to the other, inflating counts                                | Known limitation inherited from `importTargetsFile`; inflation is the safe direction, since it prevents collapse rather than causing it. Do not attempt to fix here |
| Import index      | Dynamic imports missed        | `import(varName)` or a re-export barrel                                | Undercount, which is the dangerous direction — it can cause a wrong collapse            | Accept the undercount but never let it reach zero silently: the evidence line says "0 known callers", not "0 callers"                                               |
| Risk rescoring    | Constant `K` mis-chosen       | Centrality now dominates or vanishes relative to churn                 | Ordering gets worse, not better                                                         | The `centrality` test pins relative ordering of two synthetic files; tune `K` against it                                                                            |
| Context threading | A call site missed            | New code path added later                                              | That path silently reverts to diff-internal counts                                      | `inboundScope` makes the regression visible in the risk hints rather than invisible                                                                                 |

## Validation Commands

```bash
bun test packages/cli/src/__tests__/repo-snapshot.test.ts
bun test packages/cli/src/__tests__/risk.test.ts
bun run test
bun run typecheck
bun run lint
```

## Open Items

- [ ] Pick the size cap. 500 MB is the starting default; if a repo you actually review sits above it, the number is wrong rather than the design.
- [ ] Pick `K` in the rescaled centrality term against the `centrality` test.

---

_This spec is ready for implementation. Follow the patterns and validate at each step._
