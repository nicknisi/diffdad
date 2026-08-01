# Implementation Spec: Attention Lanes - Phase 1

**Contract**: ./contract.md
**Estimated Effort**: M

## Technical Approach

This phase produces every input the queue needs to say _which PRs deserve a human_, and it produces them without a narrative. The command center's current triage signal — `verdict` — is written in exactly one place (`store.ts:264`, inside `setNarrative`), which only runs during the lazy hydrate that fires when a PR is opened. So the queue ranks on a field that is `undefined` for every row it is ranking. This phase replaces that dependency with a **triage summary**: a compact, path-derived record fetched at mint for one REST call and zero model tokens.

The architecture is deliberately one-directional. A new pure module `narrative/triage.ts` classifies a list of file paths; a new pure module `units/lane.ts` maps a triage summary to a lane. Neither performs I/O. The daemon's poller and the add-PR route are the only callers that fetch, and the store is the only thing that persists. Phase 2 renders the lane the CLI assigned and never recomputes it — the lane function is CLI-side precisely so the daemon's lane-split log and the browser's lane labels cannot disagree.

Three wiring facts are load-bearing and were each verified against the codebase during the interview. **`classifyPath` must be composed, never modified** — it feeds `partitionMechanicalFiles` (`engine.ts:218`), which drops files from the LLM prompt, and the `generated` collapse evidence (`collapse.ts:105`), so adding a `manifest` kind to it would silently change narrative generation and chapter collapse. **There are two mint doors** — the poller's `classify`/`create` path and `POST /api/units` (`app.ts:201`), the latter deliberately fetching nothing beyond PR metadata; a PR added by hand lands laneless unless both call the fetch. **`classifyCriticality` and `CRITICALITY_KEYWORDS` are module-private** (`risk.ts:68`, `risk.ts:48`), so `risk.ts` needs an export-only change; restating the keyword table would let lane criticality drift from risk-score criticality.

## Decisions Considered and Rejected

_Carried from the contract; consult before making gap decisions._

- **Gate and lane evidence quantifies over the PR's file list** — rejected: quantifying over narrative chapters. Chapter coverage is not file coverage; `capStats` exists because the prompt budget drops files before the model sees them, so a PR could have every chapter collapsed while an unnarrated file sat in the diff.
- **The caller check is excluded entirely** — rejected: known external callers as a veto. Measured against the real import index: `bun.lock` keys as module `"bun"` and matched 2 bare-specifier importers; `units-view.test.ts` keys as `"units-view"` and matched 12. False positives land on exactly the file kinds this feature targets.
- **Any dependency on the repo snapshot or import index** — rejected. It existed only to serve the caller check; dropping it makes lanes work instantly, with no tarball warmup, and on repos over the 500 MB snapshot cap.
- **Narration stays lazy-on-open** — rejected: a background worker narrating at mint. The file list supplies the lane for one REST call and zero tokens.
- **One file-list page, with more-pages forcing Needs you** — rejected: paginating to completion. `/pulls/{n}/files` pages at 100; a 150-file PR could otherwise hide an auth file on page 2 and land in "Probably not", which is the exact attack the adversarial fixture guards. Truncation is itself a stakes signal.
- **Triage classification is a new function composing `classifyPath`** — rejected: adding a manifest kind to `classifyPath` directly. See Technical Approach.
- **`risk.ts` exports its criticality tagger; triage imports it** — rejected: restating `CRITICALITY_KEYWORDS` in the triage module. Two copies would give two answers to the same question.
- **Both mint doors populate triage** — rejected: wiring the fetch into the poller alone. `POST /api/units` would otherwise produce laneless units for exactly the PRs the reviewer asked for by name.
- **Backfill is a per-existing-unit heal, excluded from the mint-fetch count** — rejected: treating backfill as part of the mint path. It mirrors the `countsDiffer` heal (`poller.ts:131`); counting it in the mint-fetch fake would fail a correct implementation.
- **The stored file list holds paths, kinds, and counts — not patches** — rejected: storing full `DiffFile[]`. Every unit is one JSON file on disk; patch text for unopened units is bloat the lane never reads.
- **`✕` soft-deletes with a dismissal SHA** — rejected: today's hard delete, a permanent dismissal, a Dismissed tab. Hard delete is undone by the poller within 60s because `classify` only checks for an existing unit.
- **Archived PRs are filtered silently** — rejected: a filtered-count note. There is no action available on a read-only repo, so naming it converts unactionable work into an unactionable notification.
- **`PRMetadata.archived` is optional** — rejected: required like `draft`. Units persisted before the field existed carry no value; `false` would claim a lookup that never happened.
- **The lane function lives CLI-side and phase 1 owns it** — rejected: defining it web-side. Two implementations would drift and corrupt the data G7's judgment rests on.
- **G2 states two different cadences** — rejected: one blended figure. The file list is per push; the reviews rollup is per poll and roughly doubles API traffic.
- **`cmd` checks run under a test-name pattern** — rejected: plain suite invocations expecting exit 0. A suite that never gained the named test still exits 0.

## Feedback Strategy

**Inner-loop command**: `bun test packages/cli/src/__tests__/triage.test.ts packages/cli/src/__tests__/lane.test.ts`

**Playground**: The Bun test runner over two pure modules. `triage.ts` and `lane.ts` take plain data and return plain data, so every rule in this phase is reachable without a daemon, a network, or a GitHub token.

**Why this approach**: Every judgment this phase makes is a pure function of a file-path list; the only I/O is one `fetch` that a counting fake replaces. A sub-second test run is therefore the tightest possible loop, and the daemon only needs to come up for the phase's final manual check.

## File Changes

### New Files

| File Path                                   | Purpose                                                                                                                                        |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/cli/src/narrative/triage.ts`      | Pure classifier: file paths → `TriageSummary`. Composes `classifyPath`, adds a `manifest` kind, imports the criticality tagger from `risk.ts`. |
| `packages/cli/src/units/lane.ts`            | Pure lane function: `TriageSummary \| undefined` → `Lane`. Total over absence.                                                                 |
| `packages/cli/src/__tests__/triage.test.ts` | Classification rules, the manifest kind, criticality passthrough, the `classifyPath` non-regression assertion.                                 |
| `packages/cli/src/__tests__/lane.test.ts`   | Lane assignment incl. legacy `undefined`, the truncation veto, and the both-directions discrimination fixtures.                                |

### Modified Files

| File Path                                          | Changes                                                                                                                                                                                                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/cli/src/narrative/risk.ts`               | **Export-only**: add `export` to `classifyCriticality`. No behavior change; `computeRisk` keeps using it unchanged.                                                                                                                       |
| `packages/cli/src/github/client.ts`                | Add `getPRFileSummary(owner, repo, number)` — one page of `/pulls/{n}/files`, returning paths + counts + a `truncated` flag. Must NOT paginate.                                                                                           |
| `packages/cli/src/github/types.ts`                 | Add `PrFileSummary` (path, status, additions, deletions) and the fetch's return shape.                                                                                                                                                    |
| `packages/cli/src/units/types.ts`                  | Add `triage?: TriageSummary` and `dismissedAtSha?: string` to `ReviewUnit`, both optional with the same "absent means never looked" reasoning as `archived?`.                                                                             |
| `packages/cli/src/units/store.ts`                  | Add `setTriage(unitId, summary)` and `dismiss(unitId, headSha)` / `undismiss(unitId)` mutators following the `setMetadataCounts` pattern (mutate, stamp `updatedAt`, `void this.save(unit)`). Accept `triage` in `addGithubUnit`'s input. |
| `packages/cli/src/units/linking.ts`                | `classify` must continue to return `existing-github` for dismissed units so the poller cannot re-mint them. Add `shouldUndismiss(unit, polledHeadSha)` mirroring `shouldResurface`.                                                       |
| `packages/cli/src/daemon/poller.ts`                | Fetch triage at mint; re-fetch when the head SHA moves; backfill units missing a summary (per-existing-unit heal); fetch the reviews rollup per poll; undismiss on a new head SHA; emit the lane-split log line.                          |
| `packages/cli/src/daemon/app.ts`                   | `POST /api/units` fetches triage before minting (second mint door). `DELETE /api/units/:id` becomes a dismissal, not a hard delete. Log the assigned lane when a unit is opened (the hydrate route).                                      |
| `packages/cli/src/daemon/daemon.ts`                | Wire the new file-summary and reviews fetchers into `buildGitHubWiring`.                                                                                                                                                                  |
| `packages/cli/src/daemon/__tests__/poller.test.ts` | Mint/backfill/re-triage/dismiss/undismiss/lane-log coverage.                                                                                                                                                                              |

### Deleted Files

None.

## Implementation Details

### 1. `narrative/triage.ts` — the classifier

**Pattern to follow**: `packages/cli/src/narrative/collapse.ts` (pure module over `DiffFile[]`, closed union of evidence, deliberate module-private copies of shared regexes).

**Overview**: Turns a list of PR file paths into the compact record the lane reads. Every field is derived from a path string; nothing here reads file contents, the repo snapshot, or a narrative.

```typescript
/** What a path is, for triage purposes only. A superset of classifyPath's reasons. */
export type TriageKind =
  | 'lockfile'
  | 'manifest'
  | 'generated'
  | 'vendored'
  | 'minified'
  | 'snapshot'
  | 'binary'
  | 'test-only'
  | 'docs'
  | 'source'; // classifies as nothing mechanical — the one kind that blocks "Probably not"

export type TriagedFile = {
  path: string;
  kind: TriageKind;
  criticality: CriticalityTag[]; // from risk.ts's now-exported tagger
};

export type TriageSummary = {
  files: TriagedFile[];
  /** Distinct criticality tags across every file. Any non-empty value forces Needs you. */
  criticality: CriticalityTag[];
  additions: number;
  deletions: number;
  /** The PR had more than one page of files. Forces Needs you — size is a stakes signal. */
  truncated: boolean;
  /** Head SHA this summary was gathered at, so staleness is detectable. */
  sha: string;
};

export function triageFiles(files: PrFileSummary[], sha: string, truncated: boolean): TriageSummary;
export function triageKind(path: string): TriageKind;
```

**Key decisions**:

- `triageKind` calls `classifyPath(path)` **first** and returns its reason when non-null. Only when `classifyPath` returns null does it apply its own additional rules (manifest, test-only, docs, else source). This ordering is what guarantees the composition is additive and `classifyPath`'s existing consumers are untouched.
- `manifest` matches basenames `package.json`, `requirements.txt`, `Gemfile`, `go.mod`, `Cargo.toml`, `pyproject.toml`, `composer.json`, `pom.xml`, `build.gradle`. **`requirements.txt` must be a manifest, not docs** — the interview's own experiment misclassified it as docs via a naive `\.txt$` rule, which is exactly the "paths encode what a file is named, not what it does" failure this kind exists to avoid.
- `docs` matches `.md` / `.mdx` and paths under `docs/`. It must **not** match `.txt`.
- `test-only` uses the same patterns as `collapse.ts:44`'s module-private `TEST_PATTERNS`. House style here is a local copy over a shared export (see the comment at `collapse.ts:43`); follow it and say so in a comment.
- `criticality` comes from `risk.ts`'s exported `classifyCriticality`. Never restate the keyword table — and note that the obvious alternative does not work either: `computeRisk` is already exported, but it requires full `DiffFile[]` _with hunks_, which the triage summary deliberately does not store ("paths, kinds, and counts — not patches") and the file-list fetch cannot supply. Calling it with empty hunks would return criticality correctly while silently computing meaningless churn and inbound counts. Export the tagger; don't route around it.

**Implementation steps**:

1. Add `export` to `classifyCriticality` in `risk.ts`. Change nothing else in that file.
2. Write `triageKind` with the `classifyPath`-first ordering.
3. Write `triageFiles`, aggregating distinct criticality tags and summing counts.
4. Assert non-regression: `diff-filter.test.ts` and `collapse.test.ts` must pass with no edits to their expectations.

**Feedback loop**:

- **Playground**: `packages/cli/src/__tests__/triage.test.ts` with a table-driven case per kind.
- **Experiment**: Feed `bun.lock`, `package.json`, `requirements.txt`, `README.md`, `docs/x.md`, `src/a.test.ts`, `dist/app.min.js`, `src/auth/token.ts` and assert the exact kind and criticality for each. Then feed the empty list.
- **Check command**: `bun test packages/cli/src/__tests__/triage.test.ts`

### 2. `units/lane.ts` — the lane function

**Pattern to follow**: `packages/web/src/lib/units-view.ts`'s `groupOf` (small, total, switch-shaped).

**Overview**: One pure function, the single source of truth for lane assignment, consumed by both the daemon's log and (via the persisted unit) the browser.

```typescript
export type Lane = 'needs-you' | 'probably-not' | 'in-flight' | 'cleared';

export function laneOf(unit: Pick<ReviewUnit, 'status' | 'triage'>): Lane;
```

**Key decisions**:

- **Status wins first.** `changes_requested` → `in-flight`; `approved`/`done` → `cleared`. Triage only ever splits the `queued` population. This is what leaves the existing lanes untouched.
- **`probably-not` requires positive evidence and no veto**: every file's kind is non-`source`, `criticality` is empty, and `truncated` is false. Anything else is `needs-you`.
- **Total over absence**: `triage === undefined` → `needs-you`. A legacy unit is never neutral and never silently downgraded. This is the fallback the contract's G1 depends on.
- The veto list is exhaustive and stated here rather than discovered during implementation, per the recorded review-triage learning: any `source` file, any criticality tag, `truncated`, or a missing summary.

**Implementation steps**:

1. Write `laneOf` with status precedence, then the conjunction.
2. Test both directions — the "Probably not" lane must be **non-empty** on the fixture queue, so a degenerate all-`needs-you` implementation fails.
3. Test `triage: undefined` explicitly.

**Feedback loop**:

- **Playground**: `packages/cli/src/__tests__/lane.test.ts` holding the five fixture PRs as literal path lists.
- **Experiment**: lockfile+manifest bump → `probably-not`; docs-only → `probably-not`; test-only → `probably-not`; 39 generated + 1 auth constant → `needs-you`; >100 files (`truncated: true`) → `needs-you`; `triage: undefined` → `needs-you`. Assert the `probably-not` set is non-empty.
- **Check command**: `bun test packages/cli/src/__tests__/lane.test.ts`

### 3. `client.getPRFileSummary` — one page, honestly flagged

**Pattern to follow**: `packages/cli/src/github/client.ts`'s `getCheckRuns` (single `this.fetch`, map the payload, return a narrow type).

**Overview**: Fetches the first page of a PR's files and reports whether more exist.

```typescript
async getPRFileSummary(
  owner: string, repo: string, number: number,
): Promise<{ files: PrFileSummary[]; truncated: boolean }>;
```

**Key decisions**:

- `per_page=100`, **one request, no `--paginate` equivalent**. If the response holds exactly 100 entries, set `truncated: true`. (Over-counting by one page-boundary PR is acceptable and fails safe — toward `needs-you`.)
- Discard `patch` from the response. Only path, status, additions, deletions are stored.

**Feedback loop**:

- **Playground**: extend `packages/cli/src/__tests__/github-client.test.ts`, which already installs a `setResponder` fetch fake.
- **Experiment**: a 3-file response → `truncated: false`; a 100-file response → `truncated: true`; assert exactly one `fetch` call in both.
- **Check command**: `bun test packages/cli/src/__tests__/github-client.test.ts -t "file summary"`

### 4. Poller wiring — mint, re-triage, backfill

**Pattern to follow**: the `countsDiffer` heal at `poller.ts:131` — it is the existing precedent for "repair a unit already in the store, only when something actually drifted."

**Key decisions**:

- **Mint**: fetch the summary before `addGithubUnit`, pass it in.
- **Re-triage**: when `pr.headSha !== unit.triage?.sha`, re-fetch and `setTriage`. This is the staleness fix — a push that adds a source file to a docs-only PR moves it out of "Probably not" on the next poll.
- **Backfill**: when `unit.triage === undefined`, fetch once and `setTriage`. Structurally the same call, but it is a **per-existing-unit heal, not a mint** — the mint-time counting fake must not count it, or a correct implementation fails its own criterion.
- **Reviews**: fetch per poll for open units and store the rollup. This is the one recurring cost in the plan; the contract's G2 states it explicitly (≈2× API traffic; ~40 units approaches GitHub's 5000/hr ceiling). Do not silently extend it to dismissed or cleared units.
- **Log**: one lane-split line per pass, e.g. `[diffdad] lanes: 8 queued — 4 needs-you · 4 probably-not · 1 in-flight`.

**Feedback loop**:

- **Playground**: `packages/cli/src/daemon/__tests__/poller.test.ts`, which already has the `det()` deterministic store, the `search([])` fake, and a `settle()` helper. Add a `fileSummarySpy` counting fake alongside them.
- **Experiment**: (a) mint one PR → assert exactly 1 summary fetch and `unit.triage` populated; (b) re-poll the same PR unchanged → assert 0 further fetches; (c) re-poll with a new `headSha` → assert 1 fetch and a changed `triage.sha`; (d) seed a unit with `triage: undefined` → assert exactly 1 backfill fetch, and that the mint-time counter did not see it; (e) `pollOnce` with an AI dep whose call throws → completes normally.
- **Check command**: `bun test packages/cli/src/daemon/__tests__/poller.test.ts -t "triage"`

### 5. Dismissal — `✕` that survives the poller

**Overview**: Today `DELETE /api/units/:id` hard-deletes and `classify` (`linking.ts:18`) only checks for an existing unit, so any still-requested PR is re-minted within 60 seconds. Soft-delete fixes it by keeping the unit findable.

**Key decisions**:

- `dismiss(unitId, headSha)` stamps `dismissedAtSha` and keeps the unit. `classify` still finds it → `existing-github` → no re-mint.
- `shouldUndismiss(unit, polledHeadSha)` mirrors `shouldResurface`: true when `dismissedAtSha` is set and differs from the polled head. The poller clears the flag, returning the PR to `needs-you`.
- Dismissed units are excluded from lane counts and from the reviews fetch, and are **not** reconciled away by the miss-streak path.
- The route keeps its `404` behavior for unknown ids and still broadcasts `units`.

**Failure to avoid**: dismissing a unit must not also suppress the archived-repo removal. An archived PR that was dismissed should still be hard-removed — dismissal hides work you _could_ do; archived removal drops work you _cannot_.

**Feedback loop**:

- **Playground**: the same poller test file; the existing pinned-unit tests (`poller.test.ts`, "never reconciles a pinned unit away") are the closest prior art for "a unit the poller must leave alone".
- **Experiment**: (a) dismiss a unit, poll twice with the PR still in the search → asserted still present, still hidden, never re-minted; (b) poll with a changed `headSha` → `dismissedAtSha` cleared and the unit back in `needs-you`; (c) dismiss a unit whose repo is then archived → hard-removed anyway; (d) `DELETE` an unknown id → still `404`.
- **Check command**: `bun test packages/cli/src/daemon/__tests__/poller.test.ts -t "dismiss"`

## Data Model

### State Shape

```typescript
// Added to ReviewUnit — both optional, matching pinned? / capStats? / archived?
type ReviewUnit = {
  // …existing fields…
  /** Path-derived triage inputs, gathered at mint and refreshed when the head SHA moves.
   *  Absent on units minted before this shipped; the poller backfills them, and `laneOf`
   *  treats absence as `needs-you` so a legacy unit is never neutral. */
  triage?: TriageSummary;
  /** Head SHA at which the reviewer dismissed this row with ✕. Present = hidden from every
   *  lane. Cleared when the polled head moves past it, which returns the PR as new work. */
  dismissedAtSha?: string;
  /** Latest per-reviewer rollup, refreshed each poll. Orders within a lane; never gates one. */
  reviewRollup?: { approved: number; changesRequested: number };
};
```

## API Design

No new endpoints. Two behavior changes to existing ones:

| Method   | Path             | Change                                                                                                                |
| -------- | ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/api/units`     | Fetches the file summary before minting, so hand-added PRs carry a lane. Still returns `201` / `200 {existing:true}`. |
| `DELETE` | `/api/units/:id` | Dismisses (soft-delete + `dismissedAtSha`) instead of hard-deleting. Response shape unchanged.                        |

## Testing Requirements

### Unit Tests

| Test File                                          | Coverage                                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `packages/cli/src/__tests__/triage.test.ts`        | Every `TriageKind`; `classifyPath`-first ordering; `requirements.txt` → manifest not docs; criticality sourced from `risk.ts`. |
| `packages/cli/src/__tests__/lane.test.ts`          | Lane per fixture; `triage: undefined` → `needs-you`; truncation veto; both-directions discrimination.                          |
| `packages/cli/src/__tests__/github-client.test.ts` | One-page fetch, `truncated` flag, exactly one request.                                                                         |
| `packages/cli/src/daemon/__tests__/poller.test.ts` | Mint, re-triage on new SHA, backfill heal, dismissal survival, undismiss on push, lane-split log.                              |

**Key test cases**:

- A PR that is all-docs lands `probably-not`; adding one `src/*.ts` file on a new SHA moves it to `needs-you` on the next poll.
- 39 generated files + `src/auth/expiry.ts` → `needs-you` (criticality veto beats bulk).
- A 100-file response → `truncated: true` → `needs-you` regardless of kinds.
- A unit with `triage: undefined` → `needs-you`, then backfilled by the next poll.
- A dismissed unit still returned by the search is **not** re-minted; after a head-SHA change it reappears.
- `pollOnce` with an AI dep that throws on call completes normally (no model calls at mint).
- Exactly one file-summary fetch per minted PR; backfill heals are counted separately.

### Manual Testing

- [ ] `bun packages/cli/src/cli.ts daemon --port=45677 --no-open`, then `curl -s localhost:45677/api/units | jq '.units[] | {repo, prNumber, lane: .triage.files|length}'`
- [ ] Confirm the archived `dojo/cli-export-project#10` is absent with no note.
- [ ] `✕` a row, wait two poll passes, confirm it stays gone.

## Failure Modes

| Component               | Failure Mode                               | Trigger                                                    | Impact                                                                  | Mitigation                                                                                                           |
| ----------------------- | ------------------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `triageKind`            | Silent prompt-filter change                | `classifyPath` modified instead of composed                | Narrative generation and collapse evidence change without anyone asking | Non-regression assertion: `diff-filter.test.ts` + `collapse.test.ts` pass unedited                                   |
| `laneOf`                | Laneless legacy units                      | `triage` absent on units minted pre-feature                | Rows render the neutral state G1 exists to remove                       | Total function (`undefined` → `needs-you`) **and** poller backfill — both, since the backfill needs a poll to arrive |
| `getPRFileSummary`      | Page-2 dilution                            | PR >100 files hides a critical file on a later page        | An auth change lands in "Probably not"                                  | `truncated: true` forces `needs-you`; never paginate                                                                 |
| Poller reviews fetch    | Rate-limit exhaustion                      | Queue grows toward ~40 open units at 60s polling           | GitHub 403s; the whole poll pass fails, not just reviews                | Skip dismissed/cleared units; treat a reviews failure as non-fatal and keep the last rollup                          |
| Dismissal               | Dismissed PR never returns                 | Author force-pushes to the same SHA, or never pushes again | Work silently disappears from the queue                                 | `dismissedAtSha` compared on every poll; the unit remains in the store and reachable behind the dismissed count      |
| Dismissal vs. archive   | An archived PR is only hidden, not removed | Unit dismissed, then its repo is archived                  | A permanently unactionable PR occupies the dismissed list               | Archived removal runs before the dismissal check and hard-removes regardless                                         |
| `setTriage` persistence | Lost summary on crash                      | `void this.save(unit)` is fire-and-forget by design        | Unit reverts to laneless after restart                                  | Acceptable — the next poll backfills it; do not add a await/flush that changes the store's synchronous contract      |

## Validation Commands

```bash
bun run typecheck
bun run lint
bun run format:check
bun test packages/cli/src -t "lane"
bun test packages/cli/src -t "backfill"
bun test packages/cli/src -t "no model call"
bun test packages/cli/src -t "file-list fetch"
bun test packages/cli/src -t "fixture lane"
bun test packages/cli/src -t "re-triage"
bun test packages/cli/src -t "dismiss"
bun test packages/cli/src -t "pinned triage"
bun test packages/cli/src -t "criticality source"
bun test packages/cli/src -t "archived"
bun test packages/cli/src/__tests__/diff-filter.test.ts packages/cli/src/__tests__/collapse.test.ts
bun run test
```

## Rollout Considerations

- **Feature flag**: none. Lanes are additive and the fallback (`needs-you`) is the current behavior.
- **Monitoring**: the lane-split log line per poll; the per-open lane line. Both persist via launchd's `StandardOutPath`, so the two-week judgment has a durable source.
- **Rollback plan**: revert the branch. `triage` and `dismissedAtSha` are optional fields; an older binary reading a newer unit file ignores them.

## Open Items

None.

---

_This spec is ready for implementation. Follow the patterns and validate at each step._
