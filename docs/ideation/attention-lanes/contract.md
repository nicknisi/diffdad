# Attention Lanes Contract

**Created**: 2026-07-31
**Readiness**: All 5 gates ready
**Status**: Approved
**Approval**: Interactive review
**Supersedes**: None

## Problem Statement

The daemon's command center promises triage and delivers a list. Its lanes are status lanes (queued / changes-requested / done), so "Needs you" is a synonym for "everything actionable", and every row renders at identical visual weight whether it is a four-line typo fix or a nine-hundred-line auth refactor.

The signal meant to rank the queue does not exist when the queue is rendered. `verdict` is cached from `narrative.verdict` and written in exactly one place — `setNarrative` (store.ts:264) — which runs during the lazy hydrate that only fires when a PR is opened. So for every PR the reviewer has not already opened, `verdict` is undefined: `verdictTone` returns `neutral`, the row leads with a grey bullet, and `groupUnits`' sort by VERDICT_RANK finds all zeros and silently degrades to oldest-first. `toResolve` is initialised to 0 at mint (store.ts:146) and rendered unconditionally, so fresh rows assert "0 to resolve" as though it were measured.

Two smaller defects compound it. PRs in archived repositories keep resurfacing even though GitHub serves those repos read-only, so neither approving nor commenting can succeed — a review request from 2018-02-13 on dojo/cli-export-project, archived in 2018, sat in the real queue during this interview. And the row's ✕ does not stick: `DELETE /api/units/:id` hard-deletes, `classify` (linking.ts:18) only checks whether a unit already exists, and nothing records the dismissal — so any PR GitHub still requests is re-minted on the next poll pass, within 60 seconds.

The cost is paid in the reviewer's attention, which is the scarce resource this tool exists to protect: the queue cannot say which PRs need a human, so every one gets opened to find out, and the two affordances for reducing the pile either show work that cannot be done or undo themselves within a minute.

## Goals

1. Every queued unit lands in a named lane using only data available without a narrative — including units persisted before this ships — so no row in the command center renders the neutral placeholder state that unopened PRs show today, and no row claims "0 to resolve" as a measurement.
2. Triage costs no model calls at any point, one file-list page fetch per PR per push, and one reviews fetch per open unit per poll pass. Those are different cadences and the plan owns both: at the 60s default the reviews fetch roughly doubles API traffic and approaches GitHub's 5000/hr ceiling around forty open units.
3. Lane assignment discriminates on fixtures and stays honest as PRs change: a PR whose every file classifies as mechanical lands in "Probably not", any criticality tag forces "Needs you" regardless of size, a PR too large for one file-list page forces "Needs you" because size is itself a stakes signal, and a push that adds a source file to a previously-mechanical PR moves it back to "Needs you" on the next poll.
4. The queue reflects the reviewer's obligation, not only the diff's shape: a PR others have already approved ranks below one where the reviewer is the sole outstanding reviewer.
5. PRs whose base repository is archived never appear in the queue and are removed silently if already present — no note, no filtered-count, because there is no action the reviewer could take on one.
6. Dismissing a row with ✕ survives the poller: the PR stays hidden until its author pushes, at which point it returns to the queue as genuinely new work.
7. The reviewer opens fewer PRs that turn out not to need them — judged after roughly two weeks of real use, against per-poll lane-split counts and a logged lane for every PR actually opened.

## Success Criteria

- [ ] A unit with a populated triage summary and `narrative: undefined` resolves to a named lane, and a legacy unit carrying no triage summary at all resolves to "Needs you" rather than a neutral state — the lane function is pure over the stored summary and total over its absence. — check: `bun test packages/cli/src -t "lane"` → non-zero pass count, 0 fail
- [ ] The poller backfills a triage summary onto units minted before this shipped — a per-existing-unit heal mirroring countsDiffer, distinct from the mint-time fetch — so a queue that predates the feature converges without the reviewer re-adding anything. — check: `bun test packages/cli/src -t "backfill"` → non-zero pass count, 0 fail
- [ ] A PR added by hand through POST /api/units carries a triage summary and a lane, exactly as a polled one does — both mint doors populate it. — check: `bun test packages/cli/src -t "pinned triage"` → non-zero pass count, 0 fail
- [ ] Lane criticality and risk-score criticality come from one table: the triage module imports the tagger from risk.ts rather than restating CRITICALITY_KEYWORDS, so the two can never drift. — check: `bun test packages/cli/src -t "criticality source"` → non-zero pass count, 0 fail
- [ ] `pollOnce` completes a full mint with an AI dependency that throws if invoked, proving minting never reaches the narrative engine. — check: `bun test packages/cli/src -t "no model call"` → non-zero pass count, 0 fail
- [ ] Minting one PR issues one file-list page fetch, asserted by a counting fake; a PR reporting further pages is not paginated through but is forced into "Needs you" and flagged truncated. — check: `bun test packages/cli/src -t "file-list fetch"` → non-zero pass count, 0 fail
- [ ] Purpose-built fixtures — a lockfile+manifest bump, a docs-only PR, a test-only PR, a >100-file PR, and an adversarial PR of 39 generated files plus one auth-constant change — each land in their expected lane, with the last two in "Needs you". — check: `bun test packages/cli/src -t "fixture lane"` → non-zero pass count, 0 fail
- [ ] A push that adds a source file to an already-minted docs-only PR re-fetches triage on the next poll and moves the unit out of "Probably not" — stale evidence cannot outlive the head SHA it was gathered at. — check: `bun test packages/cli/src -t "re-triage"` → non-zero pass count, 0 fail
- [ ] Triage classification composes `classifyPath` without modifying it: the prompt filter and collapse evidence behave identically, proven by the pre-existing suites passing with no edits to their expectations. — check: `bun test packages/cli/src/__tests__/diff-filter.test.ts packages/cli/src/__tests__/collapse.test.ts` → exits 0 with no changes to either file in the diff
- [ ] Sort order places a PR with two existing approvals below an otherwise-identical PR with none. — check: `bun test packages/cli/src -t "approval ordering"` → non-zero pass count, 0 fail
- [ ] An archived-repo PR is never minted, is removed if already present, is removed even with no reconcile dependency wired, and produces no user-visible note — the queue simply does not contain it. — check: `bun test packages/cli/src -t "archived"` → non-zero pass count, 0 fail
- [ ] The lane function is discriminating in both directions: the fixture queue puts the mechanical PRs in "Probably not" AND leaves that lane non-empty, so an implementation that routes everything to "Needs you" fails rather than passes. — check: `bun test packages/cli/src -t "lane discrimination"` → non-zero pass count, 0 fail; the assertion on a non-empty Probably-not lane is present
- [ ] A dismissed unit is not re-minted by a poll pass that still sees its PR in the review-request search, and is resurfaced when the polled head SHA differs from the SHA it was dismissed at. — check: `bun test packages/cli/src -t "dismiss"` → non-zero pass count, 0 fail
- [ ] The command center renders four lanes — Needs you, Probably not, In flight, Cleared — with dismissed units excluded from all of them and reachable behind a count, and no row displaying a "0 to resolve" placeholder. — check: `bun run --filter '@diffdad/web' test -- -t "lane render"` → non-zero pass count, 0 fail
- [ ] The daemon logs a lane-split count on each poll pass and the assigned lane for each unit actually opened, so the two-week judgment reads data rather than recollection. — check: `bun test packages/cli/src -t "lane log"` → non-zero pass count, 0 fail
- [ ] The reviewer runs the daemon against their real queue and agrees the lanes read correctly — nothing that needed them sitting in "Probably not", the archived 2018 PR simply absent, ✕ actually sticking, and row weight tracking stakes rather than distracting. — judgment call: Nick, running the daemon on a scratch port per the repo's `verify` skill, reading his own queue
- [ ] After roughly two weeks of real use, the reviewer judges that fewer PRs are being opened that turn out not to need them, reading the logged open-events against their lanes. — judgment call: Nick, reading accumulated lane-split and per-open log lines alongside his own experience

## Scope Boundaries

### In Scope

- Fetch each PR's first file-list page at mint and on head-SHA change, storing a compact triage summary — paths, mechanical kind per path, criticality tags, counts, and a truncated flag when more pages exist — Path data is the only input the lane needs, it costs one REST call and zero model tokens, and re-fetching on push is what stops stale evidence from outliving the diff it described.
- A triage classifier that composes `classifyPath` and adds a `manifest` kind for package.json and friends — package.json blocked 17 of 30 sampled dependabot PRs from classifying, but classifyPath feeds partitionMechanicalFiles (engine.ts:218) and collapse evidence (collapse.ts:105), so extending it in place would silently change narrative generation.
- A pure lane function, CLI-side, over the stored triage summary — total over a missing summary — Both the daemon (which logs lane splits) and the web UI (which renders lanes) need the answer; two implementations would drift and corrupt the very data the two-week judgment depends on.
- Fetch each open unit's reviews at poll time and store the approved / changes-requested rollup — Turns "do I need to care" into a fact about the reviewer rather than only about the diff. Its recurring cost is real and now stated in G2 rather than hidden; summarizeReviews already exists.
- A "Probably not" lane between the existing Needs you and In flight, with a one-line evidence reason on every row — Splits the actionable queue by attention while leaving In flight and Cleared untouched — the smallest change that delivers the labeling, since In flight was never part of the problem.
- Rows sized by stakes, leading with the reason rather than a glyph, and the "0 to resolve" placeholder removed — A four-line typo fix and a nine-hundred-line auth refactor currently render identically, and the placeholder count asserts a measurement that was never taken. Row weight is covered by the judgment criterion so it cannot be silently dropped or silently expanded.
- ✕ becomes a dismissal that survives the poller: soft-delete stamped with the head SHA, hidden from every lane, resurfaced when the author pushes — Today ✕ hard-deletes and the poller re-mints within 60s, so the one control for shrinking the queue undoes itself. Reuses classify's existing-unit guard and shouldResurface rather than adding a suppression list.
- A per-poll lane-split count and a per-open lane log line in the daemon — G7 is judgment-only by necessity; the split alone shows distribution but not behavior, so the open-event line is what makes it a measurement rather than an impression.

### Out of Scope

- The inline approve button — Measured: the gate fires on 0 of 47 merged diffdad PRs and 5 of 30 sampled dependabot PRs, and the kinds it does fire on — lockfiles and manifests — are the supply-chain surface, the worst thing to approve unread.
- The evidence gate and its settings configuration — There is no gate to configure once the button is out; a config field added now would encode a guess with no data behind it.
- "Known external callers" as a signal of any kind — Measured unreliable for these file kinds: moduleNameFromPath truncates at the first dot, so bun.lock keys as "bun" and matched 2 bare-specifier importers, and every X.test.ts collides with X.ts (12 spurious callers on units-view.test.ts). Coarse-by-design is fine where a false positive is conservative; it is not fine here.
- Any dependency on the repo snapshot or import index — It existed only to serve the caller check. Dropping it makes lanes work instantly, with no tarball warmup, and on repositories over the 500 MB snapshot cap.
- Eager narration of queued PRs — Explicitly declined; the file list delivers the lane for one REST call and zero tokens, so the expensive path buys nothing the cheap one does not.
- Paginating past the first file-list page — A PR with more than 100 files is not a "probably not" candidate under any reading, so the truncated flag forcing Needs you is both cheaper and safer than fetching the rest.
- CODEOWNERS parsing and path matching — Strongest obligation signal, but neither the parser nor the glob matcher exists, and the reviews rollup already moves the signal from the diff to the reviewer.
- A weighted risk score with a configurable threshold — Any score safe enough to gate on needs criticality as a veto, at which point the conjunction does the work and the number is decoration; and a threshold has no ground truth to calibrate against, so it only ever ratchets looser.
- A permanent dismissal or a dedicated Dismissed tab — Dismiss-until-push self-clears on genuinely new work, so it needs no un-dismiss UI and cannot strand a PR that has since changed.
- Auto-approving anything, under any condition — Standing exclusion from the brainstorm; nothing measured since has weakened it.
- Restructuring the In flight or Cleared lanes — changes_requested means the ball is with the author and already leaves the actionable queue; it was never part of the stated problem.

### Future Considerations

- Revisit the approve button once the lane-split and open-event logs show the reviewer's real PR mix — neither corpus measured here was their own queue.
- A caller check keyed on full relative paths rather than first-dot module names, which would remove the collision problem and could then be trusted.
- Bounding the per-poll reviews fetch if the queue ever approaches the ~40-unit rate-limit ceiling G2 names.
- CODEOWNERS-based ownership once a parser and matcher exist.

## Decisions Considered and Rejected

- **Gate and lane evidence quantifies over the PR's file list** — rejected: Quantifying over narrative chapters (the original all-skim idea). Chapter coverage is not file coverage — capStats exists precisely because the prompt budget drops files before the model sees them, so a PR could have every chapter collapsed while an unnarrated file sat in the diff. Quantifying over files makes coverage total by construction, and needs no narrative, which is what let lazy narration stay.
- **No weighted score gates any outward action** — rejected: A configurable score with a numeric threshold. A safe score must treat criticality as a veto rather than a weight — otherwise 39 generated files dilute one token-expiry change — and once vetoes exist the conjunction is the safety mechanism. The threshold also has no ground truth to calibrate from and adjusts one-directionally in practice.
- **Narration stays lazy-on-open** — rejected: A background worker narrating every unit at mint. Chosen by the reviewer; the file-list fetch supplies the lane for one REST call and zero tokens, so eager generation would spend model calls on PRs that never get opened to buy a signal the cheap path already provides.
- **The caller check is excluded entirely** — rejected: Using known external callers as a veto, with snapshot-unavailable guarding it. Measured against the real import index: bun.lock keys as module "bun" and matched 2 importers; units-view.test.ts keys as "units-view" and matched 12. The false positives land on exactly the file kinds the feature targets.
- **The snapshot-unavailable veto is also excluded** — rejected: Keeping it as an independent safety condition. It guarded only the caller check. With that gone the snapshot is unused, so the veto would darken the feature during tarball warmup and on oversized repos while protecting nothing.
- **The approve button is out of v1, and the whole gate with it** — rejected: Shipping the button live, or shipping it in shadow-logged form. Chosen by the reviewer after the hit-rate measurements. Scope drops substantially — no gate, no config, no settings section, no approve-route wiring — and the stated problem is still solved by the lanes.
- **The four selected evidence kinds become lane inputs rather than gate inputs** — rejected: Discarding them as moot once the button was cut. The lane is advisory and the gate was strict — different bars — so a generous evidence set is correct for lanes even though it would have been too permissive for an outward action.
- **One new lane, inserted into the existing three** — rejected: A two-lane model replacing the current grouping, and a four-attention-lane taxonomy. Raised by the scope-creep critic: the contract named Needs you / Probably not / Cleared and never said what became of In flight, which groupOf currently populates from changes_requested. Keeping In flight untouched is both the smallest diff and the honest state — the ball is with the author.
- **Lane membership and any future button eligibility use different bars** — rejected: One bar where lane membership implies eligibility. Mis-laning costs attention; mis-gating costs an approval under the reviewer's name. Sharing a bar would force the lane down to the gate's strictness and refill "Needs you" with noise.
- **The lane function lives CLI-side and phase 1 owns it** — rejected: Defining it web-side in units-view.ts alongside groupUnits. Raised by the success-criteria critic: phase 1 logs lane splits while phase 2 would have defined the lane, so phase 1 needed a second CLI-side implementation. Two implementations of the same rule would drift and corrupt the data G7's judgment rests on.
- **Triage classification is a new function composing classifyPath** — rejected: Adding a manifest kind to classifyPath directly. classifyPath feeds partitionMechanicalFiles (engine.ts:218), which drops files from the LLM prompt, and the generated collapse evidence (collapse.ts:105). Extending it would change what the model sees and what collapses, neither of which this project intends to touch.
- **One file-list page, with more-pages forcing Needs you** — rejected: Paginating to completion, and asserting "exactly one fetch" against a paginating endpoint. Raised by the over-engineering critic: /pulls/{n}/files pages at 100, so the original criterion would either truncate large PRs silently or fail on correct code — and it broke on the >100-file class the problem statement uses as its motivating contrast. Treating truncation as a stakes signal keeps one fetch honest and is safer than the alternative.
- **G2 states two different cadences rather than one** — rejected: Leaving G2's "one fetch per PR per push" wording with the reviews fetch inside it. Flagged independently by the scope-creep and over-engineering critics. The reviews rollup is per unit per poll, which at 60s roughly doubles API traffic and approaches the 5000/hr ceiling near forty units. The reviewer accepted that cost knowingly; the defect was the accounting, so the accounting is what changed.
- **✕ soft-deletes with a dismissal SHA** — rejected: Today's hard delete, a permanent dismissal, and a dedicated Dismissed tab. Hard delete is undone by the poller within 60s because classify only checks for an existing unit. A permanent dismissal can strand a PR that later gains 40 commits. Stamping the head SHA reuses shouldResurface, needs no un-dismiss UI, and returns the PR exactly when there is new work.
- **Archived PRs are filtered silently** — rejected: Showing a filtered-count note naming what was hidden. Requested by the reviewer: GitHub serves archived repos read-only, so there is no action available on one. Naming it converts an unactionable PR into an unactionable notification.
- **The stored file list holds paths, kinds, and counts — not patches** — rejected: Storing the full DiffFile[] at mint. Every queued unit is persisted as one JSON file; carrying full patch text for units nobody has opened would bloat that store for data the lane never reads.
- **PRMetadata.archived is optional** — rejected: Making it required like the sibling `draft` field. 38 construction sites across 26 files, and units persisted before the field existed carry no value — `false` there would claim a lookup that never happened. Read `archived === true`, never `!archived`. Matches how pinned? and capStats? already work.
- **CI status is not consulted** — rejected: Treating failing or in-flight CI as a signal. Approval is not merge, and branch protection already blocks red PRs from landing, so the signal would duplicate a gate GitHub already enforces.
- **Both mint doors populate triage, and the spec names them** — rejected: Wiring the fetch into the poller's create path alone. Raised by the hidden-dependency critic: POST /api/units (app.ts:201) is a second mint door that deliberately fetches nothing beyond PR metadata, so hand-added PRs would have landed laneless — contradicting G1's 'every queued unit' for exactly the PRs the reviewer asked for by name.
- **risk.ts exports its criticality tagger; triage imports it** — rejected: Restating CRITICALITY_KEYWORDS inside the triage module. Raised by the hidden-dependency critic: classifyCriticality (risk.ts:68) and its keyword table (risk.ts:48) are module-private, so the classifier could not reach them. A second copy would let lane criticality drift from risk-score criticality — two answers to the same question, which is the defect the single lane function was moved CLI-side to avoid.
- **Backfill is a per-existing-unit heal, excluded from the mint-fetch count** — rejected: Treating backfill as part of the mint path. Raised by the hidden-dependency critic: it mirrors the existing countsDiffer heal (poller.ts:131), which runs over units already in the store. Counting it in criterion 4's mint-time fetch fake would make a correct implementation fail the check.
- **cmd checks run under a test-name pattern** — rejected: Plain suite invocations expecting only exit 0. Raised by the success-criteria critic: a suite that never gained the named test still exits 0, so every criterion was vacuously satisfiable. Both runners support the filter (bun test -t, vitest -t), verified during the interview.

## Execution Plan

_Added during Phase 5 handoff. Pick up this contract cold and know exactly how to execute._

### Dependency Graph

```
Triage inputs and the lane function
  └── The Probably-not lane in the queue  (blocked by Triage inputs and the lane function)
```

### Execution Steps

**Run the project** (recommended) — autopilot reads this contract, plans dependency waves, runs independent phases in parallel, and gates on failure:

```bash
/ideation:autopilot docs/ideation/attention-lanes/contract.md
```

**Or run it unattended** — a `/goal` is a durability wrapper around the same autopilot run: Claude re-checks the condition before it is allowed to stop, so failures get repaired and re-run. Generated by `contract-gen --print-goal`; this is the only copy of that string:

```
/goal Drive the Attention Lanes contract (attention-lanes) to completion with /ideation:autopilot.

1. Run `/ideation:autopilot docs/ideation/attention-lanes/contract.md`.
2. It dispatches a BACKGROUND workflow. Wait for the completion notification — never start a second autopilot run while one is in flight.
3. Then run the ideation plugin's `scripts/verify.mjs` against `docs/ideation/attention-lanes/contract-data.json` and leave its VERIFY line in the conversation. Resolve the plugin's install directory first — `${CLAUDE_PLUGIN_ROOT}/scripts/verify.mjs` is a placeholder, not a shell variable, and bash will not expand it. That line is the only evidence this goal is judged on.
4. If anything failed, fix the spec or the implementation and go back to step 1. Autopilot skips phases that already have commits.

Done when the most recent VERIFY line reads fail=0 and commits=2/2 — or when two consecutive VERIFY lines are identical and still failing, in which case name the failing checks and stop, because a contract whose checks have rotted must not trap the run.
```

**Or run phases manually** in dependency order:

**Strategy**: Sequential

1. **Phase 1** — Triage inputs and the lane function _(blocking)_

   ```bash
   /ideation:execute-spec docs/ideation/attention-lanes/spec-phase-1.md
   ```

2. **Phase 2** — The Probably-not lane in the queue _(blocking)_

   ```bash
   /ideation:execute-spec docs/ideation/attention-lanes/spec-phase-2.md
   ```

---

_This contract was generated from brain dump input. Review and approve before proceeding to specification._
