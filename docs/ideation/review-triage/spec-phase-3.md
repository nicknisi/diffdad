# Implementation Spec: Review Triage - Phase 3

**Contract**: ./contract.md
**Estimated Effort**: M

## Technical Approach

This phase is where the problem is actually experienced, and it is the phase most likely to be judged by taste rather than by tests. Three surfaces land: the collapse boundary in the story view, an unavailable notice when repo context could not be resolved, and a truncation banner when the prompt budget dropped or shortened files before the model ever saw them.

The dominant constraint is that collapse rendering is not new. `Chapter.tsx:271` already owns a `collapsed` state seeded from `reviewed`, with a force-collapse effect at `:273-276` and a grid-rows height animation at `:598-621`. Introducing a second driver of that state would produce a component where two effects fight over the same boolean. The work is to seed the existing state from the selection and to state precedence explicitly, not to build a parallel mechanism.

Collapse is computed at serve time on both servers, never read from storage. The CLI server holds `ctx.narrative` and computes on each `/api/narrative`. The daemon persists narratives inside `ReviewUnit` but must still compute on each `/api/units/:id`, because a snapshot that was unavailable when the unit was minted may be warm by the time it is opened — and the reverse. Storing the decision alongside the unit would reintroduce precisely the staleness defect that kept it out of the narrative cache in Phase 2.

The web package declares its own `NarrativeResponse` at `packages/web/src/state/types.ts:20` rather than importing the CLI's. `sanitizeNarrative` spreads, so unknown fields survive at runtime, but the components cannot read them without the declaration and `bun run typecheck` covers `packages/web/tsconfig.json`. The type has to be extended or nothing compiles.

Stretch tier is in scope, adding two pieces: the evidence line expands to show which unchanged files import the module, reading Phase 1's persisted caller list; and the daemon prefetches snapshots during its poll so context is warm before a review is opened.

## Decisions Considered and Rejected

_Carried from the contract; consult before making gap decisions._

- **Collapse engages only when positive evidence exists for that chapter** — rejected: always rendering the boundary, and gating additionally on PR size. `readingPlan` was pulled from the UI for being always-on meta-output that usually said nothing; when nothing collapses, this phase must render no divider and no chrome at all.
- **Compute collapse state at serve time and never persist it** — rejected: carrying collapse fields through the cache. Applies equally to `ReviewUnit`: compute on serve, do not store.
- **Collapse chapters in place, in the order the model already produced** — rejected: a separate ranking pass. The story view renders `narrative.chapters` in its existing order and inserts one divider.
- **Source repo context from cached tarball snapshots** — rejected: local git with an explicit unavailable state. The unavailable notice therefore describes a size cap or a failed fetch, not a missing clone, and it will be rare rather than permanent in the daemon.
- **Measure compression in narrated diff lines** — rejected: chapter counts. If the collapsed summary states a quantity, it states lines, matching the goal.

## Feedback Strategy

**Inner-loop command**: `bun run --filter '@diffdad/web' test`

**Playground**: `bun run dev` for the Vite dev server, plus the existing vitest suite under `packages/web/src`. For end-to-end checks, `bun run build && bun packages/cli/src/cli.ts review <owner>/<repo>#<n>` against a real large PR — the web frontend must be built before the CLI serves it.

**Why this approach**: The logic pieces (precedence rules, divider placement, banner visibility) are testable in vitest and iterate in seconds; the parts that are genuinely visual iterate against the dev server, and the acceptance judgment for those is Nick's own eye on a real 40-file PR.

## File Changes

### Modified Files

| File Path | Changes |
| --------- | ------- |
| `packages/web/src/state/types.ts` | Extend the narrative API payload type with `collapse: CollapseResult` and `capStats?: PromptCapStats`; mirror the CLI shapes rather than importing across packages, matching how `NarrativeResponse` is already handled here |
| `packages/web/src/components/StoryView.tsx` | Insert the divider before `dividerBefore`'s index in the `chapters.map` at line 269; pass each chapter its `CollapseDecision` when it has one; render the unavailable notice and the truncation banner above the chapter list |
| `packages/web/src/components/Chapter.tsx` | Seed the existing `collapsed` state from the decision; render the reason line on the collapsed row; add the Stretch caller-list disclosure |
| `packages/cli/src/server.ts` | Call `selectCollapsible` in the `/api/narrative` handler and add `collapse` and `capStats` to the response |
| `packages/cli/src/daemon/app.ts` | Same computation in `GET /api/units/:id`, using the unit's persisted narrative and freshly resolved repo context |
| `packages/cli/src/daemon/daemon.ts` | Stretch: prefetch snapshots for polled repos so context is warm before a unit is opened |
| `packages/cli/src/units/store.ts` | Read-only touch: confirm nothing needs to persist collapse; if a helper is needed to resolve a unit's `owner/repo` for context resolution, it lives here |
| `packages/cli/src/units/types.ts` | No collapse fields. Present in this list to make the deliberate absence explicit rather than an oversight |
| `packages/cli/src/__tests__/server.test.ts` | Add tests whose names contain `promptCapStats`, asserting the field reaches the response when present and is absent on a cache hit |

## Implementation Details

### Collapse boundary in the story view

**Pattern to follow**: `packages/web/src/components/StoryView.tsx:269-273`, the existing chapter map and the `OrphanedInlineComments` section that follows it.

**Overview**: One divider, inserted before the first collapsed chapter, with the chapters themselves unreordered.

```tsx
{narrative.chapters.map((ch, idx) => (
  <Fragment key={`ch-${idx}`}>
    {collapse.available && collapse.dividerBefore === idx && (
      <CollapseDivider collapsedCount={...} collapsedLines={...} />
    )}
    <Chapter index={idx} chapter={ch} resolve={resolveByChapter[idx]} decision={decisionFor(idx)} />
  </Fragment>
))}
```

**Key decisions**:

- When `dividerBefore` is `null`, nothing renders. No divider, no summary, no empty state. This is the evidence gate made visible, and it is the specific thing that keeps this from becoming `readingPlan` again.
- The divider states a quantity in lines, not chapters, matching the goal's unit. "4 chapters below, 1,180 lines, mechanical" tells the reviewer what they are trading away.
- Collapsed chapters remain in the DOM and remain expandable. Collapse is a default, never a removal — an inline comment on a collapsed hunk must still be reachable, which is the same principle `OrphanedInlineComments` already encodes.

**Implementation steps**:

1. Extend the web-side payload type and confirm `bun run typecheck` still passes.
2. Add `CollapseDivider` as a small local component in `StoryView.tsx`; it does not warrant its own file.
3. Wrap the map body in a fragment and insert conditionally.
4. Compute the collapsed line count with the `narratedDiffLines` helper Phase 2 exposed.

**Feedback loop**:

- **Playground**: `bun run dev`, with a fixture narrative stubbed into the store so the divider renders without a live PR.
- **Experiment**: Render with `dividerBefore: null` (nothing appears), `dividerBefore: 0` (divider is the first thing in the list), and `dividerBefore: 3` (divider sits between chapters 2 and 3). Then render with `collapse.available === false` and confirm no divider and the notice instead.
- **Check command**: `bun run --filter '@diffdad/web' test`

### Chapter collapse precedence

**Pattern to follow**: `packages/web/src/components/Chapter.tsx:271-276` — the existing `collapsed` state and the `prevReviewed` transition effect.

**Overview**: One boolean, two possible seeds, one stated precedence rule.

```tsx
// Existing: const [collapsed, setCollapsed] = useState(reviewed);
// Becomes:  const [collapsed, setCollapsed] = useState(reviewed || Boolean(decision));
```

**Key decisions**:

- **Both are seeds; neither is a lock.** A reviewer expanding a collapsed chapter keeps it expanded. The existing `prevReviewed` effect already implements exactly this discipline for `reviewed` — it fires only on the `false -> true` transition rather than on every render — and the collapse seed must not undermine it.
- **`reviewed` wins on conflict, and the conflict is invisible.** Both produce `collapsed: true`, so precedence only matters for the reason line: a chapter that is both reviewed and collapsible shows the reviewed treatment, because the reviewer's own action outranks the tool's inference.
- **The reason line lives on the collapsed row**, next to the title, so it is readable without expanding. A reason you have to expand to read cannot justify the collapse.
- **No new animation.** The grid-rows transition at `:598-621` already handles height; the reason line rides inside it.

**Implementation steps**:

1. Add the optional `decision` prop.
2. Widen the `useState` seed.
3. Render the reason on the collapsed row.
4. Add a vitest case asserting that expanding a collapsed chapter and then marking it reviewed does not re-collapse it unexpectedly, and that the `prevReviewed` transition still works.

**Feedback loop**:

- **Playground**: The vitest suite under `packages/web/src`, plus the dev server for the visual.
- **Experiment**: Mount with `{reviewed: false, decision: present}`, `{reviewed: true, decision: undefined}`, `{reviewed: true, decision: present}`, and `{reviewed: false, decision: undefined}`. Assert the initial `collapsed` value and which reason text renders for each.
- **Check command**: `bun run --filter '@diffdad/web' test`

### Unavailable notice and truncation banner

**Overview**: Two small conditional banners above the chapter list, each stating a specific cause.

**Key decisions**:

- **Each names its cause.** "Blast radius unavailable — repository exceeds the size cap" and "Blast radius unavailable — snapshot fetch failed" are different messages, because they imply different actions. A bare "unavailable" is dead chrome.
- **The truncation banner is the more serious of the two** and should read that way. Unavailable context means the review is less helpful; a truncated diff means the review is incomplete, and the reviewer is looking at a story built from a partial input. It states the counts from `capStats`: how many files were dropped entirely and how many were shortened.
- **Absent `capStats` renders nothing.** A cache hit carries no stats, and claiming completeness that was never verified is worse than saying nothing.
- **Both follow the existing space discipline.** These are single-line strips, not cards. The standing UI preference is collapsible, space-respecting chrome and no filler that does not earn its place.

**Implementation steps**:

1. Add `collapse` and `capStats` to the `/api/narrative` response in `server.ts`, computed via `selectCollapsible`.
2. Do the same in the daemon's `GET /api/units/:id`, resolving repo context fresh at request time.
3. Render both banners in `StoryView.tsx` above the chapter list.
4. Add `promptCapStats`-named tests to `server.test.ts`. Note that `-t cap` would match the existing recap tests at `server.test.ts:169` and `:175`; the filter token must be `promptCapStats`.

**Feedback loop**:

- **Playground**: `curl -s localhost:PORT/api/narrative | jq '{collapse, capStats}'` against a running `dad review`.
- **Experiment**: A PR under the line cap (no banner), a PR over it (banner with nonzero counts), and a cache hit (no banner). For the notice, force `{available: false, reason: 'size-cap'}` and confirm the message names the cap.
- **Check command**: `bun test packages/cli/src/__tests__/server.test.ts -t promptCapStats`

### Stretch: caller list disclosure

**Overview**: The evidence line expands to show which unchanged files import the module.

**Key decisions**:

- Reads the caller list Phase 1's index already stores. No new computation, no new request.
- Cap the rendered list and state the overflow. A module with 200 callers should show a bounded set and say how many more there are, rather than producing a wall inside a chapter.
- Only meaningful on non-collapsed chapters, where the count is an argument for reading. On a collapsed chapter the count is zero and there is nothing to list.

**Implementation steps**:

1. Include the caller paths on the risk payload the server already sends.
2. Add a disclosure to the evidence line in `Chapter.tsx`.
3. Cap and state overflow.

**Feedback loop**:

- **Playground**: `bun run dev` with a stubbed risk payload, since the visual failure mode here is length rather than logic.
- **Experiment**: Render with 0 callers (no disclosure at all), 3 (list fits inline), and 200 (capped list plus an overflow count). The 200 case is the one that decides the cap.
- **Check command**: `bun run --filter '@diffdad/web' test`

### Stretch: daemon snapshot prefetch

**Overview**: Warm the snapshot during the poll so the first open is not the first fetch.

**Key decisions**:

- Best-effort and non-blocking. A prefetch failure must never delay or fail unit minting; the serve-time resolution already handles a cold cache.
- Deduplicate by repo, not by PR. Ten PRs on one repo share one snapshot.
- Respect the staleness bound rather than fetching every cycle.

**Implementation steps**:

1. After the poll resolves units, collect the distinct `owner/repo` set.
2. Call `resolveRepoContext` for each, ignoring failures.
3. Log a single summary line rather than one per repo.

## Testing Requirements

### Unit Tests

| Test File | Coverage |
| --------- | -------- |
| `packages/web/src/components/__tests__/collapse-render.test.tsx` | Divider placement for `null`, `0`, and a mid-list index; nothing rendered when unavailable |
| `packages/web/src/components/__tests__/chapter-precedence.test.tsx` | The four seed combinations and which reason text renders |
| `packages/cli/src/__tests__/server.test.ts` | `promptCapStats` present when generated, absent on a cache hit; `collapse` present on both |

**Key test cases**:

- `dividerBefore: null` renders no divider and no summary text.
- `collapse.available === false` renders the notice with the specific reason and no divider.
- A chapter with a decision starts collapsed; expanding it and re-rendering does not re-collapse it.
- A chapter that is both reviewed and collapsible shows the reviewed treatment.
- `capStats` absent renders no truncation banner.

### Manual Testing

- [ ] `bun run build && bun packages/cli/src/cli.ts review <owner>/<repo>#<n>` on a 40+ file PR; confirm the divider lands somewhere defensible and the reason lines read as facts rather than opinions
- [ ] Same PR after forcing `{available: false}`; confirm the notice names its cause and nothing collapses
- [ ] A PR exceeding 12,000 diff lines; confirm the truncation banner appears with real counts
- [ ] The daemon drill-in on the same PR; confirm parity with the CLI review
- [ ] Toggle a collapsed chapter open and mark it reviewed; confirm no state fight

## Failure Modes

| Component | Failure Mode | Trigger | Impact | Mitigation |
| --------- | ------------ | ------- | ------ | ---------- |
| Chapter precedence | State fight | Both the reviewed effect and a collapse seed drive `collapsed` | Chapter re-collapses under the reviewer, or refuses to collapse | Seed once in `useState`; do not add a second `useEffect` that writes `collapsed` |
| Divider | Divider with nothing below | `dividerBefore` set but decisions empty | Dead chrome, the `readingPlan` failure repeating | Derive the divider strictly from `dividerBefore !== null`, which Phase 2 sets only when a decision exists |
| Daemon serve | Stale collapse | Collapse computed once at mint time | A unit minted with a cold snapshot never collapses, even after the snapshot warms | Compute in the request handler, never in the store |
| Truncation banner | False completeness | `capStats` defaulted rather than left absent on a cache hit | The reviewer believes a partial story is complete | Optional field, absent on cache hits, nothing rendered when absent |
| Web types | Silent field loss | Fields added on the CLI but not mirrored in `packages/web/src/state/types.ts` | Components cannot read them and typecheck fails | Typecheck covers `packages/web/tsconfig.json`, so this fails loudly rather than silently |
| Caller list (stretch) | Wall of paths | A module with hundreds of importers | Chapter becomes unreadable | Cap the list, state the overflow count |
| Prefetch (stretch) | Poll slowdown | Sequential fetches across many repos | Daemon poll cycle stretches, units appear late | Best-effort, non-blocking, deduplicated by repo, bounded by the staleness window |

## Validation Commands

```bash
bun run --filter '@diffdad/web' test
bun test packages/cli/src/__tests__/server.test.ts
bun run test
bun run typecheck
bun run lint
bun run build
```

## Open Items

- [ ] Exact divider copy. It has to read as a fact ("4 chapters · 1,180 lines · mechanical") rather than as advice ("you can skip these"), and copy is the part Nick judges by eye.

---

_This spec is ready for implementation. Follow the patterns and validate at each step._
