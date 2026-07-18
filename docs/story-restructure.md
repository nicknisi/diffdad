# Diff Dad Story Restructure — Design Document (rev 2)

**Question answered:** what is the best way to lay out the data / structure the story so it stops being convoluted?
**Answer in one line:** the story is an interactive slideshow when it should be a martini glass — a one-screen Overview built from the planner's output, then fixed-template chapters whose only prose is one brief and per-hunk notes, with a single `Finding` channel whose identity survives regeneration — shipped in two stages so the layout hypothesis is tested before the schema is rewritten.

---

## 1. Diagnosis

The prose-shortening pass treated the wrong variable. The convolution is **surface count and channel duplication per scroll position**, not word count:

**a. The spine is broken at vertebra two.** The intended flow is verdict → plan → chapters → done, but `readingPlan` is generated, cached, and never rendered (only `review-store.ts` normalization and `eval/judge.ts` touch it; no component reads it). The prompt's own principle — "read the concerns and reading plan in 30 seconds" (`prompt.ts:182`) — describes a surface that doesn't exist. The reviewer lands directly in chapter 1's prose with no map. Reviewers who scan the whole change before deep reading find defects faster (Uwano 2006, Sharif 2012); an upfront schema converts bottom-up decoding into cheap hypothesis-verification.

**b. Four prose surfaces answer "what is this chapter about" before any code.** Title, `summary` (≤20 words), `whyMatters` (≤30 words, in a labeled gray box), and the narrative block — four consecutive registers of the same LLM voice, deduplicated only by prompt exhortation (`prompt.ts:400`), not by structure. The field the prompt calls "the most important" (`whyMatters`) renders as a tinted labeled box — the shape banner-blindness research says users skip.

**c. Two parallel LLM annotation channels render almost identically.** Top-level `concerns` → ResolveStrip and per-chapter `callouts` → InlineCallout are both tinted strips in the same annotation row (`Hunk.tsx:481-495`). The visual difference (buttons vs. none) doesn't communicate the semantic one (must-resolve vs. FYI). The concern's `category` and `why` — which the LLM is required to write — are dropped on the floor (`walkthrough.ts:63-80`); `ConcernsList.tsx` is dead code with zero imports.

**d. Roughly three and a half severity vocabularies for one question.** "How risky is this?" is expressed as verdict (safe/caution/risky), chapter risk (low/medium/high), the BeatRisk/ResolveSeverity pair (one 3-value scale plus `none`, per `walkthrough.ts:5-6`), and callout level (nit/concern/warning); concern `category` (8 kinds) rides along unrendered. `walkthrough.ts:103` self-describes as the reconciliation layer — its existence is the diagnosis. The reconciliation is also lossy: concern severity is synthesized from the _owning chapter's_ risk, so a security question in a low-risk chapter renders as a gray info strip (`walkthrough.ts:47-49`), and concern→chapter routing is by file only (`walkthrough.ts:143`), which misroutes in exactly the cross-file themes the planner deliberately builds.

**e. Control density swamps the content.** ~21 interactive controls before the first diff line; ~16 per typical chapter; chapter boundaries stack 8 consecutive controls. Three progress systems (BeatRail flags, chapter reviewed state, SubmitBar) track "am I done" independently.

**f. Dead and broken structure carried as live surface area.** `reshow` cannot be _authored_ in the two-pass pipeline (`CHAPTER_RESPONSE_SCHEMA` omits it) — though the duplicate-primary render path (`Chapter.tsx:416-436`) is live _defensive_ rendering, since `validatePlan` violations are tolerated after one retry (`engine.ts:261`) and two chapters can claim one hunk. `OrphanedInlineComments` renders only in `linear` layout (`StoryView.tsx:275`) while the default is `toc` (`review-store.ts:365`) — comments on un-narrated hunks are invisible by default. The tldr collapses to "AI narration (click to expand)" when `collapseNarration` is on.

**g. Review state is disposable.** `resolved` is in-memory only and wiped by `applyPlan` (`review-store.ts:675`) and `setData` (`:410`); chapter reviewed-state persists positionally (`ch-${idx}`), so any regeneration that reorders chapters silently transfers "reviewed" to the wrong chapter. Today this is tolerable because concerns are a side strip; any design that promotes findings to the primary surface must fix identity first.

Supporting evidence (indicative, not dispositive): surviving review tools converged on two layers — a compact orientation artifact plus line-anchored findings — and practitioners consistently report annotation volume as the top trust killer. Diff Dad currently ships roughly five layers. The code-level findings above justify the redesign on their own.

---

## 2. Principles

1. **Martini glass: a 30-second author-driven stem, then hand over control.** Linear narrative helps for orientation and prioritization only; expert code reading is non-linear (Busjahn ICPC 2015; Segel & Heer 2010). The forced story must fit one screen; chapters are drill-down targets, not slides.
2. **Inverted pyramid.** Attention is front-loaded — sharply lower defect-detection odds for last-positioned files (Fregnan ESEC/FSE 2022). Verdict and riskiest chapter first; mechanical fallout last, collapsed.
3. **The chapter list IS the reading plan.** If chapter titles + one-line briefs, ordered by risk, narrate the PR on their own, a separate readingPlan artifact is pure redundancy.
4. **Identical chapter template, enforced in the schema.** Small multiples (Tufte): learn chapter 1's layout, scan the rest. Variable interleaved narrative/diff sections force re-learning the layout every chapter.
5. **Narration is routing, not teaching.** "Why" is the top information need (Tao FSE 2012), but prose that restates what a hunk visibly does is overhead. Keep only intent, consequence, cross-file threads, and expectation-deviations — as ordering, briefs, and per-hunk notes.
6. **One findings channel, one authored severity vocabulary, question-phrased.** Structured "verify X" lenses beat passive reading (Basili PBR). Two visually identical channels with different semantics is the anti-pattern.
7. **Two disclosure levels max; descriptive collapse labels; never collapse triage-critical content — and severity can force disclosure open.**
8. **Scaffolding scales with complexity.** A 3-hunk PR gets a tldr, a verdict, findings, and a diff — no chapters (the engine's `SMALL_PR_HUNK_THRESHOLD = 3` short-circuit already points here).
9. **Emphasis budget: color means finding severity, nothing else.**
10. **One progress system.** Reviewable-style mark-as-reviewed + "what's next" is the differentiation; make it singular and durable, not triplicate and disposable.
11. **State the reviewer creates outlives the artifact the LLM creates.** Resolved findings and reviewed chapters must survive reloads, regenerations, and pushes to unchanged code.

---

## 3. Candidates considered (compressed)

- **A — "Triage desk"** (findings-first dashboard; chapters are accordions you open when a finding sends you there). Strongest triage, weakest comprehension: walkthrough readers must expand every chapter serially, clean PRs get a near-empty first screen, and it abandons the "story" identity.
- **B — "Guided linear tour"** (current shape, fixed-template chapters, no overview). Smallest migration, but no overview means it still fails the 30-second scan; fixes the chapter, not the spine.
- **C — "Annotated diff"** (no story view; theme-grouped diff with sticky captions and findings). Closest to competitive convergence, but abandons the product's bet and is the biggest rebuild.

**Chosen: A's stem on B's body**, with C's discipline adopted as a rule (the diff stays visually dominant; prose must pass the tacit-knowledge test) rather than as the layout. This is also the shape the two-pass pipeline already streams in: the engine emits the complete plan before any writer call (`engine.ts:285` fires `onPlan`, then per-theme `onChapter`). The plan becomes the first screen; chapter bodies stream in below. The layout matches the generation order.

---

## 4. The design

### 4.1 Render order (steady state, top to bottom)

1. **Overview** (one viewport, static — see 4.9 for the rail):
   - Verdict + tldr, one line each, plain text — never wrapped in a narration block, never collapsible.
   - **Findings digest**: open findings grouped by severity (blocker / caution / note) — `question` + `file:line` + severity dot; `why` as a secondary line (the only place it renders). Unanchored findings listed last under a labeled group. Rows carry a resolve toggle and deep-link to the anchor line; comment/ask actions live only on the inline strip at the hunk (see Appendix, R2).
   - **Chapter table** = the reading plan: number, title, first sentence of brief, open-finding dot + count, size (`N hunks`), reviewed check. Row click scrolls to the chapter. Suppressed chapters render as quiet rows.
2. **Chapters**, in plan order (risk descending, mechanical last), fixed template:
   - Header: title · open-finding dot + count · Mark reviewed · one "⋯" menu (Ask AI, re-narrate/density, lens, chapter comment — the tools survive; their ambient ~24-control footprint doesn't).
   - Brief (planner-authored, ≤2 sentences: sentence 1 = the delta, sentence 2 = what to verify).
   - Hunks in writer order (definitions before uses), each with an optional one-line `note` caption above it; findings and GitHub comments inline at their lines. Nothing after the last hunk.
   - Default expansion: expanded, except `suppress: true` chapters, which collapse to their header row (label = title + hunk count — descriptive, unlike "More context"). **Escalation rule:** a chapter containing any open blocker or caution finding always renders expanded, suppress notwithstanding.
3. **"Not in the story" section** (collapsed, labeled with hunk count): every hunk no chapter covers, rendered as plain hunks with their inline comments. This generalizes and subsumes `OrphanedInlineComments`, and renders in every mode — the current toc-mode omission is a bug, fixed in Stage 1.
4. **PR Discussion** (unchanged).

Gone from the flow: VerdictBanner-as-section (folded into Overview), OtherConcerns, MissingItems (unanchored findings live in the digest), the per-chapter NarrationAnchor row, the whyMatters box, "More context", trailing callout lists.

### 4.2 Defaults

| Surface                                         | Default                                                                       |
| ----------------------------------------------- | ----------------------------------------------------------------------------- |
| Overview (verdict, tldr, digest, chapter table) | Always expanded, never collapsible                                            |
| Chapters                                        | Expanded                                                                      |
| `suppress` chapters                             | Collapsed to header row — unless they contain an open blocker/caution finding |
| Per-hunk context lines beyond focus             | Folded (as today)                                                             |
| Bot comment clusters                            | Collapsed (as today)                                                          |
| AI tools (density, lens, Ask)                   | Behind "⋯", closed                                                            |
| Small-PR path (≤1 file, ≤3 hunks)               | Chapterless layout (see 4.7)                                                  |

### 4.3 Data model

```ts
type NarrativeResponse = {
  title: string;
  tldr: string; // one sentence, plain text
  verdict: 'safe' | 'caution' | 'risky'; // planner judgment at PR level — authored, not derived (see 4.9)
  findings: Finding[]; // THE single annotation channel; planner-authored only
  chapters: Chapter[];
};

type Finding = {
  id: string; // minted by code, never the LLM: hash(file + normalized question stem) — see 4.4
  question: string; // Socratic, answerable from the diff
  severity: 'blocker' | 'caution' | 'note';
  category: ConcernCategory; // steers generation and eval grading; NOT rendered
  anchor?: { file: string; line: number }; // absent = unanchored (absorbs `missing`)
  why: string; // one sentence; digest secondary line
};

type Chapter = {
  id: string; // themeId, per-run
  key: string; // minted by code: hash of member-hunk content hashes — stable identity, see 4.4
  title: string; // load-bearing keywords first: "Cache: key narratives by head SHA"
  brief: string; // planner-authored, ≤2 sentences/≤30 words; the writer NEVER edits it
  suppress?: true; // mechanical theme: no writer call (today's buildSuppressedChapter), collapsed by default
  hunks: ChapterHunk[];
};

type ChapterHunk = {
  file: string;
  hunkIndex: number;
  focus?: { start: number; end: number };
  note?: string; // ≤20 words, writer-authored, tacit info only (cross-file thread, intent,
  // expectation-deviation) — restates-the-hunk notes must be omitted
};
```

**The ruthless list (corrected):**

| Today                                                          | Fate                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readingPlan`                                                  | Dead. The chapter table is the plan. Delete from schema, types, store normalization, **and rewrite `eval/judge.ts`**, which currently grades against it.                                                                                                                                                                                                          |
| `summary` + `whyMatters`                                       | Merge → `brief`.                                                                                                                                                                                                                                                                                                                                                  |
| `sections: (narrative\|diff)[]`                                | Dead. Prose between hunks becomes unrepresentable; per-hunk `note` is the only slot.                                                                                                                                                                                                                                                                              |
| `concerns` + `callouts` + `missing`                            | Merge → `findings`. Severity is the finding's own, never inherited from chapter risk.                                                                                                                                                                                                                                                                             |
| `chapter.risk`                                                 | Dead as a rendered pill. Collapse is driven by `suppress`; the chapter dot is derived (max open-finding severity); quiet styling is derived (zero open findings). No new LLM-authored `attention` field — it was derivable, and `skim`-with-writer-calls would have paid for notes nobody expands. `suppress` keeps its exact current semantics (no writer call). |
| `reshow` authoring                                             | Dead (already unproducible in two-pass). The **duplicate-primary render path is live defensive rendering** and is replaced by a deterministic rule, not deleted — see 4.7.                                                                                                                                                                                        |
| `BeatRisk`/`ResolveSeverity` reconciliation (`walkthrough.ts`) | Dead. Rail flag = max open-finding severity per chapter. No synthesis.                                                                                                                                                                                                                                                                                            |
| `ConcernsList.tsx`                                             | Delete (zero imports).                                                                                                                                                                                                                                                                                                                                            |
| Writer-added findings                                          | **Cut.** One authoring channel: the planner. The writer contributes presentation only (order, focus, notes). Tradeoff and revisit trigger in §7.                                                                                                                                                                                                                  |

### 4.4 Identity and state persistence (prerequisite for everything above)

Findings become the primary progress mechanic; therefore their identity must survive regeneration, reload, and push. Today it survives none of these (§1g).

- **Finding identity:** `Finding.id = sha256(file + '|' + normalize(question))[:12]`, where `normalize` lowercases, strips punctuation/stop-words, and truncates to the first ~12 tokens. Minted deterministically **in code at the store boundary** (`sanitizeNarrative`, `review-store.ts:291`) — never by the LLM (LLM-minted ids are unstable across runs by construction). The anchor line is deliberately excluded from identity: lines shift on every rebase; the anchor is mutable metadata refreshed by each plan, not part of who the finding is.
- **Resolved persistence:** `diffdad.resolved.${pr.number}` in localStorage as `Record<findingId, true>`. Because ids are content-addressed, resolution carries across regenerations automatically when the planner re-raises the same question about the same file.
- **Reconciliation on regeneration:** `applyPlan` and `setData` stop wiping `resolved`; instead they intersect the persisted map with the incoming finding ids. Old resolved ids with no match are retained in storage (harmless) but not rendered. v1 is exact-id match; fuzzy rematch (same file + question-token overlap) is a follow-up only if evals show the planner rephrases questions across runs at a rate that matters.
- **Chapter identity:** `Chapter.key = sha256(sorted member-hunk content hashes)`, computed client-side from the parsed diff (available locally). Reviewed-state is keyed by `key` under `diffdad.reviewed.${pr.number}` — never by index. Consequences, both correct: same-SHA regeneration that reorders chapters preserves reviewed-state; a push that changes a chapter's hunks changes its key and resets reviewed-state for exactly the chapters whose code changed.

Without this section the design is not implementable as the primary review surface; it therefore ships in **Stage 1** (it is schema-independent — today's concerns/chapters can be keyed the same way).

### 4.5 Prompt contract

- **Planner** (`PLAN_RESPONSE_SCHEMA`): gains per-theme `brief`; keeps `suppress` unchanged; emits `findings` (renamed from concerns; gains `severity`, optional anchor; absorbs `missing` as unanchored findings); loses `readingPlan`. Ordering instruction unchanged (risk descending, mechanical last). The planner authors the entire first screen — correct, because only the planner sees the whole PR.
- **Writer** (`CHAPTER_RESPONSE_SCHEMA`): shrinks to hunk presentation order (new explicit instruction: lead with the type/schema/definition hunk), `focus` ranges, and per-hunk `note`s. No findings. No `brief` edits — the Overview row and the chapter header render the same planner string, so they cannot drift.
- **Single-pass schema** mirrors the merged model; the small-PR path additionally allows `chapters: []`.
- **Validator** (`validator.ts`) invariants: every finding anchor resolves to a hunk covered by some chapter, or the finding is explicitly unanchored; every chapter hunk resolves; `verdict: 'safe'` with an open blocker is a violation; duplicate hunk coverage is a violation (tolerated per §4.7 when the retry fails).
- Bump `PLANNER_PROMPT_REVISION` and `NARRATIVE_PROMPT_REVISION`; cache filenames already embed both plus `SCHEMA_VERSION` (`cache.ts:47`), so old cache entries become unreachable — **no adapter is needed in the cache load path** (see §6 for where the adapter actually goes).

### 4.6 Streaming and latency

The two-pass engine already delivers chapters atomically (`applyChapter`); the reflow-prone partial-JSON re-render exists only on the single-pass small-PR path, where it is trivial. What the current pipeline does _not_ do is paint anything before the planner completes — and the planner reads the entire capped diff (up to 12,000 lines) and emits the whole plan in one shot, plausibly tens of seconds through `claude -p` on a large PR. A martini glass with a blank stem at exactly the moment the PR is big is not acceptable. Three changes:

1. **Diff-first render.** The diff is local data. On load, render the file list and hunks immediately under a pinned "Planning the story…" banner with an Overview skeleton on top. The reviewer is never blocked on the LLM to read code.
2. **Progressive plan paint.** Point the existing `tryParsePartialJson` machinery (`engine.ts:357`) at the planner stream and forward deltas over SSE as `plan-delta` events. The Overview paints append-only: verdict → tldr → theme titles → findings as they complete. Settled content never moves; chapter-table rows appear with a "writing…" shimmer.
3. **Budget.** First plan tokens paint within ~5 s of request; full plan target ≤30 s on large PRs. These are budgets to hold the design to, not measurements — instrument `onPlan` latency in Stage 2 and revisit if the budget is blown (mitigations in order: schema-field ordering so verdict/tldr/themes stream first, then a smaller planner model for the first paint).

Each `onChapter` swaps a shimmer row's body in atomically, as today.

### 4.7 Failure paths and degradation

The engine tolerates plan violations after one retry (`engine.ts:261`), so coverage guarantees are aspirational and the design must degrade deliberately:

- **Unresolvable chapter hunks:** keep a per-chapter banner ("Couldn't locate N hunks: `file`, `file`") — the `MissingHunkBanner` role survives the rewrite. A chapter whose hunks all fail `findHunk` renders header + brief + banner, and its Overview row is flagged.
- **Uncovered hunks:** the "Not in the story" section (§4.1 item 3) guarantees every hunk and every comment is reachable in Story view.
- **Findings with unresolvable anchors:** rendered in the Overview digest under a flagged "couldn't anchor" group — never dropped. (This also covers findings pointing at uncovered hunks.)
- **Duplicate hunk coverage:** deterministic rule replacing ReshowBlock — the first chapter in plan order renders the hunk in full; subsequent claimants render a compact reference row ("shown in Chapter 2 — jump").
- **Blocker in a collapsed chapter:** cannot happen — the escalation rule (§4.1) force-expands any chapter with an open blocker/caution finding, and the digest lists every finding regardless of its chapter's state.
- **Small PR** (`≤1 file && ≤3 hunks`, matching `engine.ts:208`): chapterless layout — Overview shows verdict + tldr + findings digest and **no chapter table**; hunks render inline beneath with notes; one "Mark reviewed" for the whole PR; the rail is hidden; SubmitBar reads the single unit. `chapters: []` is legal in the schema.
- **Clean PR (no findings):** the digest renders a single quiet line ("No findings — N chapters below") and the chapter table becomes the dominant Overview element — the route into the code is the plan itself, so the stem is never empty.
- **Old-shape narratives:** see §6 (adapter at the store boundary, not the cache).

### 4.8 AI tools: a defined render target

`chapter-ai.ts` re-narrate returns a free paragraph stored in `narrationOverrides[chapterKey]`, rendered today by `NarrationBlock` — which the fixed template deletes. The tools get an explicit target instead of a silent break:

- Density (terse/verbose) and lens re-narration render into a **bounded "AI note" block that temporarily replaces the brief**: cap-exempt, visually distinct (quiet border, not a tinted box), with a "Restore brief" chip. Ephemeral — never persisted, cleared on regeneration. `narrationOverrides` is retargeted, not removed.
- Per-hunk notes are not overridable.
- The global `defaultNarrationDensity` setting dies (§5): density becomes an on-demand per-chapter action, since there is no ambient narration to pre-densify.

The small-multiples guarantee holds for the default render; a reviewer who explicitly asks for a paragraph gets one, clearly marked as an excursion.

### 4.9 One progress system, honest vocabulary accounting

- **The rail is a separate, boring sticky component** that reads the same store slice as the Overview's chapter table and SubmitBar: chapter rows, finding counts, reviewed state. No scroll-linked morph from Overview to rail — a card that collapses on scroll shifts the page under the reviewer and violates this design's own no-reflow rule; the third progress-system copy is deleted by sharing the store slice, which requires no animation.
- **Vocabulary count, stated honestly:** the redesign ships **two authored vocabularies** — finding severity (blocker/caution/note; the only thing color encodes) and PR-level verdict (safe/caution/risky) — plus one derived dot that reuses finding severity. Down from ~3.5 + a dead category. Verdict stays **planner-authored, not derived** from max finding severity: aggregate riskiness is a judgment (many cautions in auth code ≠ one caution in a README), and deriving it would change its meaning. The validator flags the one incoherent combination (`safe` + open blocker).

---

## 5. Settings and config migration

The fixed template and mandatory Overview retire several server-config-backed prefs surfaced in SettingsView and applied via `applyConfigResponse` (`review-store.ts:589-608`) — a headline of PR #45, including the live daemon re-wire. Explicitly:

| Setting                                          | Fate                                                     | Migration behavior                                                                        |
| ------------------------------------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `storyStructure` (`chapters`/`linear`/`outline`) | Dies — one template                                      | Config API ignores the key on read, strips it on next write; SettingsView control removed |
| `layoutMode` (`toc`/`linear`)                    | Dies — Overview + rail always present                    | Same                                                                                      |
| `collapseNarration`                              | Dies — brief is always visible, never collapsible        | Same                                                                                      |
| `defaultNarrationDensity`                        | Dies — density is an on-demand per-chapter action (§4.8) | Same                                                                                      |
| Theme, provider config, ports, daemon settings   | Survive unchanged                                        | —                                                                                         |

Required test: a config file carrying `storyStructure: 'outline'` (or any retired key) loads cleanly, round-trips through the settings page, and the daemon live re-wire path still applies the surviving keys. Retired keys must degrade to no-ops, never crashes.

---

## 6. Daemon, units, and eval surfaces

The one place old-shape narratives actually survive a prompt-revision bump is **not** the cache (filenames embed revisions — old entries just become unreachable) but the **daemon's persisted units**: `attachReview` stores whole narratives one-file-per-unit under the data dir (`units/store.ts:244`, `units/types.ts:29`), unversioned by prompt revision, and the command center hydrates them into the UI.

- **Adapter placement:** `upgradeNarrative(old): NarrativeResponse` lives at the store boundary — applied inside `sanitizeNarrative` (`review-store.ts:291`), the single choke point every narrative passes through (`/api/narrative` load, unit hydration, skeleton, chapter application). Mapping: `summary + whyMatters → brief`; `concerns → findings(severity: 'caution')`; callouts `nit → note`, `concern`/`warning` → `caution`; `missing →` unanchored `caution` findings; `sections →` hunks, with inter-hunk narrative dropped into the first following hunk's `note` (truncated).
- **Daemon counts:** `toResolve` currently counts all concerns (`daemon/daemon.ts:256,269`). Post-merge it counts `severity !== 'note'` only, so FYIs stop inflating "N to resolve" in `UnitRow`.
- **Curated decision concerns** (`units/types.ts:21`, `concerns?: Concern[]` on changes-requested decisions): migrate the type to `Finding[]` in Stage 2; the adapter covers persisted old-shape decisions.
- **`eval/judge.ts`** grades coverage against `readingPlan`, `whyMatters`, `callouts`, and section narration — all deleted fields. Rewrite the judge to grade against `tldr`, `findings` (question/why/severity/anchor), `brief`s, and `note`s. This is on the Stage 2 critical path, not a follow-up: it is the instrument that tells us whether planner-only findings miss line-level issues (§7).

---

## 7. Tradeoffs

- **Planner as single point of quality.** All findings and all briefs come from one pass over one (capped) context. Risk: shallower line-level findings than a per-theme writer could produce. Accepted because one authoring channel is the design's core simplification and the findings are "what to verify" questions, not a bug-hunt. Revisit trigger: the rewritten eval judge shows expected-concern coverage dropping versus the two-channel baseline — the mitigation is a scoped writer _proposal_ pass with a dedup gate, not a return to free-form callouts.
- **Interleaved prose becomes unrepresentable.** Some genuinely narrative explanations no longer fit. Accepted deliberately; the escape hatch is on-demand re-narration (§4.8), which puts the paragraph behind an explicit request instead of in everyone's default path.
- **Authored verdict can disagree with findings.** Accepted (validator flags the incoherent case); the alternative — deriving verdict — silently changes its meaning.
- **Stage 1 temporarily adds a surface** (Overview on top of today's unchanged chapters) before Stage 2 removes three. Accepted for falsifiability: the owner has already watched one pass treat the wrong variable; the layout hypothesis must be testable independently of the prose-contract rewrite.
- **Fixed template limits future feature slots.** Accepted; new per-chapter features go in the "⋯" menu or the finding channel, by rule.

---

## 8. Migration plan

### Stage 1 — the Overview, on today's schema (days; zero prompt changes; zero cache invalidation; each item independently reversible)

1. **Identity + persistence** (§4.4): mint content-addressed finding ids from today's `concerns` in `sanitizeNarrative`; persist `resolved` (`diffdad.resolved.${pr}`); rekey reviewed-state by hunk-content-hash chapter keys; make `applyPlan`/`setData` reconcile instead of wipe (`review-store.ts:410,675`).
2. **`Overview.tsx`**, built entirely from current data: verdict + tldr; findings digest from `concerns` (question, why, anchor — the fields `walkthrough.ts` currently drops) with resolve toggles + deep links; `missing` as the unanchored group; chapter table from chapters (title, `summary` as the one-liner, derived severity dot, hunk count, reviewed check). VerdictBanner folds in.
3. **One progress slice:** rail (static sticky component) + SubmitBar + Overview table read one store selector; delete the third copy. No morph.
4. **Bug fixes + dead code:** render the orphaned-comments section in all layout modes (`StoryView.tsx:275`); delete `ConcernsList.tsx`.
5. **Render-time de-layering of the chapter:** remove the whyMatters box (append its text after `summary` as plain prose); stop wrapping the tldr in NarrationBlock; small-PR chapterless render (§4.7) when `chapters.length <= 1`.
6. **Show it to the owner.** Stage 1 tests the structural hypothesis (overview + single findings surface + durable progress) in isolation. Its feedback scopes Stage 2 — see Appendix R1 for why Stage 2 is sequenced after, not gated on failure.

### Stage 2 — schema surgery (the generation-side half)

1. **Schema + types + prompts** (`prompt.ts`, `plan-types.ts`, `packages/web/src/state/types.ts`): `Finding`, `ChapterHunk`, `brief`; delete `readingPlan`, `reshow` authoring, `Section`, `summary`/`whyMatters`, `callouts`, `missing`, `chapter.risk`. Keep `suppress` as-is. Bump both prompt revisions. Update `validator.ts` invariants (§4.5).
2. **Adapter at the store boundary** (§6): `upgradeNarrative` in `sanitizeNarrative`; daemon `toResolve` counts blocker/caution; migrate `units/types.ts` decision concerns; rewrite `eval/judge.ts`.
3. **Rewrite `walkthrough.ts` as `buildOverview()`:** finding→chapter routing by hunk ownership (`(file, line)` → covering hunk → owning chapter; first-owner rule for duplicates; flagged orphan group for the rest), per-chapter open counts, derived dots. Delete `BeatRisk`/`ResolveSeverity`; `severity.ts` maps finding severity → color tokens, full stop.
4. **Rewrite `Chapter.tsx` to the fixed template** (~250 lines from 638): header + "⋯" menu, brief (with AI-note override slot, §4.8), hunks with notes; keep the unresolvable-hunks banner; replace ReshowBlock with the reference-row rule; merge `InlineCallout` + `ResolveStrip` into one `FindingStrip`; escalation rule for suppressed chapters.
5. **Streaming:** `plan-delta` SSE events + partial plan paint + diff-first render under the planning banner (§4.6); instrument `onPlan` latency.
6. **Settings retirement** (§5): config schema, `applyConfigResponse`, SettingsView, retired-key round-trip test, daemon re-wire verification.
7. **Tests:** `unit-gate.test.ts`, `prompt.test.ts`, `narrative-cache.test.ts`, units store tests, judge evals; run the small-PR short-circuit end-to-end for the chapterless path.

---

## Appendix — Rejected objections

Critique points overruled or modified, with reasons. Everything else in the adversarial critique was accepted and is reflected above.

- **R1 — "Stage 2 only if Stage 1 leaves a measured prose-quality problem."** Partially rejected. Stage 2 is _sequenced after_ Stage 1's owner review, but not contingent on Stage 1 failing: the four-prose-surface chapter, the sections union, and the two-channel authoring split are independently diagnosed schema defects that Stage 1 cannot fix at render time (render-time merging of whyMatters treats a symptom). Stage 1's feedback scopes and re-prioritizes Stage 2; it does not decide whether the schema gets fixed.
- **R2 — "Overview digest rows navigate only; the inline strip acts."** Partially rejected — then **overturned by the owner during Stage 1 review**: a question listed away from its hunk "tells me nothing," and a toggle in the pane invites resolving without reading the code. Final ruling goes further than the critique asked: anchored findings do not list in the Overview at all. They render only inline at their anchors; the Overview carries their aggregate signal (an open count line + per-chapter severity dots in the chapter table). Unanchored `missing` items remain listed in the pane — they are self-contained observations about absence with no inline home. Stage 2's digest section is superseded accordingly.
- **R3 — "The CodeTour finding argues against the narration premise wholesale."** Rejected as a design driver. The finding is that tours _route attention_ well while prose _teaches_ less than expected — which is precisely the redesign's rule (narration = ordering, briefs, notes; no teaching paragraphs). It argues for this restructure, not for abandoning the product.
- **R4 — Content-addressed identity as "hash of normalized anchor + question stem."** Modified, not adopted verbatim. Including the anchor line in the hash breaks identity on every rebase that shifts lines — the exact regeneration scenario identity must survive. Identity is `file + normalized question stem`; the anchor is mutable metadata refreshed by each plan (§4.4).
