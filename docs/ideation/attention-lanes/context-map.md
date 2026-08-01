# Context Map: attention-lanes

**Phase**: 2
**Gates**: 5/5 ready
**Verdict**: GO

## Gates

| Gate                 | Status | Evidence                                                                                                                                                                                                                                                                                                           |
| -------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Scope clarity        | ready  | All 7 spec-listed files read and their current state understood; the 3 unlisted files needed for `dismissedCount` to be non-zero (`useUnits.ts`, `useLiveStream.ts`, `review-store.ts`) and the missing render-test file are named in Risks.                                                                       |
| Pattern familiarity  | ready  | Read `groupUnits`/`groupOf` (`units-view.ts:10-62`), `TONE`/`SOURCE_TONE`/`STATUS_META` records (`UnitRow.tsx:5-23`), `GroupLabel`/`Panel`/`showCleared` (`CommandCenter.tsx:29-52,358-381`), CLI `laneOf` (`lane.ts:59-69`), and both web test patterns (`renderToStaticMarkup` in node env, `happy-dom` opt-in). |
| Dependency awareness | ready  | `groupUnits`/`GroupedUnits` consumed only by `useUnits.ts:3,52`; `UnitRow` only by `CommandCenter.tsx:342,352,376`; `unitsPayload` by 8 call sites in `app.ts` plus one inline copy in `poller.ts:305`; every other `units-view` import is of unrelated exports.                                                   |
| Edge case coverage   | ready  | Concrete list below, including the wire-shape gap that makes the dismissed count structurally 0, the unhydrated-`changedFiles` trap already documented at `UnitRow.tsx:52-54`, and the repo-filter/count interaction.                                                                                              |
| Test strategy        | ready  | Ran `bun run --filter '@diffdad/web' test -- -t "lane"` — arg forwarding works (163 tests skipped, exit 0). `bun run typecheck` is green at baseline. Node-env constraint and the two render-test patterns are identified.                                                                                         |

## Key Patterns

- `packages/web/src/lib/units-view.ts:10-62` — the `groupOf`/`groupUnits`/`GroupedUnits` triple to widen. `VERDICT_RANK` + `updatedAtMs` are the existing sort primitives; `recentFirst` is the in-flight/cleared comparator. Every export is a pure function over `Unit[]`; module-level JSDoc carries the "why" in prose, matching house style.
- `packages/cli/src/units/lane.ts:12-84` — phase 1's source of truth. `Lane`, `LaneInput` (a `Pick`, not a full `ReviewUnit`), `NeedsYouReason` (the closed union the row's reason should mirror), `laneOf`, `isDismissed`, `laneSplit`. This is the module the web must NOT copy.
- `packages/cli/src/narrative/triage.ts:27-62,123-171` — `TriageKind` (11 members), `TriagedFile`, `TriageSummary` (`files`, `criticality`, `additions`, `deletions`, `truncated`, `sha`), `isMechanicalKind`. These are the exact shapes the web mirror must reproduce. `CriticalityTag` is an 11-member union at `narrative/risk.ts:35-46`.
- `packages/web/src/lib/collapse.ts:86-90` — the precedent the spec cites for hand-copying a CLI pure function web-side, with the comment explaining why. The lane is the opposite call (server-sent), so the new mirror should say so explicitly.
- `packages/web/src/components/UnitRow.tsx:5-58` — tone-record lookup, single full-width `<button>` click target, CSS-custom-property colors only, `meta[]` array joined with `·`. Line 52-54 carries the discipline the reason line needs: "an unknown beats a lie".
- `packages/web/src/components/CommandCenter.tsx:29-52,336-381` — `GroupLabel` (title + count, no subtitle slot yet), `Panel`, and the `showCleared` toggle to mirror for the dismissed reveal.
- `packages/web/src/components/__tests__/collapse-render.test.tsx:1-14` — `renderToStaticMarkup` in the default node environment. `UnitRow` is prop-driven, so this is the right pattern for the "no row says `to resolve`" assertion.
- `packages/web/src/components/__tests__/chapter-precedence.test.tsx:1-18,104` — the `// @vitest-environment happy-dom` opt-in plus `useReviewStore.setState({...})` seeding, the only pattern that works for a store-driven component like `CommandCenter`.
- `docs/ideation/attention-lanes/mockup.html:788-855` — row anatomy (`rowHtml`), `kindSummary()` at :849-855 is a literal reference implementation for the mechanical-kind reason, and :838-844 is the drawer. Lane subtitles at :884, :890, :896; dismissed reveal at :902.

## Dependencies

- `units-view.ts:44-62` (`groupUnits`, `GroupedUnits`) → `hooks/useUnits.ts:3,52` only → `CommandCenter.tsx:60`. Widening `GroupedUnits` breaks nothing else; the other 11 `units-view` importers use unrelated exports.
- `units-view.ts:10-21` (`groupOf`) → `buildRepoFacets` (same file, :120) and `UnitRow.tsx:41`. The facet sidebar's `needsYou` count is computed from `groupOf(u.status)`, so once the lane exists the sidebar count and the "Needs you" lane header will disagree. Not in the spec's file list; decide deliberately.
- `UnitRow.tsx` → `CommandCenter.tsx:342,352,376` only. No tests import it.
- `daemon/app.ts:196-201` (`unitsPayload`) → 8 call sites in the same file. One edit covers all eight.
- `daemon/poller.ts:304-309` — the ninth emission point, an inline object literal that does not call `unitsPayload`.
- `daemon/app.ts:352-356` (`GET /api/units/:id`) — returns a bare `unit` with no lane. `unit.lane` will be `undefined` in the drill-in.

## Conventions

- **Naming**: `camelCase` functions, `PascalCase` types/components. Pure view logic lives in `lib/*.ts`, never in components. Tone/meta lookup tables are `SCREAMING_SNAKE` `Record<Union, Shape>` consts at module top.
- **Imports**: relative, no barrels. `import type` for type-only imports. `packages/web` never imports from `packages/cli` — types are hand-mirrored with a comment naming the CLI source file.
- **Error handling**: missing data degrades to omission, never to a fabricated zero (`UnitRow.tsx:52-54`). Optional fields are optional precisely so absence stays distinguishable from measured-zero.
- **Types**: `type` aliases only. Unions closed and exhaustively switched. `strict` + `noUncheckedIndexedAccess` are on.
- **Testing**: `__tests__/` beside the module. `mkUnit(over: Partial<Unit>)` factory at `units-view.test.ts:22-36` is the fixture builder to extend.
- **Comments**: unusually dense and load-bearing. Every non-obvious decision carries a prose "why" citing the alternative rejected.

## Risks

- **`dismissedCount` is structurally unreachable as specified.** The server splits dismissed units out before the wire (`app.ts:196-201`, `poller.ts:305-309`), and the client reads only `data.units`. `groupUnits(units)` will never see a dismissed unit, so a filter-and-count inside `units-view.ts` yields a permanent `0`. Fix requires three files the spec does not list: `hooks/useUnits.ts`, `hooks/useLiveStream.ts:193-200`, `state/review-store.ts`.
- **The contract's own check command has no test that can satisfy it.** `-t "lane render"` must produce a non-zero pass count covering "no row displaying a `0 to resolve` placeholder" — a render assertion. `units-view.test.ts` is pure and cannot prove it. The spec says "New Files: None", but a component test file is needed.
- **The mockup's reviewer copy is not derivable from the wire.** `mockup.html:617,665,711` render "1 of 3 reviewers". The payload carries only `reviewRollup: { approved, changesRequested }` — no reviewer total. The spec's `reasonLine` omits reviewers entirely; the spec's stricter version is the safe read.
- **`buildRepoFacets` will disagree with the lane headers.** It counts `needs-you` via `groupOf(u.status)` (`units-view.ts:120`), routing every `queued` unit — including probably-not ones — into the facet count.
- **Type-name collision in the web mirror.** `state/types.ts:187` already exports `TriageSeverity` ('risk' | 'warn' | 'info') for the beat rail — an unrelated concept.
- **`unitsPayload`'s return type must widen.** Annotated `{ units: ReviewUnit[]; dismissed: ReviewUnit[] }` (`app.ts:196`). `laneOf` is already imported at `app.ts:14`.
- **Drawer height on truncated PRs.** `triage.files` holds only the 100 fetched, so "…and 61 more" cannot be computed exactly. `metadata.changedFiles` is the only total, and it is `0` on unhydrated units.
- **`triage`, `reviewRollup`, and `dismissedAtSha` already ride the wire.** `unitsPayload` spreads whole `ReviewUnit`s, so no server-side data plumbing is needed beyond `lane`.
- **Decision-log check**: no contradictions found. The rejected alternatives remain rejected in the live code.
- **Baseline is green**: `bun run typecheck` passes; the web suite has 163 tests in 13 files.
