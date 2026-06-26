# Diff Dad Agent Comment Loop Contract

**Created**: 2026-06-15
**Readiness**: All 5 gates ready
**Status**: Approved
**Supersedes**: None
**Watch UX revised**: 2026-06-16 — see [watch-mode-design.md](./watch-mode-design.md). Watch mode is a purpose-built, diff-first verify-and-steer experience with **no narrative**; this supersedes the "existing narrative UI" framing in goal #1 and the in-scope bullet below.

## Problem Statement

Diff Dad turns a GitHub PR into a narrated, browsable diff and syncs comments bidirectionally with GitHub. But during local development — while an AI agent (typically Claude Code in a sibling tmux pane) iterates on a branch — there is no way to leave a review comment that feeds back to the agent. Every comment dad can post goes to GitHub.

The result is a broken inner loop: the developer reviews the agent's work in dad, then has to manually retype or copy-paste feedback into the agent's pane, with no visibility into whether the agent saw a comment or what it did about it. Inspired by hunk.dev's watch mode, we want a pre-PR `dad watch` loop where comments are delivered to the agent over MCP and the loop visibly closes (each comment shows delivered → addressed, with the agent's reply inline).

## Goals

1. Run `dad watch [base]` inside a git repo to verify-and-steer the local working-tree diff (against the merge-base with the default branch by default) in a purpose-built, diff-first UI — freshest-first ordering, the agent-comment loop, no narrative and no PR-review chrome — with no PR or GitHub token required.
2. Leave comments in watch mode that reach a connected agent via an MCP server mounted on dad's existing Hono server (3 tools: `list_review_comments`, `reply_to_comment`, `resolve_comment`).
3. Make the loop visible: every agent comment moves open → delivered (auto, on MCP fetch) → addressed, the agent can reply inline, and replies/status update live in the UI via the existing SSE channel.
4. Provide a manual fallback (clipboard button in the UI, `dad comments` markdown to stdout) so any agent that can't speak MCP can still consume the comments.
5. Persist agent comments to the cache dir so they survive dad restarts and agent context resets.

## Success Criteria

- [ ] Store enforces open → delivered → addressed and round-trips to disk — check: `vitest run packages/cli/src/__tests__/agent-comments.test.ts` — exits 0
- [ ] MCP tools: `list` flips open→delivered; reply/resolve mutate + broadcast; unknown ids error — check: `vitest run packages/cli/src/__tests__/mcp-tools.test.ts` — exits 0
- [ ] `GET`/`POST /api/agent-comments` work against an in-memory local-mode context — check: `vitest run packages/cli/src/__tests__/agent-comments-routes.test.ts` — exits 0
- [ ] `git diff` parses into `DiffFile[]` identically to the GitHub path; clean tree → friendly exit — check: `vitest run packages/cli/src/__tests__/local-diff.test.ts` — exits 0
- [ ] Clipboard/stdout fallback renders open comments as markdown; `dad watch`/`dad comments` resolve as subcommands — check: `vitest run packages/cli/src/__tests__/agent-comments-markdown.test.ts packages/cli/src/__tests__/cli-parse.test.ts` — exits 0
- [ ] Mutating an agent comment emits an `agent-comment` SSE event on `/api/events` — check: `vitest run packages/cli/src/__tests__/agent-comments-sse.test.ts` — exits 0
- [ ] Lint, type-check (both packages), and build pass — check: `bun run lint && bun run typecheck && bun run build` — all exit 0
- [ ] Judgment call: Claude Code connects via `claude mcp add --transport http diffdad http://localhost:<port>/mcp`, reads a comment via `list_review_comments`, resolves it, and it visibly closes (reply + addressed) in the dad UI.

## Scope Boundaries

### In Scope

- `dad watch [base]` local mode: `git diff` → existing diff-parser → synthesized `PRMetadata` → self-contained diff-first `WatchView` (freshest-first ordering, agent-comment loop, status rail; no narrative, no PR-review chrome).
- Agent comment store with open→delivered→addressed lifecycle, replies, write-through persistence to the cache dir.
- MCP server at `/mcp` (new `@modelcontextprotocol/sdk` dep) exposing all 3 tools, registered before the static catch-all, gated by a transport spike.
- Compose UI + inline agent replies/status, reusing `CommentThread`/`Comment` via an additive `source`/`status` field and a `string | number` id widening.
- Manual fallback: "Copy for agent" button + `dad comments` stdout, both rendering open comments as markdown.
- Make `ServerContext.github` nullable; guard the GitHub routes + recap path; replace the SSE poller with a debounced working-tree watcher in watch mode; keep the server alive while comments are unresolved.

### Out of Scope

- Auto-injecting comments into the agent via tmux send-keys — the agent pulls via MCP or the user pastes.
- Rich thread management (assignees, labels, multiple custom states) — B-lite lifecycle only.
- Any GitHub destination in watch mode (no toggle, no Promote-to-GitHub) — `dad watch` is pre-PR; there is no PR to route or promote to.

### Future Considerations

- PR-mode agent routing: a GitHub-vs-Agent destination toggle when reviewing an already-open PR (only useful once you want the loop on real PRs).
- "Promote to GitHub" on a resolved agent thread, reusing the existing `postComment` path (requires an actual PR).
- "Code changed → likely addressed" heuristic: the watch loop flags a delivered comment whose underlying lines changed even without `resolve_comment`.
- Per-agent targeting when more than one agent/pane is connected to the MCP server.
- Comment templates / canned review snippets.

## Execution Plan

### Dependency Graph

```
Phase 1: Local watch loop (MVP)   — single phase, no dependents
```

### Execution Steps

**Strategy**: Sequential (single phase)

Single MVP phase. Run:

```bash
/ideation:execute-spec docs/ideation/agent-comment-loop/spec.md
```

---

_This contract was generated from brain dump input and approved for execution._
