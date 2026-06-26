# Diff Dad Review Loop Contract

**Created**: 2026-06-25
**Readiness**: All 5 gates ready
**Status**: Approved
**Supersedes**: None (continues the prior `agent-comment-loop` ideation, whose watch mode is the foundation)

## Problem Statement

Nick runs ~12 coding agents in parallel across repositories and is the review bottleneck. He babysits a dozen tmux panes, forgets to return to finished work, and every change he does review he reads cold as a drive-by. Work sits unreviewed because nothing pulls him back to it, and there is no single place to see what every agent is doing or what is waiting on him.

Diff Dad today has two disconnected modes — `dad watch` (local working tree, in-flight on this branch) and `dad review` (GitHub PR) — and running them in different places is itself friction. Its core "PRs into narrated stories" pipeline is too slow for a review loop: PR mode blocks on a full multi-chapter LLM generation (often via the local `claude -p` path, which dad's own loading screen warns is ~minutes and ~5–10× slower than the API) before showing anything, and the resulting prose isn't more revealing than a plain diff. The storytelling concept is valued; its latency and ceremony are not.

The fix is to make Diff Dad a single, daemon-backed command center that shows all in-flight work and everything awaiting review across repos, renders diffs instantly, and uses a streamlined, streaming guided walkthrough to build genuine understanding of each change — yours and the agents' — rather than narrate at you.

## Goals

1. One cross-repo home lists every unit — agent-running, your working trees, open PRs, and units awaiting review — so nothing depends on remembering to visit a pane.
2. Opening any unit renders the diff on first paint, with no blocking "generating" screen; the guided walkthrough streams in over it.
3. The walkthrough is streamlined and streams per section (beat rail + interleaved prose + resolve strips), replacing cold diff-reading with guided understanding.
4. Watch and review stop being separate modes: local working trees, agent units, and PRs are one list distinguished by status, not by command.
5. (Phase 3) The review verdict is produced by a model in a different family than the author, giving an independent second opinion.
6. (Phase 4) Safe units auto-clear without the human (agent opens a PR); only non-clearing units enter the needs-you queue.

## Success Criteria

- [ ] `submit_for_review` registers a unit visible in the command center, agent receives the decision back over MCP — check: `cd packages/cli && npx vitest run src/__tests__/review-units.test.ts` — exits 0
- [ ] Opening a unit shows the diff before the guide finishes (no blocking generate screen) — check: `cd packages/web && npx vitest run src/state/__tests__/unit-gate.test.ts` — exits 0
- [ ] The walkthrough builds as beat rail + interleaved prose + resolve strips, streaming per section — check: `cd packages/web && npx vitest run src/lib/__tests__/walkthrough.test.ts` — exits 0
- [ ] The daemon survives the launching terminal closing and serves a cross-repo queue — check: `launchctl load; close terminal; curl -s localhost:<port>/api/units` returns units from two repos
- [ ] The skeptic's verdict is produced by a model family different from the author's — check: `cd packages/cli && npx vitest run src/__tests__/skeptic.test.ts` (asserts skeptic provider != author) — exits 0
- [ ] Auto-clear fires only when verdict safe AND checks green AND zero to resolve — check: `cd packages/cli && npx vitest run src/__tests__/auto-clear-gate.test.ts` — exits 0
- [ ] Notifier surfaces a pending needs-you count matching the queue length — check: status script against a seeded queue of N prints N
- [ ] The walkthrough's prose feels scannable, not a wall — judgment call: read a real walkthrough in the dev server

## Scope Boundaries

### In Scope

- Diff-first guided review experience: beat rail (evolve `ChapterTOC`) + streamlined interleaved prose (evolve `Chapter`) + inline resolve strips; instant diff, per-section streaming; API path default.
- Daemon command center: cross-repo home (needs-you / in-flight / cleared), `submit_for_review` enqueue, tracks agents + working trees + PRs as one status-grouped list; persistent list first, launchd terminal-survival as hardening.
- Cross-model skeptic: independent reviewer on a non-author model family (`--with codex` default, or a config API provider); verdict + cited, confidence-scored concerns feeding rail flags + recommended action.
- Checks runner + auto-clear gate: build/test/lint/type in the worktree; auto-clear safe+green+0-to-resolve (decision over MCP channel; agent opens PR; merge left to human/policy).
- Notifier + stdio MCP proxy: tmux status, macOS push, stale escalation, digest; global one-time MCP registration via a net-new stdio proxy.
- (Stretch, in scope) Per-repo auto-merge opt-in; on-demand "Ask dad" Q&A inside the walkthrough.

### Out of Scope

- Multi-machine queue sync — per-machine daemon only; cross-machine sync is a future sibling workflow.
- Human-reviewer routing/assignment beyond opening a PR — the brief makes the ask cheap; explicit reviewer selection is a separate workflow.
- Non-Claude authors — author assumed = Claude; the cross-model skeptic provides the independence.

### Future Considerations

- Widen auto-merge as empirical trust in the gate grows.
- Multi-machine queue sync.
- Human-reviewer routing as a sibling workflow.

## Execution Plan

_Specs are generated just-in-time: Phase 1's spec exists now; Phases 2–5 are written as each is reached, because P1/P2's reality sharpens the later phases (and the net-new stdio proxy + auto-clear policy shouldn't be guessed at today)._

### Dependency Graph

```
Phase 1: Review experience (diff-first guided walkthrough)
  ├── Phase 2: Command center (daemon)        (blocked by P1)
  │     └── Phase 5: Notifier + stdio proxy    (blocked by P2)
  └── Phase 3: Cross-model skeptic             (blocked by P1)

Phase 4: Checks + auto-clear gate              (blocked by P2 AND P3)
```

After Phase 1, Phases 2 and 3 are independent and may run in parallel (coordinate on `packages/cli/src/server.ts`, which both touch). Phase 4 waits on both 2 and 3; Phase 5 waits on 2.

### Execution Steps

**Strategy**: Sequential (just-in-time spec generation); Phases 2 & 3 may parallelize once both are spec'd.

1. **Phase 1** — Review experience (diff-first guided walkthrough) _(blocking; spec ready)_

   ```bash
   /ideation:execute-spec docs/ideation/dad-review-loop/spec-phase-1.md
   ```

2. **Phase 2** — Command center (daemon) _(blocked by P1; spec generated after P1 lands)_

   ```bash
   /ideation:execute-spec docs/ideation/dad-review-loop/spec-phase-2.md
   ```

3. **Phase 3** — Cross-model skeptic _(blocked by P1; may run parallel to P2)_

   ```bash
   /ideation:execute-spec docs/ideation/dad-review-loop/spec-phase-3.md
   ```

4. **Phase 4** — Checks + auto-clear gate _(blocked by P2 AND P3)_

   ```bash
   /ideation:execute-spec docs/ideation/dad-review-loop/spec-phase-4.md
   ```

5. **Phase 5** — Notifier + stdio proxy _(blocked by P2)_

   ```bash
   /ideation:execute-spec docs/ideation/dad-review-loop/spec-phase-5.md
   ```

---

_This contract was generated from a design + ideation session. Phase 1 is ready to execute; later phases are spec'd just-in-time._
