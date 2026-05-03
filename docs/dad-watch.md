# `dad watch` — narrating your branch as you go

## Thesis

Diff Dad already does a good job turning *other people's* PRs into narrated stories. The problem this PR addresses is the symmetric one: **reviewing your own in-progress work**, especially when most of that work was written by an AI agent.

The honest observation that motivated this PR was that reviewing your own agent's code is a tenuous activity. When Claude (or Cursor, or Codex) writes 80% of a feature, the human's review pass tends to skim — the code "looks right," it compiles, the tests pass, and confirmation bias does the rest. Bugs slip through that a fresh reviewer would catch in five seconds. Worse, in a long agent-driven session, the human often *doesn't actually know* what the agent built in detail: they prompted, the agent worked, they nodded at the result. By the time the PR opens, the author is no longer a fresh reviewer of their own work — they're a half-informed observer of work that was mostly done without them.

`dad watch` is meant to address both halves of that:

1. **Help you understand what's being built.** As each commit lands, Dad narrates it in plain prose: what changed at the behavioral level, what consequences that has, what subtle assumptions are baked in. This is the *comprehension* layer — you stop being a half-informed observer and become someone who actually knows what's in their feature. You can't review what you can't articulate; this gets you to the point where you could.
2. **Scrutinize what was built.** On top of the comprehension, the scrutinize lens explicitly asks "what would a senior reviewer push back on, what tests are missing, what error paths aren't handled, what looks subtle and risky." This is the *review* layer — and it works precisely because the comprehension layer made the change legible enough to actually critique.

These aren't separate features; they're sequential outputs of the same narration. The narrative section of each chapter explains the change (understand); the callouts and missing-items list flag what to question (scrutinize). Optionally, on demand, you can fold the whole branch into a single coherent story to see how the feature reads end-to-end — same two layers, applied to the unified diff.

The framing the user landed on during design — and the one that should guide future iteration — is:

> Dad helps me practice for the real world of code reviews.

That phrasing matters. It's not about generating PR descriptions, not about replacing review, not about making you feel good. It's about (a) catching you up on what your agent actually did, then (b) training your own attention so the eventual human review (yours, your teammates') has a better chance of catching what matters.

## What's in scope for this PR

A new top-level CLI command — `dad watch [branch] [--base <ref>]` — that:

1. Detects the current branch (or accepts one as an argument), auto-detects the base via `origin/HEAD` → `main` → `master` (with `--base` override), and computes the merge-base.
2. Lists the commits in `base..head` (oldest first, skipping merge commits).
3. Generates one narrative per commit using a **scrutinize-mode** system prompt that explicitly emphasizes absences, pushback, and honest "I can't verify this from the diff alone" notes.
4. Caches narratives by `(repoFingerprint, sha)` so stable SHAs are never re-narrated. Rebased / squashed / amended SHAs disappear cleanly from the timeline; we don't try to carry chapters forward across history rewrites.
5. Polls `git rev-parse <branch>` every 2 seconds. New commits trigger background narration; rewritten history triggers a refresh that drops orphaned chapters and narrates the new SHAs.
6. Serves a local web UI (Hono + React) showing a horizontal commit timeline. Click any commit chip to switch the narrative pane to that commit. Click "Whole branch" to lazily generate a fresh narration of `base..HEAD` as one story.
7. Sends live updates over the existing SSE channel — `commit-narrating`, `commit-narrative`, `unified-narrating`, `unified-narrative`, `watch-update` events let the UI react in real time.

It is, deliberately, **read-only**. Watch mode never writes to the repo, never posts to GitHub, never sends data anywhere except your local LLM call. The only persistent artifact is the narrative cache at `~/.cache/diffdad/watch/`, which is yours to delete with `dad cache clear`.

## What's deliberately NOT in scope, and why

This is the long version. Each of these came up during design, and each one is shippable on its own merits — but shipping them all together would have produced a feature too brittle to trust.

### 1. The feedback loop (commenting → agent → code change)

This is the deferred prize, and the most important thing to be honest about.

**The vision (eventually).** You read Dad's narrative of a commit, leave a comment on a specific line ("this should handle the empty case", "rename `foo` to `userId`", "extract this into a helper"), and that comment is fed back to your coding agent — Claude, Cursor, Codex, whatever — which makes the change, commits, and Dad re-narrates. A closed loop where the human stays in review-and-direct mode and the agent stays in code-mode.

**Why it's not in this PR.** Every piece of it has at least one hard, unsolved problem:

- **Anchor stability across history rewrites.** AI workflows rebase, squash, and `--amend` constantly. Comments anchored by `(file, line, sha)` orphan themselves the moment the agent rewrites a commit. The fix is content-based fuzzy anchoring (store the original lines + 3–5 lines of context, search HEAD for the snippet on each rebase) — but that's a heuristic. When it gets the anchor wrong, the agent acts on bad context, and the failure is silent: the user nods at code that "addressed" their comment but actually missed the point.

- **Chapter identity drift across re-narrations.** Comments anchored to "Chapter 2" lose meaning when the next commit re-narrates and Chapter 2 becomes Chapter 3 or merges into Chapter 1. The fix is fingerprinting chapters by their hunk set and matching by Jaccard overlap. Another heuristic. Stacks on top of the previous one.

- **Closing the loop is the part that quietly doesn't work.** Writing a `feedback.jsonl` is trivial. Getting the coding agent to actually read it at the right moment, and only at the right moment, is the whole game. Skill that the user has to remember to invoke? Often forgotten. Hook that fires automatically? Wrong moments. Polling MCP? Race conditions. Without an integration tight enough that comments feel like talking *to* the agent, the file becomes notes that never get acted on.

- **Schema design under churn.** Comments need types (line, range, chapter, global), threading (replies), edit semantics, dismissal/resolve states, an outdated detector. JSONL event-log replay is the right model — but every one of those concerns has subtle edge cases (what if a comment is edited then resolved? what if a thread reply lands on an outdated parent?) that compound when implemented speculatively.

- **Failure modes are silent and trust-eroding.** A normal bug crashes or shows a wrong number. Anchor-drift bugs cause an agent to "address" feedback in subtly wrong code locations, which a tired user nods at. That's worse than a crash, because it makes the tool *feel* useful while making review *worse*.

The decision was: **defer until real usage of watch mode shows what hurts.** Watch-and-narrate is genuinely solid by itself — no anchoring problem because there's no persistent state across rewrites — and shipping just that gives us a real artifact to use day-to-day. The shape of the feedback loop will be much clearer after a few weeks of "I keep wanting to do X with this commit's narrative" observations than from a whiteboard.

When it does land, it'll be its own feature with its own design conversation, its own scope, its own thesis. Likely components: a JSONL event log at `~/.cache/diffdad/watch/<repoFp>-<branch>-feedback.jsonl`, content+context-based anchoring with the SHA as a hint, an MCP server exposing read-only feedback queries to coding agents, and a hydration step that turns raw events into agent-ready briefs (chapter context + hunk + comment body in one prompt-shaped blob).

For now, the comment-adding UI surfaces leftover from PR mode are visible in watch mode but nonfunctional — drafts go to localStorage with no destination. A follow-up will hide those affordances until the feedback loop ships, so the UI matches reality.

### 2. Watching the working tree (uncommitted changes)

**Tempting because:** it would feel even more "live" — narration as you literally type, before any commit.

**Why it's not in this PR.**

- Working-tree state changes on every file save. Without aggressive debouncing, an active agent session triggers an LLM call every few seconds. With aggressive debouncing, the narrative lags behind reality and feels stale.
- Half-edited code is the worst possible narration target. "I see you're in the middle of a function" is not useful prose, and the LLM will produce *something* — usually a confused or cautiously hedged paragraph — rather than admit it can't tell what's going on.
- There is no SHA to anchor against, so caching has no key. Every regeneration is a fresh full-cost call.
- Commits are the natural "I want a story now" moment. They're already explicit checkpoints that the user (or the agent) chose to mark.

**Future path.** If real usage of watch mode shows people genuinely miss the working-tree view, an on-demand "preview uncommitted" button — fires once, doesn't auto-update, narrates `git diff HEAD` — solves the use case without the auto-update mess.

### 3. MCP server for feeding data back to the model

**The vision.** A Model Context Protocol server (`dad mcp serve` or similar) that exposes Dad's narratives, comments, and chapter context to any MCP-aware coding agent. The agent can query `dad_list_open_feedback`, `dad_get_chapter_context(commitSha, chapterIndex)`, `dad_resolve_feedback(id)` — pulling the right context at the right moment without the user having to copy-paste anything.

**Why it's not in this PR.**

- The MCP is the *data plane* for the feedback loop. Without comments to query, there's nothing meaningful to expose. The narrative itself is already accessible via the local web API; an MCP wrapper without the feedback layer would just be a second access path to the same data.
- Multiple agents speak MCP differently in practice (some auto-discover servers, some need explicit registration, some have rate limits we'd need to design around). Building this once we know which agents users are pairing with watch mode is a much better-informed design than building it speculatively.
- The MCP will be the right shape *if and when* the feedback loop is built. Building it before the feedback loop has a defined schema would lock us into a wire format we'd likely want to change.

**Future path.** When the feedback loop lands, the MCP comes with it as the canonical access surface. Likely shape:
```
tools:
  dad_list_open_feedback(branch?) -> Feedback[]
  dad_get_feedback(id) -> Feedback (hydrated with chapter + hunk context)
  dad_get_chapter(commitSha, chapterIndex) -> Chapter
  dad_resolve_feedback(id, note?) -> void
  dad_get_branch_summary() -> { commits, narrativeSummaries }
```
Plus a `SessionStart` hook in the user's coding-agent config that nudges "you have N open Dad comments — want me to check them?"

### 4. Auto-posting per-commit narratives as GitHub commit comments

**The vision.** Each per-commit narrative gets pushed up to GitHub as a commit comment. When the PR eventually opens, those comments are already there as context for human reviewers.

**Why it's not in this PR.**

- GitHub commit comments are a UI backwater. They appear in the Commits tab but are invisible from the Files-changed tab where most review actually happens. They have no threading, no resolve state, no good interaction with PR review comments.
- WIP narratives baked into permanent commit history is the wrong default. If your feature has 30 commits and 20 of them are "fix typo" / "address feedback" / "wip", you don't want 30 narratives smeared across the public commit log.
- Force-push or rebase orphans every commit comment ever made.
- Most importantly, this conflates two distinct phases: the **personal review** phase (where Dad helps the author scrutinize their own work, ideally privately and rough-around-the-edges) and the **published artifact** phase (where the author has consolidated the story and wants to surface it for others).

**Future path.** When `dad watch` matures, an explicit `dad publish` (or similar) action could consolidate per-commit narratives into a single PR description draft, or a single top-level PR review comment, that the user sees and approves before posting. That respects both phases. The existing PR-with-commit-comments work can be revisited under that frame, but the current default of "auto-post each commit narrative" should not ship.

### 5. Comment anchoring across history rewrites

**The problem.** If watch mode had comments, those comments would need to survive `git rebase`, `git commit --amend`, `git reset`, and squash-on-merge — all of which AI agents do constantly during a normal feature.

**The candidate solutions, all heuristic.**

- **Content + context anchoring.** Store `(file, originalLines, contextBefore[3..5], contextAfter[3..5], originalSha)`. On read, fuzzy-search HEAD for the original snippet. SHA is a hint, not a requirement. Survives most rewrites.
- **AST/symbolic anchoring** (tree-sitter). Anchor to "function `foo` in `bar.ts`, statement N." Survives more aggressive refactors but requires per-language grammar maintenance.
- **Three-state result.** Found exactly → anchor refreshed. Found with edits → outdated badge with original-vs-current view. Not found → orphaned tray with original code preserved.

**Why it's not in this PR.** Watch mode has no comments to anchor. Without comments, there's nothing for the anchor algorithm to do. When the feedback loop arrives, this becomes the load-bearing algorithm and deserves its own pressure-testing pass — including a deliberate effort to make the failure modes *loud*, not silent.

### 6. Outdated comment detection

**The vision.** When code under a comment changes in subsequent commits, the comment is auto-tagged "outdated", shown dimmed with a badge, and the original-vs-current code can be expanded inline. Dismiss appends a `{kind:"resolve"}` event to the JSONL log; pin marks the comment so it's not re-flagged.

**Why it's not in this PR.** Same reason as anchoring — no comments to flag.

**Note for future design.** The critical rule is **detect-and-surface, never auto-resolve.** A code change can make a comment *more* relevant, not less; silently dropping it is the worst possible behavior.

### 7. Cross-model recommendation (codex narrating, claude coding)

**The risk.** Same-family LLMs share blind spots. If Claude writes the code and Claude narrates it, the things one model missed in writing tend to be the things the other misses in scrutinizing. That partially defeats the "fresh reviewer" purpose.

**Why it's not enforced in this PR.** The infrastructure is already there — `--with=codex`, `--with=claude`, `--with=pi` flags exist on the existing `dad review` flow and work for `dad watch` too. Enforcing or recommending a different model than the user's agent uses would require knowing what their agent uses, which we don't.

**Future path.** README and the `dad watch` first-run prompt should explicitly recommend cross-family narration: "Tip: if Claude wrote the code, run `dad watch --with=codex` (or similar) for a more independent read." Not gating the PR, but worth landing before any public release.

### 8. UI affordances for comments in watch mode

The current state is a small honesty bug: the existing line-comment and chapter-comment UI from PR mode is still rendered in watch mode (it's the same `Chapter` component), but watch mode's server has no `/api/comments` or `/api/review` endpoints. Drafts get saved to `localStorage` and never go anywhere.

**Resolution.** Follow-up commit will hide the comment-add affordances entirely in watch mode. When the feedback loop ships, those affordances come back with a real destination — and that's a more satisfying landing than "incrementally less broken drafts."

### 9. Working with non-git VCSes

Mercurial, jj, sapling, etc. are all out of scope. Watch mode shells out to `git` directly via `Bun.spawn`. Adding VCS abstraction is far ahead of where the user-facing feature is in maturity.

### 10. Multi-branch / multi-repo watching

`dad watch` watches one branch in one repo. Not a "dashboard of all my in-flight work." That's a real product surface but a different one — likely better as a separate `dad dashboard` command that aggregates results from many `dad watch` runs.

---

## Architectural decisions worth flagging for future maintainers

These are the choices that shaped the PR's structure. Calling them out here so they're easy to revisit if assumptions change.

### Per-commit as the narration unit, not the rolling story

The first instinct was "narrate `base..HEAD` as one story, regenerate on every commit." That has two failure modes:
- **Cost.** You re-narrate the entire branch on every commit. 30 commits = 30 full-branch narrations.
- **Narrative collage drift.** Each regeneration is a fresh take — chapter structure shifts, tone shifts, callouts move. The user's mental model of "the story so far" gets perturbed every commit.

Per-commit narration gives:
- **Cheap incrementals.** Each commit's narrative is small and cached forever once generated.
- **Honest unit boundaries.** Each chapter set corresponds to one commit. Easier for the user to reason about "what did this commit do."
- **Stable cache keying.** SHA in, narrative out. Stable.

The unified view is offered as an explicit, on-demand, **separate** narration of `base..HEAD` — not stitched from the per-commit ones. Stitching produces incoherence; a fresh full-branch narration produces a real story. The cost of one occasional unified call is justified by the quality difference.

### Watch mode is a separate server, not a retrofit of `dad review`

`packages/cli/src/server.ts` is built around PR mode: GitHub client, comment posting, review submission, check-run polling, comment-to-chapter mapping. Trying to graft "no GitHub, no comments, no PR" onto that produced a tangle of `if (mode === 'watch')` branches. A parallel `watch-server.ts` is cleaner and cheaper to maintain.

The frontend, in contrast, *is* a retrofit — same Zustand store, same `Chapter`/`StoryView` components, just gated by a `mode: 'pr' | 'watch'` flag and a watch slice. That's because the *display* of a narrative is genuinely the same operation regardless of where the narrative came from. The data path is the part that diverges.

### Polling vs file-watching for new commits

`fs.watch` on `.git/refs/heads/<branch>` doesn't work reliably:
- Packed refs (`git pack-refs`, common after `git gc`) move ref contents into a single file; per-branch files cease to exist.
- `fs.watch` on Linux uses inotify and silently misses events on some FS types and over network mounts.

A 2-second poll of `git rev-parse <branch>` is universally reliable, costs ~30 cheap subprocess calls per minute, and avoids the entire reliability matrix above. The simplicity-vs-latency tradeoff is favorable: 2 seconds is well below human perception for "did my commit register?" and far below the LLM call latency that dominates the actual narration timing.

### Scrutinize prompt as an addendum, not a separate prompt

The narrative engine (chapters, sections, callouts, missing array, verdict) is the same in both modes — what changes is the *framing*. Modeling that as a system-prompt addendum keeps:
- One JSON schema for both modes.
- One frontend rendering pipeline.
- One place to evolve narrative quality (changes to the base prompt benefit both modes; changes to the addendum only affect scrutinize).

The addendum explicitly asks for: *what's questionable, what's missing, what would a senior reviewer push back on*; prefers concern/warning callouts over nits; defaults verdict to "caution"; tells the model to be honest about what it can't verify from the diff alone.

### Synthetic PR metadata

The frontend was designed around `PRMetadata`. Rather than fork the components, watch mode constructs PR-shaped objects from local commit data — `number: 0` as a sentinel for "no PR yet", `state: 'open'`, `branch`/`base` from the branch and base ref, `additions`/`deletions`/`changedFiles` from `git diff --numstat`. The UI components don't have to know they're showing a watch-mode artifact; they just render a PR-shaped object the same way they always do.

The only frontend change is a `mode === 'watch'` branch in `App.tsx` that swaps `PRHeader` (PR-specific chrome: GitHub link, checks, reviews, submit-review button) for `WatchHeader` + `CommitTimeline`.

---

## Risks and what to watch for in real use

Things that are more likely to bite than the obvious bugs:

1. **Trust amplification.** The whole risk this PR addresses is "you don't scrutinize your agent's code carefully enough." The risk this PR *introduces* is "the narrator describes the code so well that you trust it more, not less." If the scrutinize prompt produces compelling but vague pushback, the user may nod along to the *narration* the way they were nodding along to the code. Watch for: do you act on the missing-items list? Do callouts make you change anything? If the answer is "rarely" after a few weeks, the prompt needs sharper teeth.

2. **Same-family blind spots.** If you let it default to `claude` and your agent is also Claude, you're checking Claude's work with Claude. Consider a docs nudge toward `--with=codex` or similar.

3. **Narrative cost on large branches.** A 50-commit feature is 50 narrations. Caching helps, but the first-time generation isn't free. If this becomes a pain point, the levers are: tier models (cheap/fast for incremental, expensive/good for unified), debounce harder (only narrate on push, not commit), or skip-narrate noisy commits (configurable patterns: "ignore commits matching ^fixup!", etc.).

4. **The feature hits its own ceiling.** If you find yourself wanting to talk back — "yes Dad, but this hunk is fine because..." — that's the signal that the feedback loop is actually needed. Note when and why you wanted that, and feed it into the eventual feedback-loop design conversation. The wishlist of "things I wanted to say to a commit's narrative" is the highest-value design input we could collect right now.

---

## Success looks like

- You finish a feature with the help of an agent and you can actually *describe* what it built — not just "it works", but the behavioral changes, the assumptions made, the moving parts. The narration filled in the gap between "I prompted" and "I understand."
- For each commit, Dad's narration surfaced at least one absence, callout, or "verify that…" note that you actually acted on.
- When you open the PR, your description is informed by Dad's unified view — you didn't have to write it from scratch, and the things you say in it match what's actually in the diff because you read the story before posting.
- Your teammates' reviews catch fewer things you should have caught yourself.
- You trust Dad more when it flags concerns than when it's quiet — i.e., it's calibrated, not just verbose.

## Failure looks like

- Narratives feel triumphant. You read them, nod, ship. Bugs make it through anyway.
- Cost runs up faster than expected and you stop running watch mode on long branches.
- You keep reaching for affordances that don't exist (comments, agent direction, etc.) and feel limited.
- Narrative drift across a long branch makes the unified view feel disconnected from the per-commit ones.

Each of those is actionable, and each tells us something specific about what to build next. The point of shipping the read-only half first is to *earn* that signal.
