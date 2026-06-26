# Implementation Spec: Diff Dad Review Loop - Phase 1

**Contract**: ./contract.md
**Estimated Effort**: L

## Technical Approach

Phase 1 turns Diff Dad's review of a *stable* change (today: a GitHub PR via `dad review`; in Phase 2 the same surface renders a submitted unit) from a blocking, narrate-then-show flow into a **diff-first, streaming guided walkthrough** — the B+C experience validated in mockups. Three moves:

1. **Diff-first, non-blocking render.** Render the diff on first paint and never gate the review view on narrative completion. The pattern already exists — `useNarrative`'s `mode === 'watch'` branch renders immediately with `generating=false` while the PR path blocks on `GeneratingScreen`. Phase 1 brings the PR/review path in line with watch.
2. **Reshape narrative → walkthrough.** A pure `buildWalkthrough(narrative, files)` produces the ordered **beats** consumed by a **beat rail** (evolve `ChapterTOC`, scroll-tracked via the existing `useScrollTracker`) and a **streamlined interleaved reading surface** (evolve `Chapter`/`StoryView`), with inline **resolve strips** on flagged beats.
3. **Cut latency at the source.** Streamline the narrative's output size and keep the streaming API path preferred, so the guide that streams over the already-visible diff is tight, not 16k tokens.

The load-bearing new unit is the pure `buildWalkthrough()` function — the single seam that turns a `NarrativeResponse` + `DiffFile[]` into beats (rail entries + flags + interleaved prose/diff sections + resolve items). Keeping it pure makes it the inner-loop test target (no DOM) and the one place the rail and reading surface both read from. The resolve strip's three actions **reuse endpoints that already exist**: "Ask dad" → `POST /api/ai` (`action: 'ask'`), "Send to agent" → `POST /api/agent-comments`, "Looks fine" → local store state. Nothing in Phase 1 needs the daemon; it runs within today's per-run server.

Because the repo has **no DOM test infrastructure** today (jsdom/Testing Library absent; the sole web test is a pure-function test), Phase-1 logic is verified by pure-function/store tests. Adding jsdom + Testing Library for render-level tests is an explicit, optional setup task — not assumed.

## Feedback Strategy

**Inner-loop command**: `cd packages/web && npx vitest run src/lib/__tests__/walkthrough.test.ts`

**Playground**: Vitest for the walkthrough builder + store logic (the bulk of new logic, where iteration happens); the Vite dev server (`bun run dev` + a `dad review owner/repo#N` server on its port, Vite proxies `/api`) for the rail / reading surface / resolve UI.

**Why this approach**: The walkthrough builder is the load-bearing new logic and is pure-function testable in sub-second runs; the UI is a thin consumer of its output, validated visually in the dev server.

## File Changes

### New Files

| File Path | Purpose |
| --------- | ------- |
| `packages/web/src/lib/walkthrough.ts` | `buildWalkthrough(narrative, files)` → `WalkthroughModel` (beats, rail entries, interleaved sections, resolve items, to-resolve count). The pure seam. |
| `packages/web/src/lib/__tests__/walkthrough.test.ts` | Pure-function tests for the builder (0/1/many concerns; missing-hunk graceful drop). |
| `packages/web/src/components/BeatRail.tsx` | Scroll-tracked rail: beats, risk flags, "N to resolve", click-to-jump. |
| `packages/web/src/components/ResolveStrip.tsx` | Inline resolve UI on flagged beats: Looks fine / Ask dad / Send to agent. |
| `packages/web/src/state/__tests__/unit-gate.test.ts` | Asserts the review path exposes diff/files with narrative pending and never trips the blocking-generate gate. |

### Modified Files

| File Path | Changes |
| --------- | ------- |
| `packages/web/src/hooks/useNarrative.ts` | Review path renders diff-first: when files are present but narrative is generating, populate the store and signal the review view to render — do **not** hold `GeneratingScreen` (mirror the `watch` branch, lines 40–61). |
| `packages/web/src/App.tsx` | Render the review view (diff + streaming walkthrough) whenever files are present; restrict `GeneratingScreen` to the brief pre-files window (or drop it on this path — files arrive in the initial `generating` payload). |
| `packages/web/src/components/ChapterTOC.tsx` | Evolve into the `BeatRail`: add risk flags + to-resolve count + scroll-tracked current beat. |
| `packages/web/src/components/Chapter.tsx`, `StoryView.tsx` | Consume the walkthrough model; streamlined prose above each hunk; render streaming beats (empty → filled). |
| `packages/web/src/hooks/useLiveStream.ts` | Ensure `plan-ready`/`chapter-ready`/`narrative.partial` events incrementally update the walkthrough on the PR path (already emitted by the engine). |
| `packages/cli/src/narrative/prompt.ts` (+ `planner.ts`, `writer.ts`) | Streamline output: shorter chapter summaries, tighter caps; lower the guide's effective token budget from `NARRATIVE_MAX_TOKENS=16384`. |

### Deleted Files

None. `GeneratingScreen.tsx` stays for the brief pre-files instant.

## Implementation Details

### 1. Walkthrough model — the pure seam

**Pattern to follow**: `findHunk()` resolution and `normalizePath()` in `Chapter.tsx`; `NarrativeResponse` shape in `narrative/types.ts`.

**Overview**: One pure function turns the narrative + diff into the beats the rail and reading surface render. No React, no fetch.

```typescript
type ResolveItem = {
  id: string; beatId: string; question: string;
  file?: string; line?: number;
  severity: 'risk' | 'warn' | 'info'; status: 'open' | 'resolved';
};
type BeatSection =
  | { kind: 'prose'; text: string }
  | { kind: 'diff'; file: string; hunkIndex: number };
type Beat = {
  id: string; title: string; whyMatters?: string;
  risk: 'risk' | 'warn' | 'info' | 'none';
  sections: BeatSection[]; resolve: ResolveItem[];
  status: 'unread' | 'understood';
};
type WalkthroughModel = { beats: Beat[]; toResolve: number };

function buildWalkthrough(narrative: NarrativeResponse, files: DiffFile[]): WalkthroughModel;
```

**Key decisions**:
- Beats map from `narrative.chapters` (themes); `chapter.risk` + matching `narrative.concerns` become the beat's flag + resolve items.
- Sections interleave chapter prose and the chapter's diff hunks; a hunk that no longer resolves (missing `file`/`hunkIndex`) is dropped, not fatal.
- `toResolve` = count of `open` resolve items — the number surfaced in the rail and (Phase 2) the queue row.

**Implementation steps**:
1. Map themes → beats; attach prose + diff sections via `findHunk` by `file` + `hunkIndex`.
2. Fold `concerns` into the owning beat as `ResolveItem`s (match by file/line; orphans attach to a trailing "Other" beat so they're never invisible — mirror `OrphanedInlineComments`).
3. Compute `toResolve`.

**Feedback loop**:
- **Playground**: `walkthrough.test.ts` with fixture narratives + `DiffFile[]`.
- **Experiment**: a narrative with 0 concerns (`toResolve===0`, no flags), 1 `risk` concern (1 resolve item, beat flagged), and a chapter whose `hunkIndex` is out of range (section dropped, beat still present).
- **Check command**: `cd packages/web && npx vitest run src/lib/__tests__/walkthrough.test.ts`.

### 2. Diff-first, non-blocking render

**Pattern to follow**: `useNarrative.ts` `watch` branch (lines 40–61) — renders immediately, `generating=false`.

**Key decisions**:
- The review view renders as soon as `files` exist; the walkthrough streams in over it. `GeneratingScreen` no longer gates the review path.
- Beats arrive via the SSE events the engine already broadcasts (`plan-ready` → beat shells; `chapter-ready` → filled beats; `narrative.partial` → incremental).

**Implementation steps**:
1. In `useNarrative`, the `generating && !narrative` branch already stores `files`; add a `reviewReady` signal (files present) the view reads.
2. `App.tsx`: when `reviewReady`, render the review view (diff + `BeatRail` + reading surface) instead of `GeneratingScreen`.
3. The reading surface renders streaming beats (empty list → fills as `chapter-ready` arrives).

**Feedback loop**:
- **Playground**: `unit-gate.test.ts` driving the store with a `generating` payload that includes `files`.
- **Experiment**: assert `files.length > 0` and the blocking gate is false while `narrative === null`; then apply a `chapter-ready` and assert the beat appears.
- **Check command**: `cd packages/web && npx vitest run src/state/__tests__/unit-gate.test.ts`.

### 3. Beat rail (evolve ChapterTOC)

**Pattern to follow**: `ChapterTOC.tsx` (current TOC) + `useScrollTracker.ts` (active-section tracking).

**Overview**: A rail listing beats with the current one tracked, risk flags (⚠), a ✓ on understood beats, and a header "N to resolve". Click a beat → scroll-jump.

**Key decisions**: read beats + `toResolve` from the walkthrough model; reuse `useScrollTracker` for the active beat; clicking sets scroll target (existing anchor mechanism in `NarrationAnchor`).

**Implementation steps**: 1) render beats with flag/✓; 2) wire `useScrollTracker` → active highlight; 3) header shows `toResolve`; 4) click → jump.

### 4. Interleaved reading surface (evolve Chapter/StoryView)

**Pattern to follow**: `Chapter.tsx` (interleaved prose + diff today), `StoryView.tsx`.

**Overview**: Streamlined prose above each hunk, diff-first, beats stream in. Prose is shorter than today's chapter summaries.

**Key decisions**: consume `WalkthroughModel.beats`; render `prose` sections compactly and `diff` sections via the existing `Hunk` component; flagged beats render a `ResolveStrip`.

### 5. Resolve strips (reuse existing endpoints)

**Pattern to follow**: `useComments.ts` (`POST /api/agent-comments`) and the `/api/ai` `ask` action in `server.ts`.

**Overview**: On a flagged beat, an inline strip poses the `ResolveItem.question` with three actions.

**Key decisions**:
- **Looks fine** → mark the `ResolveItem` resolved in local store (decrements `toResolve`).
- **Ask dad** → `POST /api/ai { action: 'ask', chapterIndex, question }` (the existing endpoint); render the answer inline. *(This is the Stretch-scope in-walkthrough Q&A — it costs almost nothing because the endpoint exists.)*
- **Send to agent** → `POST /api/agent-comments` with the beat's file/line + the question (the existing agent-comment loop; in watch mode the connected agent already consumes these).

**Implementation steps**: 1) `ResolveStrip` takes a `ResolveItem` + beat context; 2) wire the three actions to store/endpoints; 3) reflect resolved state in the rail count.

### 6. Streamline the guide output

**Pattern to follow**: `narrative/prompt.ts` cap logic; `planner.ts`/`writer.ts` two-pass.

**Key decisions**: shorten chapter `summary` length guidance in the prompt; lower the effective output budget below `NARRATIVE_MAX_TOKENS=16384`; keep streaming so beats appear as they finish. Tune empirically against a few real PRs (Open Item).

**Feedback loop**: **Playground**: `DIFFDAD_DEBUG_PERF=1` (already in `engine.ts`) prints `firstChunk`/`firstPartial`/`total`. **Experiment**: same PR before/after streamlining; **Check**: total generation time drops and `firstPartial` is well under total.

## Data Model

### State Shape (Zustand `review-store`)

```typescript
interface WalkthroughState {
  walkthrough: WalkthroughModel | null;   // derived from narrative+files via buildWalkthrough
  resolved: Record<string, boolean>;       // resolveItem.id → resolved (local)
  reviewReady: boolean;                    // files present; render the review view
}
```

## API Design

No new endpoints. Phase 1 **reuses**:

| Method | Path | Use |
| ------ | ---- | --- |
| `POST` | `/api/ai` (`action: 'ask'`) | "Ask dad" inline Q&A on a beat. |
| `POST` | `/api/agent-comments` | "Send to agent" from a resolve strip. |
| `GET`  | `/api/events` (SSE) | `plan-ready` / `chapter-ready` / `narrative.partial` stream beats in. |

## Testing Requirements

### Unit Tests

| Test File | Coverage |
| --------- | -------- |
| `packages/web/src/lib/__tests__/walkthrough.test.ts` | Builder: beats from chapters, concerns→resolve items, missing-hunk drop, `toResolve` count. |
| `packages/web/src/state/__tests__/unit-gate.test.ts` | Diff-first gate: files present + narrative pending → render, no block; `chapter-ready` adds a beat. |

**Key test cases**: 0/1/many concerns; orphaned concern attaches to trailing beat; out-of-range `hunkIndex` dropped; resolving an item decrements `toResolve`.

### Manual Testing

- [ ] `dad review owner/repo#N` → the diff is visible immediately; no full-screen generating block.
- [ ] Beats stream into the rail; the rail tracks scroll position and shows "N to resolve".
- [ ] A flagged beat shows a resolve strip; **Ask dad** returns an answer inline; **Send to agent** posts a comment; **Looks fine** decrements the count.
- [ ] Watch mode still works (diff + triage), unaffected.

## Error Handling

| Error Scenario | Handling Strategy |
| -------------- | ----------------- |
| Narrative generation fails | Diff stays fully usable (diff-first); show an inline "guide unavailable" beat; review not blocked. |
| `/api/ai` ask fails | Resolve strip shows an inline error; other actions still work. |
| Chapter references a missing hunk | `findHunk` returns null → section dropped; beat still renders. |
| Slow local-cli path | Non-blocking render means the diff is already readable; show a subtle "writing the guide…" indicator, never a full-screen block. |

## Failure Modes

| Component | Failure Mode | Trigger | Impact | Mitigation |
| --------- | ------------ | ------- | ------ | ---------- |
| `buildWalkthrough` | Orphaned concern | A concern's file/line matches no beat | Resolve item invisible | Attach orphans to a trailing "Other" beat (mirror `OrphanedInlineComments`). |
| Diff-first gate | Blank review view | Files absent in initial payload | Nothing renders | Keep `GeneratingScreen` for the pre-files instant only; assert files arrive in the `generating` payload (they do today). |
| Streaming beats | Beat flicker/reorder | Out-of-order `chapter-ready` | Rail jumps | Key beats by stable `themeId`; order by plan index, not arrival. |
| Streamlined output | Guide too terse | Over-aggressive token cut | Loses the "more revealing than a diff" value | Tune empirically; keep the `why`/`watch` tags as the floor of value. |

## Validation Commands

```bash
bun run typecheck
bun run lint
cd packages/cli && npx vitest run
cd packages/web && npx vitest run
bun run build
```

## Open Items

- [ ] Add jsdom + `@testing-library/react` + `vite` `test.environment` for render-level tests, or keep pure-function/store tests only (recommended: pure-function for Phase 1).
- [ ] True lazy per-section prose generation (generate on scroll) — Phase 1 streams per-chapter via existing SSE; on-demand-per-section can follow if perceived latency still bites.
- [ ] Exact streamlined token budget / summary length — tune against a handful of real PRs with `DIFFDAD_DEBUG_PERF=1`.

---

_This spec is ready for implementation. Follow the patterns and validate at each step._
