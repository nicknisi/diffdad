# Watch Mode Design — verify-and-steer, not reconstruct-and-narrate

**Date**: 2026-06-16
**Status**: Design (awaiting review)
**Supersedes assumption in**: `contract.md` goal #1 ("review the local working-tree diff … with the existing narrative UI")

## Why this doc exists

The approved contract assumed `dad watch` is `dad review` pointed at a local diff — same narrative UI, minus the GitHub destination. Building on that produced a watch mode that is *review-mode with GitHub bits subtracted*: Story/Recap tabs, a Submit-review bar, draft batching, approve/request-changes, a slow narrative generation — each one hidden or guarded reactively as it surfaced. That is why it kept feeling bolted on. The leak was never the guards; it was reusing review's shell.

This doc corrects the root assumption: **watch and review are opposite information problems and need different experiences.**

## The thesis (researched)

Grounded in Addy Osmani, *"Agentic Code Review"* and hunk.dev's watch mode.

- **`dad review`** is post-hoc. A finished change arrives, the agent's reasoning was *"discarded the moment the diff is produced,"* and the reviewer becomes *"the first human to ever lay eyes on this code"* — forced to **reconstruct intent that never got written down** (median review duration up 441% in the 2026 Faros data). In that world a narrative — chapters, reading plan, risk verdict — earns its cost: you are an outsider being onboarded to a frozen artifact.

- **`dad watch`** is the inverse. You are *"on the loop"* while the agent writes. You still **hold the intent — you gave it.** The "first human to lay eyes" problem does not exist, so reconstructing and narrating the change is redundant. The job is **verify-and-steer**, fast. Addy's prescription for this era is exactly the watch posture: *"human in the loop becomes human on the loop: sampling, spot-checking and auditing the system rather than reading every PR."*

**Consequence:** the watch "story" is a live readout, not a narrative. Three properties:

1. **Recency, not narrative** — the artifact is moving; the question is "what changed since I last looked."
2. **Triage, not narration** — when output outruns reading speed, the tool's job is to *point attention* at the risky parts, not retell the change.
3. **An intent loop, not a verdict** — no approve/request-changes; the spine is *your comment → agent addresses → closes.*

> `dad review` = compress an unknown. `dad watch` = sample a known. Opposite problems — they cannot share a spine.

## v1 scope (decided)

**Loop + minimal triage**, diff-first spine. Anchored line/range comments are the core feature, never optional, never a bare prompt.

## The experience

### 1. The core gesture (the whole point)

In the diff: click a line, or click-drag to select a **range** → an inline composer opens anchored to exactly those lines → write → send. The comment renders inline, pinned to the range (`auth.ts:13–18`), status **open**. It leaves the moment you send it — no drafts, no batching, no "add to review." Same muscle memory as a GitHub line comment; destination is your agent. Range anchoring (`startLine`/`startSide`) is already wired store → server → render; v1 makes it solid and tested.

### 2. The screen

- **Keep:** the live diff, inline comment threads, freshest-first file order, the loop rail (`● open  ◐ delivered  ✓ addressed`), and the header `dad watch · {repo} @{branch} · ● agent connected`.
- **Cut, by construction:** Story tab, Recap tab, Submit-review bar + dialog, approve/request-changes, "Add to review"/draft batching, the approval celebration, **and narrative generation entirely.** Watch never calls the LLM on the hot path, so the diff shows instantly.
- **Composer:** one action — *Send to agent.*

### 3. Freshest-first recency

Files order by working-tree mtime so the agent's most recent edits float to the top. On live reload the list re-sorts and marks files changed since the last look. This is the "what changed since I last looked" story with zero LLM.

### 4. Triage strip (minimal, new)

A risk-sorted "look here first" strip, the part that makes dad smarter than a diff viewer. It flags Addy's named agent-era failure modes against the working tree:

- test assertions rewritten → *read these first*
- a helper that already exists elsewhere (duplication)
- untrusted/user input flowing into an LLM prompt
- sprawling diff (size/spread)
- weakened CI (skipped lint, removed tests, lowered thresholds)

**Non-negotiable properties:** non-blocking (the diff renders immediately; flags arrive a beat later), debounced (recomputed only when the tree settles, only on changed files), cheap (a focused risk pass via `callAi()`, not a narrative). It degrades gracefully on a moving diff and never reintroduces the slow-narrative problem.

### 5. The loop (already built — keep)

Send → store (open) → the agent's `list_review_comments` flips it **delivered** → `reply_to_comment` / `resolve_comment` → SSE → inline reply + **addressed**, live. With no agent connected, comments queue as open and the rail says "waiting for agent"; the `dad comments` stdout / "Copy for agent" markdown fallback still carries the anchored range as `file:start–end` for agents that cannot speak MCP.

## Architecture

The fix for "bolting on" is structural: a single top-level branch where `mode === 'watch'` renders a self-contained **`WatchView`** that composes only watch chrome and reuses the *leaf* components (`Hunk`, `CommentThread`, `Comment`, diff-line rendering). It never imports `SubmitBar`, the Story tabs, or Recap, so they physically cannot leak. One component owns the experience.

| Concern | Status | Notes |
| --- | --- | --- |
| Local diff source (`git diff` → `DiffFile[]`) | built | `src/local/diff-source.ts` |
| Agent-comment store (open→delivered→addressed, replies, persistence) | built | `src/agent-comments/` |
| MCP tools (list/reply/resolve) | built | `src/mcp/` |
| `GET`/`POST /api/agent-comments` | built | server.ts |
| Inline range-anchored comments | built | needs tests |
| SSE live updates | built | `/api/events` |
| `WatchView` self-contained shell | **new** | replaces "review-minus-narrative" composition |
| Freshest-first ordering + "changed since last look" | **new** | mtime sort on reload |
| Triage pass + strip | **new** | debounced, non-blocking `callAi()` → flags |

**Triage flag shape:** `{ file, hunkIndex?, severity: 'info'|'warn'|'risk', kind, message }`. Produced off the hot path; rendered as a strip above/beside the diff; absent or stale flags never block the diff.

## What is removed from the watch path

Narrative engine call, Story/Recap tabs, `SubmitBar`/`SubmitDialog`, `drafts`/`pendingReviewComments` usage, approve/request-changes, `ApprovalCelebration`. These remain in `dad review`; watch simply does not mount them.

## Edge cases / error handling

- **Clean tree:** "no changes yet — watching…" (a state, not an error); updates live as the agent edits.
- **Commented line moves or disappears after reload:** the comment stays visible (existing orphaned-comments concept) so feedback is never lost.
- **No agent connected:** comments queue as open; fallback markdown available; rail communicates the wait.
- **Large diff:** renders without an LLM; triage flags the sprawl rather than the tool stalling.

## Testing

- Range round-trip: a comment with `startLine`/`startSide` persists and renders the range.
- Freshest-first ordering is deterministic given mtimes.
- Triage flags conform to the flag shape; a triage failure leaves the diff fully usable.
- `WatchView` mounts no review chrome (assert absence of Submit/Story/Recap).
- Loop lifecycle (existing store/MCP/route tests) still passes.

## Deferred (not v1)

- Agent activity / intent feed (the agent posting "what I changed and why" over MCP).
- Promote-to-GitHub on a resolved agent thread.
- MCP transport choice (http vs a `dad mcp` stdio command) — orthogonal; parked in its own spec.

## Reconciliation with existing artifacts

- `contract.md` goal #1: drop "with the existing narrative UI"; restate watch as a verify-and-steer experience with a triage assist.
- `spec.md`: rewrite implementation to this design (WatchView, freshest-first, triage) rather than the narrative-reuse approach.

---

_Sources: Addy Osmani, "Agentic Code Review" (addyosmani.com/blog/agentic-code-review/); hunk.dev watch mode (hunk.dev)._
