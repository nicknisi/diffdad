# Remove Local/Pairing Surface — Collapse Diff Dad to GitHub Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the local-working-tree / agent-pairing subsystem (`dad watch`, `dad add`, `dad comments`, the daemon's local-unit ingestion + agent-comment loop), collapsing Diff Dad to two coherent GitHub-oriented surfaces: `dad review <pr>` (one-shot PR review) and `dad daemon` (a GitHub PR-review command center).

**Architecture:** This is a deletion/refactor, not a feature. The ordering principle is **remove consumers before sweeping the now-dead modules**, so every task ends with a green build. Each task removes code _and its tests together_ and ends with build + test + lint green + a commit. The TypeScript compiler is the safety net: a missed importer surfaces as a build error, not a runtime bug.

**Tech Stack:** Bun workspaces monorepo; `packages/cli` (Bun + Hono server, MCP); `packages/web` (React 19 + Vite + Zustand). Tests: `bun test` (CLI), Vitest (web).

## Global Constraints

- **Formatter:** oxfmt — single quotes, trailing commas, 120 print width. Run `bun run format` before each commit.
- **Linter:** oxlint via `bun run lint` — must pass at every task boundary.
- **Build:** `bun run build` builds the web frontend (tsc + vite) — must pass; this is the primary typecheck gate for `packages/web`.
- **CLI tests:** `cd packages/cli && bun test` — must pass at every task boundary.
- **Web tests:** `cd packages/web && bunx vitest run` — must pass at every task boundary. (Confirm the exact script in `packages/web/package.json`; adjust if the repo wraps it as `bun run test`.)
- **Branch:** do all work on a dedicated branch off `main` (e.g. `cut/remove-local-pairing`). Do NOT commit to `main`.
- **Survivors (must still work after every task):** `dad review owner/repo#123`, `dad daemon` (poller + github units + lazy hydrate + two-way PR comments + CI/review status + approve/request-changes → GitHub), `dad config`, `dad cache`, auth, `paths.ts` migration.
- **Decision locked:** `dad review` is stripped to pure GitHub — the agent-comment loop is removed from `createServer` entirely (it is vestigial in PR mode: `commentTarget('pr') === 'review'`).

---

### Task 1: Remove the local CLI surface (`dad watch`, `dad add`, `dad comments`) + watch-mode server path

**Files:**

- Modify: `packages/cli/src/cli.ts` — remove `watchCommand`, `commentsCommand`, `addCommand`, their dispatch cases, their `Command` union members (`'watch' | 'comments' | 'add'`), `parseArgs` cases, and their help text; remove now-unused imports (`buildLocalReview`, `resolveBaseRef`, `NotAGitRepoError`, `resolveLocalIdentity`, `renderCommentsMarkdown`, `inferRepoFromGit`, `gitText`/`gitText`-only helpers, `basename`, `DEFAULT_DAEMON_PORT` if only `add` used it).
- Modify: `packages/cli/src/server.ts` — remove all watch-only code (see steps); collapse `ctx.mode` to a constant `'pr'`.
- Delete: `packages/cli/src/triage/` (entire dir — only `server.ts` watch path consumed `runTriage`).
- Delete: any triage test (`packages/cli/src/__tests__/triage*.test.ts` if present).

**Interfaces:**

- Consumes: nothing new.
- Produces: `createServer` no longer reads `ctx.mode`/`ctx.baseRef`/`ctx.contentKey`/`ctx.triage`; `ServerContext.mode` is removed (PR is the only mode). The agent-comment loop stays for now (removed in Task 3).

- [ ] **Step 1: Remove the three CLI commands.** In `packages/cli/src/cli.ts`, delete the `watchCommand`, `commentsCommand`, and `addCommand` functions; remove their `case` branches in the command dispatch (`'watch'`, `'comments'`, `'add'`) and in `parseArgs`/`Command` (`packages/cli/src/cli.ts:602`+); delete their lines from the help/usage text (`cli.ts:65-84` region — the `dad watch`, `dad comments`, `dad add` entries). Remove the now-dead imports listed above. Leave `reviewCommand` and `daemonCommand` intact.

- [ ] **Step 2: Strip watch-mode from `server.ts`.** Remove: the `mode`/`baseRef`/`contentKey`/`triage` fields from `ServerContext` (`server.ts:39-45`); `hasUnresolvedAgentComments`'s `ctx.mode === 'watch'` guard (keep the function for now but make it depend only on the store — Task 3 deletes it); `watchTick` (`95-120`); the triage block (`122-153`); the `if (ctx.mode === 'watch')` branch in `/api/narrative` (`158-179`); the watch branch in the SSE interval (`444-447`); change the SSE interval delay `ctx.mode === 'watch' ? 2000 : 10000` to `10000` (`616`); change the watch-mode error strings in `/api/comments` (`659`) and `/api/review` (`693`) — these `if (!ctx.github)` guards can stay as defensive 409s but drop the "in watch mode" wording. Remove the `buildLocalReview`, `runTriage`/`TriageFlag` imports (`server.ts:20-21`).

- [ ] **Step 3: Hardcode PR mode in the bootstrap.** In `/api/narrative` (`server.ts`), the response `mode: ctx.mode` becomes `mode: 'pr'` (two sites: the `generating` branch ~189 and the full branch ~219).

- [ ] **Step 4: Update `reviewCommand`'s context.** In `cli.ts` `reviewCommand` (~`cli.ts:286`), remove `mode: 'pr' as const` only if `ServerContext.mode` was removed (keep the object otherwise valid). Ensure the `ctx` object no longer sets `baseRef`/`contentKey`/`triage`.

- [ ] **Step 5: Delete `src/triage/` and any triage test.**

```bash
rm -rf packages/cli/src/triage
```

- [ ] **Step 6: Build, test, lint — expect green.**

Run:

```bash
bun run build && cd packages/cli && bun test && cd ../.. && bun run lint
```

Expected: PASS. If the build flags a dangling `triage`/`buildLocalReview`/watch import, remove that reference (it's a leftover consumer).

- [ ] **Step 7: Verify the commands are gone.**

Run: `bun packages/cli/src/cli.ts --help`
Expected: no `dad watch`, `dad comments`, or `dad add` lines; `dad review` and `dad daemon` still listed.

- [ ] **Step 8: Commit.**

```bash
bun run format
git add -A && git commit -m "refactor(cli): remove dad watch/add/comments + watch-mode server path"
```

---

### Task 2: Remove watch mode from the web frontend

**Files:**

- Delete: `packages/web/src/components/WatchView.tsx`.
- Modify: `packages/web/src/App.tsx` — remove the `WatchView` import (`:17`) and the `if (mode === 'watch')` branch (`:145-147`).
- Modify: `packages/web/src/state/review-store.ts` — narrow the `mode` union from `'pr' | 'watch' | 'command-center'` to `'pr' | 'command-center'` (`:56`, `:147`); fix the doc comment (`:53`).
- Modify: `packages/web/src/hooks/useNarrative.ts` — remove the `data.mode === 'watch'` branches (`:60`, `:121`) and narrow the local `mode?` type (`:23`).
- Modify: `packages/web/src/components/SubmitBar.tsx` (`:24`) and `packages/web/src/components/AppBar.tsx` (`:28`) — remove the `mode === 'watch'` checks (`SubmitBar` returns null only on no-narrative; `AppBar`'s `isWatch` is deleted along with any watch-only UI it gates).
- Modify: `packages/web/src/lib/units-view.ts` — remove `'watch'` from every `mode` union signature (`:169, :177, :181, :185, :192, :205, :219`) and the `if (mode === 'watch') return 'agent'` line in `commentTarget` (`:206`).
- Modify: `packages/web/src/lib/__tests__/units-view.test.ts` and `packages/web/src/hooks/__tests__/useLiveStream.test.ts` — delete the `'watch'` test cases (`units-view.test.ts:177, 201, 208, 226`; `useLiveStream.test.ts:148`).

**Interfaces:**

- Consumes: the narrowed `mode` union from `review-store`.
- Produces: `mode` is `'pr' | 'command-center'` everywhere; `commentTarget` returns only `'review' | 'github' | 'agent'` (agent still possible for command-center local units until Task 6).

- [ ] **Step 1: Delete `WatchView.tsx` and its `App.tsx` wiring.** Remove the import and the branch.

- [ ] **Step 2: Narrow the `mode` union** in `review-store.ts`, `useNarrative.ts`, and all `units-view.ts` signatures. Remove the watch branches in `useNarrative.ts`, `SubmitBar.tsx`, `AppBar.tsx`, and `commentTarget`.

- [ ] **Step 3: Delete the `'watch'` test cases** in `units-view.test.ts` and `useLiveStream.test.ts`.

- [ ] **Step 4: Build + web tests + lint — expect green.**

Run:

```bash
bun run build && cd packages/web && bunx vitest run && cd ../.. && bun run lint
```

Expected: PASS. A `TS2367`/"not comparable to type" error means a `=== 'watch'` comparison was missed — remove it.

- [ ] **Step 5: Commit.**

```bash
bun run format
git add -A && git commit -m "refactor(web): remove watch mode (WatchView + 'watch' mode branch)"
```

---

### Task 3: Strip the agent-comment loop from `dad review` (and delete `src/mcp/tools.ts`)

**Files:**

- Modify: `packages/cli/src/server.ts` — remove `ServerContext.store` (`:38`), the `/api/agent-comments` GET+POST routes (`:366-416`), the MCP mount (`:738`), the shutdown-gate references to `hasUnresolvedAgentComments` (`:627, :629`) and the function itself (`:86-88`), and imports (`AgentCommentStore` `:18`, `UnknownCommentError` `:19`, `registerAgentCommentTools` `:23`, `mountMcp` `:22` if now unused).
- Modify: `packages/cli/src/cli.ts` — in `reviewCommand`, drop `store: await AgentCommentStore.load(...)` (`:285`) and the `AgentCommentStore` import (`:3`).
- Modify: `packages/web/src/hooks/useNarrative.ts` — remove the `/api/agent-comments` fetch (`:123`).
- Delete: `packages/cli/src/mcp/tools.ts` (only `server.ts` consumed `registerAgentCommentTools`).
- Delete: `packages/cli/src/__tests__/mcp-tools.test.ts`, `packages/cli/src/__tests__/agent-comments-routes.test.ts`; trim agent-comment setup out of `packages/cli/src/__tests__/server.test.ts` (`:4, :127`) and `server-sse.test.ts` (`:2, :145`) — remove the `store:` field and any agent-comment assertions; keep the GitHub/PR-mode assertions.

**Interfaces:**

- Consumes: nothing new.
- Produces: `createServer` no longer mounts `/mcp` or `/api/agent-comments`; `dad review` is GitHub-only. `src/agent-comments/` is now consumed _only_ by the daemon (deleted in Task 7).

- [ ] **Step 1: Confirm the loop is vestigial in PR mode.** Verify `commentTarget('pr', …)` returns `'review'` (`units-view.ts`) and `commentGoesToAgent('pr')` is `false` — so the PR composer posts to GitHub, never the agent. (Already asserted in `units-view.test.ts:218,229`.) This confirms removing the routes loses no PR-mode feature.

- [ ] **Step 2: Remove the routes, mount, store field, and shutdown gate** from `server.ts` per the file list. The exit-timer condition `if (hadClients && sseClients.size === 0 && ctx.narrative && !hasUnresolvedAgentComments())` becomes `if (hadClients && sseClients.size === 0 && ctx.narrative)` (and the inner re-check likewise drops `|| hasUnresolvedAgentComments()`).

- [ ] **Step 3: Drop the store from `reviewCommand`** and remove the web `/api/agent-comments` fetch in `useNarrative.ts`.

- [ ] **Step 4: Delete `src/mcp/tools.ts` + the two dead test files; trim the two shared test files.**

```bash
rm packages/cli/src/mcp/tools.ts packages/cli/src/__tests__/mcp-tools.test.ts packages/cli/src/__tests__/agent-comments-routes.test.ts
```

- [ ] **Step 5: Build + CLI tests + web tests + lint — expect green.**

Run:

```bash
bun run build && cd packages/cli && bun test && cd ../web && bunx vitest run && cd ../.. && bun run lint
```

Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
bun run format
git add -A && git commit -m "refactor: strip agent-comment loop from dad review (GitHub-only PR mode)"
```

---

### Task 4: Remove the daemon's local-unit ingestion + agent loop

**Files:**

- Modify: `packages/cli/src/daemon/app.ts` — remove: `POST /api/units` ingest (`:261-311`), `POST /api/units/:id/retry` (`:317-342`), `GET/POST /api/units/:id/agent-comments` (`:446-505`), `GET /api/units/:id/presence` (`:512-516`), the per-unit comment-store machinery (`loadCommentStore`/`commentStores`/`getCommentStore` `:155-165`), `AgentActivity` wiring (`:170-172`), and the `registerSubmitTools` + `registerUnitCommentTools` mounts (`:689-701`) — remove the whole `mountMcp(...)` block (the daemon's MCP endpoint existed only for the local loop). Drop the now-unused `DaemonAppDeps` fields (`computeSlice`, `onSubmitted`, `awaitTimeoutMs`, `loadCommentStore`, `activity`) and imports (`AgentCommentStore`, `UnknownCommentError`, `registerUnitCommentTools`, `AgentActivity`, `DecisionChannel`, `registerSubmitTools`, `ComputeSlice`, `CleanTreeError`).
- Modify: `packages/cli/src/daemon/daemon.ts` — remove `computeSlice` (`:297`), the `ReviewWorkerPool` wiring (`:296, :309`), `DecisionChannel` (`:293`), `reviewUnit` (`:249-258`), `onSubmitted`, and the `decision` dep passed to `createDaemonApp`; remove imports (`buildLocalReview`, `DecisionChannel`, `ReviewWorkerPool`, `ReviewResult`). Keep all GitHub deps (poster/hydrate/fetcher/etc.) and `pool.kick()`→delete.
- Delete: `packages/cli/src/daemon/pool.ts`, `packages/cli/src/units/decision-channel.ts`, `packages/cli/src/units/agent-activity.ts`, `packages/cli/src/mcp/submit.ts`, `packages/cli/src/mcp/unit-comments.ts`.
- Delete tests: `daemon/__tests__/pool.test.ts`, `units/__tests__/decision-channel.test.ts`, `__tests__/mcp-submit.test.ts`, `__tests__/unit-agent-comments.test.ts`; trim local cases from `__tests__/units-routes.test.ts` (the ingest/retry/agent-comment/presence cases — keep the github decision/hydrate/comments/status/review cases) and from `daemon/__tests__/*` that exercised the pool/submit.

**Interfaces:**

- Consumes: the surviving `UnitStore` github methods (Task 5 narrows them).
- Produces: the daemon serves only github routes (`/api/units`, `/api/units/:id`, `/api/units/:id/decision` (github branch), `/hydrate`, `/comments`, `/review`, `/ai`, `/status`, `/events`) + the SPA. No `/mcp`, no ingest, no agent-comments, no presence.

- [ ] **Step 1: Remove the local routes + MCP mount from `app.ts`.** Delete the route blocks and helper closures listed; remove the `mountMcp(...)` block entirely. The `/api/units/:id/decision` route keeps only its `decisionTarget(existing) === 'github'` path (the `agent/cli` branch at `app.ts:244-255` is removed; a non-github unit can no longer exist).

- [ ] **Step 2: Simplify `daemon.ts` startup.** Remove the pool, `computeSlice`, `DecisionChannel`, `reviewUnit`, `onSubmitted`; delete the `pool.kick()` calls and the "resuming review" log. Update the startup banner: replace the "Point an agent at the review loop / submit*for_review" block (`daemon.ts:342-346`) with a line pointing at the GitHub review queue (e.g. *"Watching GitHub for review requests."\_ / the poller-off hint already at `:357`).

- [ ] **Step 3: Delete the dead modules + their tests.**

```bash
rm packages/cli/src/daemon/pool.ts packages/cli/src/units/decision-channel.ts \
   packages/cli/src/units/agent-activity.ts packages/cli/src/mcp/submit.ts \
   packages/cli/src/mcp/unit-comments.ts \
   packages/cli/src/daemon/__tests__/pool.test.ts \
   packages/cli/src/units/__tests__/decision-channel.test.ts \
   packages/cli/src/__tests__/mcp-submit.test.ts \
   packages/cli/src/__tests__/unit-agent-comments.test.ts
```

- [ ] **Step 4: Trim `units-routes.test.ts`** — delete the ingest (`POST /api/units`), retry, agent-comments, and presence test cases; keep github decision/hydrate/comments/status/review cases. (Search the file for `CleanTreeError`, `/agent-comments`, `/presence`, `/retry`, `submit`.)

- [ ] **Step 5: Build + CLI tests + lint — expect green.**

Run:

```bash
bun run build && cd packages/cli && bun test && cd ../.. && bun run lint
```

Expected: PASS. Dangling-import errors point at a missed consumer in `app.ts`/`daemon.ts`.

- [ ] **Step 6: Commit.**

```bash
bun run format
git add -A && git commit -m "refactor(daemon): remove local-unit ingestion, worker pool, and agent MCP loop"
```

---

### Task 5: Collapse the unit store + state machine to GitHub-only

**Files:**

- Modify: `packages/cli/src/units/types.ts` — narrow `UnitStatus` to `'queued' | 'approved' | 'changes_requested' | 'done'` (remove `'submitted' | 'reviewing' | 'addressing'`); narrow `UnitSource` to `'github'` (or remove `source` entirely — keep as `'github'` literal for least churn). Update the state-machine doc comment (`:4-9`).
- Modify: `packages/cli/src/units/store.ts` — remove `add`, `resubmit`, `findByWorktree`, `setReviewing`, `setQueued`, `setReviewFailed`, and the local edges from `TRANSITIONS`; keep `addGithubUnit`, `attachReview`, `setDecision`, `setReviewedSha`, `resurfaceForNewPush`, `linkPr`, `remove`, `list`, `get`. In `load()`, drop any unit with `source !== 'github'` (replaces the `u.source ??= 'agent'` back-compat at `:93`).
- Modify: `packages/cli/src/units/decision-target.ts` — `decisionTarget` now always returns `'github'`; simplify or inline. Keep `linking.ts` (poller uses it) unchanged.
- Modify tests: `units/__tests__/store.test.ts` (drop local-mutator + local-transition tests; keep github lifecycle), `units/__tests__/decision-target.test.ts` (github-only), `units/__tests__/linking.test.ts` (unchanged unless it minted local units).

**Interfaces:**

- Consumes: nothing new.
- Produces: `TRANSITIONS = { queued: ['approved','changes_requested'], approved: ['done'], changes_requested: [], done: [] }`. `UnitStatus` is the 4-value union. All units are `source: 'github'`.

- [ ] **Step 1: Narrow `UnitStatus`/`UnitSource` + `TRANSITIONS`** to the github-only set above.

- [ ] **Step 2: Remove the local store methods**, and make `load()` drop non-github persisted files (a unit written by the old local path is no longer representable):

```ts
for (const u of parsed) {
  if (u && typeof u.unitId === 'string' && u.source === 'github') initial.push(u);
}
```

- [ ] **Step 3: Simplify `decisionTarget`** to always return `'github'`; update its callers/tests.

- [ ] **Step 4: Trim the store/decision-target tests** to the github lifecycle.

- [ ] **Step 5: Build + CLI tests + lint — expect green.**

Run: `bun run build && cd packages/cli && bun test && cd ../.. && bun run lint`
Expected: PASS. An `IllegalTransitionError` in a surviving test means a github edge was dropped — re-add it to `TRANSITIONS`.

- [ ] **Step 6: Commit.**

```bash
bun run format
git add -A && git commit -m "refactor(units): collapse store + state machine to github-only"
```

---

### Task 6: Collapse the web drill-in + command center to GitHub-only

**Files:**

- Modify: `packages/web/src/components/UnitReview.tsx` — remove the `!isGithub` branches: the `AgentPresencePill` (`:48-77, :387`), the agent-comments fetch effect (`:184`+), and the agent/cli decision bar (`:511-575`); keep the github review bar (`:480-507`), the CI/review status strip, and the github comment flow. The drill-in is now always the github experience.
- Modify: `packages/web/src/components/UnitRow.tsx` + `packages/web/src/components/CommandCenter.tsx` — remove the `agent`/`cli` source badges + tones (`UnitRow.tsx:13-17`, `units-view sourceBadge`), and any presence usage. Update the empty-state copy (`CommandCenter.tsx:193-202`) to describe the GitHub queue (e.g. _"Open a review request on GitHub and it shows up here."_) instead of `submit_for_review`.
- Modify: `packages/web/src/lib/units-view.ts` — `commentTarget` now returns `'github'` for any command-center unit (remove the `'agent'` path); remove `agentPresence`, `sourceBadge`'s agent/cli arms, `commentGoesToAgent` (or hardcode `false`), and `agentCommentsEndpoint`.
- Modify: `packages/web/src/components/CommentThread.tsx` + `ResolveStrip.tsx` — remove the `'agent'` target branches ("Send to agent", `commentGoesToAgent` gating); the composer is GitHub/review-only.
- Modify hooks: `useComments.ts`, `useInlineComments.ts` — remove the `commentGoesToAgent` agent branch + `agentToPRComments` usage if now dead (`lib/agent-comments.ts` may become deletable — check importers).
- Modify tests: `lib/__tests__/units-view.test.ts` — drop the `'agent'`/command-center-local `commentTarget`/`commentGoesToAgent` cases; keep `'github'`/`'review'`.

**Interfaces:**

- Consumes: the github-only `Unit` shape (`source: 'github'`).
- Produces: a single github drill-in; `commentTarget` ∈ `{'review','github'}`.

- [ ] **Step 1: Collapse `UnitReview` to the github experience** — delete the non-github pill, fetch, and decision bar; the component no longer branches on `isGithub`.

- [ ] **Step 2: Remove agent/cli source badges + presence** from `UnitRow`/`CommandCenter`/`units-view`; rewrite the empty state for the GitHub queue.

- [ ] **Step 3: Remove the `'agent'` composer path** from `units-view`, `CommentThread`, `ResolveStrip`, `useComments`, `useInlineComments`. If `lib/agent-comments.ts` has no remaining importers, delete it + its test.

- [ ] **Step 4: Trim `units-view.test.ts`** to `'review'`/`'github'` targets.

- [ ] **Step 5: Build + web tests + lint — expect green.**

Run: `bun run build && cd packages/web && bunx vitest run && cd ../.. && bun run lint`
Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
bun run format
git add -A && git commit -m "refactor(web): collapse unit drill-in + command center to github-only"
```

---

### Task 7: Final dead-module sweep + dependency prune

**Files:**

- Delete: `packages/cli/src/agent-comments/` (store, types, markdown) and `packages/cli/src/local/` (diff-source, git, identity) — both now have zero non-test importers.
- Delete tests: `__tests__/agent-comments.test.ts`, `__tests__/agent-comments-markdown.test.ts`, `__tests__/agent-comments-sse.test.ts`, `__tests__/local-diff.test.ts`.
- Modify: `packages/cli/src/paths.ts` — remove `'agent-comments'` from `DURABLE_SUBDIRS` (`:27`); update `__tests__/paths.test.ts` (`:30-39`) to migrate only `units`.
- Modify: `packages/cli/src/__tests__/server-sse.test.ts` (if still referencing `agent-comments`) — final trim.
- Modify: `package.json` (root + workspaces) — drop dependencies that were only used by removed code (audit `open` — still used by `dad review`/daemon `--open`, so KEEP; check any triage-only deps).

**Interfaces:**

- Consumes: nothing.
- Produces: the dead local/agent-comment modules no longer exist anywhere in the tree.

- [ ] **Step 1: Confirm zero importers** before deleting:

Run:

```bash
grep -rn --include='*.ts' --include='*.tsx' "agent-comments\|local/diff-source\|local/git\|local/identity\|buildLocalReview" packages | grep -vE "(agent-comments/|local/|__tests__)"
```

Expected: no output. Any hit is a consumer that an earlier task missed — fix it before deleting.

- [ ] **Step 2: Delete the modules + tests.**

```bash
rm -rf packages/cli/src/agent-comments packages/cli/src/local \
   packages/cli/src/__tests__/agent-comments.test.ts \
   packages/cli/src/__tests__/agent-comments-markdown.test.ts \
   packages/cli/src/__tests__/agent-comments-sse.test.ts \
   packages/cli/src/__tests__/local-diff.test.ts
```

- [ ] **Step 3: Prune `paths.ts`** `DURABLE_SUBDIRS` to `['units']` and update `paths.test.ts`.

- [ ] **Step 4: Full green gate.**

Run:

```bash
bun run build && cd packages/cli && bun test && cd ../web && bunx vitest run && cd ../.. && bun run lint
```

Expected: PASS, no skipped suites.

- [ ] **Step 5: Smoke-test the survivors manually.**

Run (in two shells):

```bash
bun packages/cli/src/cli.ts review <a-real-pr>   # renders, comments post to GitHub, no /mcp, no "send to agent"
bun packages/cli/src/cli.ts daemon                # boots, banner mentions GitHub queue (no submit_for_review), poller runs
```

Expected: both work; `dad daemon status` reports running.

- [ ] **Step 6: Commit.**

```bash
bun run format
git add -A && git commit -m "chore: sweep dead local/agent-comment modules + prune durable subdirs"
```

---

## Self-Review

**1. Spec coverage** (against the conversation's locked scope):

- `dad watch` removed → Task 1 (CLI) + Task 2 (web). ✓
- `dad add` + `dad comments` removed → Task 1. ✓
- Daemon local ingestion / pool / decision channel / presence / agent MCP loop → Task 4. ✓
- `source` fork collapsed (store + web) → Task 5 + Task 6. ✓
- Agent loop stripped from `dad review` (the locked decision) → Task 3. ✓
- `src/local/` + `src/agent-comments/` + `src/triage/` + `src/mcp/{tools,submit,unit-comments}.ts` deleted → Tasks 1/3/4/7. ✓
- Persisted local units dropped on load → Task 5 Step 2. ✓
- Survivors (`dad review`, `dad daemon` github path, config/cache/auth/paths) → Global Constraints + Task 7 Step 5 smoke test. ✓

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Deletion tasks name exact files/symbols/line ranges; the two rewrites with real logic (state machine in Task 5, load() filter) show actual code. ✓

**3. Type consistency:** `UnitStatus` (4 values) and `TRANSITIONS` defined once in Task 5 and referenced consistently. `mode` union (`'pr' | 'command-center'`) narrowed in Task 2 and used by Tasks 3/6. `commentTarget` codomain shrinks `'agent'`→gone in Task 6, consistent with Task 2's union narrowing. ✓

**Ordering invariant:** every module deletion (Tasks 1/3/4/7) happens only after its consumers are removed in the same or an earlier task, so each task boundary builds clean.
