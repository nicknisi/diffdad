# Diff Dad → Agent Loop — Design

**Date:** 2026-06-15
**Status:** Approved design, pre-implementation

## Problem

Diff Dad turns a GitHub PR into a narrated, browsable diff and syncs comments
bidirectionally with GitHub. During *development* — while an AI agent (typically
Claude Code in a sibling tmux pane) iterates on a branch — there is no way to
leave a comment that feeds back to the agent. Today every comment goes to
GitHub. We want a local review-while-the-agent-edits loop, inspired by
hunk.dev's watch mode, where comments are delivered to the agent and the loop
visibly closes (you can see what the agent did with each comment).

## Goals

- Review a **local working tree** diff (no PR required) and leave comments that
  reach the agent.
- In **PR mode**, optionally route a comment to the agent instead of GitHub.
- Comments reach the agent primarily via an **MCP server**, with a **manual
  clipboard/markdown fallback** for any agent.
- The loop is **visible**: each agent comment moves `open → delivered →
  addressed`, the agent can reply inline, and code changes under a comment are
  surfaced as "likely addressed".

## Non-Goals

- Not building rich, multi-state thread management (assignees, labels, etc.).
- Not auto-injecting comments into the agent (no `tmux send-keys`); the agent
  pulls via MCP or the user pastes.
- Not live-syncing promoted comments back from GitHub.

## Design Decisions (locked)

1. **Modes:** new local working-tree mode *and* existing PR mode both gain the
   send-to-agent capability.
2. **Delivery:** MCP server (primary) + manual clipboard/markdown (fallback).
3. **Lifecycle:** "B-lite" — three states (`open → delivered → addressed`),
   auto-delivery on fetch, one `resolve` callback, plus agent replies. Reuses
   the existing thread UI.
4. **Storage:** `~/.cache/diffdad/agent-comments/<key>.json` (cache dir, not
   in-tree).
5. **PR-mode routing:** hard either/or at compose time, plus an after-the-fact
   "Promote to GitHub" action on any agent comment.
6. **MCP scope for v1:** all three tools (`list_review_comments`,
   `reply_to_comment`, `resolve_comment`).

## Architecture

The feature reuses ~70% of the existing spine. `generateNarrative` already
accepts `DiffFile[]` + metadata, the SSE loop already broadcasts comment
updates, and `CommentThread.tsx` already renders threads. The genuinely new
code is three focused, independently testable units plus integration points.

### Unit A — Local diff source (`packages/cli/src/local/`)

- Entry: `dad watch [<base>]`, run inside a git repo, enters local watch mode.
  `<base>` is optional and sets the base ref explicitly.
- Default base ref: merge-base of `HEAD` with the repository's default branch.
- Produces `DiffFile[]` from `git diff <base>...working-tree` using the existing
  `diff-parser.ts` (the parser is source-agnostic — it parses unified diff text,
  regardless of whether it came from GitHub or `git`).
- Synthesizes a minimal `PRMetadata`-shaped object so the rest of the pipeline
  is unchanged: `title` = branch name, `body` = "", `labels` = [], `number` =
  a stable local sentinel, `headSha` = current `HEAD` sha.
- **Identity:** `owner`/`repo` derived from `git remote get-url origin` when a
  remote exists; otherwise fall back to the repo directory name for `repo` and
  `"local"` for `owner`. Used only for cache/store keying — never for network
  calls in local mode.
- **Change detection & cache keying:** because uncommitted edits do NOT change
  `HEAD` sha, local mode must NOT key on `headSha` alone. The narrative cache key
  and the watch-loop change signal use a **content hash of the current diff**
  (`sha256` of the unified diff text). Same diff → cache hit; any working-tree
  change → new key → regenerate.
- **What it does:** turn the local working tree into the same inputs the PR path
  produces. **How it's used:** `cli.ts` selects this source when no PR arg is
  given. **Depends on:** `git` CLI, `diff-parser.ts`.

### Unit B — Agent comment store (`packages/cli/src/agent-comments/`)

- Single source of truth for agent-bound comments, shared by the HTTP API (UI)
  and the MCP layer. In-memory with write-through persistence.
- **Persistence:** `~/.cache/diffdad/agent-comments/<key>.json`.
  - `key` = `${owner}-${repo}-local-${baseRef}` for local mode (stable across
    working-tree edits so a comment thread survives regeneration),
    `${owner}-${repo}-${number}` for PR mode. (Note: the *store* key is stable
    per base/PR; the *narrative cache* key uses the diff content hash — they are
    deliberately different so comments persist while narratives refresh.)
- **Comment shape:**
  ```ts
  type AgentComment = {
    id: string;                 // locally generated, stable
    path: string;
    line: number;
    side: 'LEFT' | 'RIGHT';
    body: string;
    status: 'open' | 'delivered' | 'addressed';
    author: 'user' | 'agent';
    replies: AgentReply[];      // { id, author, body, createdAt }
    hunkContext: string;        // the diff hunk text, captured at compose time
    chapterTitle?: string;      // narrative context for the agent
    createdAt: string;
    deliveredAt?: string;
    addressedAt?: string;
    addressedNote?: string;     // the agent's "what I did" note
    promotedTo?: number;        // GitHub comment id, if promoted
    codeChangedSinceDelivery?: boolean; // set by the watch loop
  };
  ```
- **API surface (functions):** `add`, `list(status?)`, `markDelivered(ids)`,
  `addReply(id, reply)`, `resolve(id, note?)`, `promote(id, githubId)`,
  `flagCodeChanged(ids)`, `load`, `save`.
- **What it does:** own the lifecycle and persistence of agent comments.
  **How it's used:** server HTTP handlers and MCP tools call it. **Depends on:**
  filesystem cache dir only.

### Unit C — MCP adapter (`packages/cli/src/mcp/`)

- Mounted on the existing Hono server at `/mcp` (HTTP transport).
- Connection command printed on startup in agent-enabled modes:
  `claude mcp add --transport http diffdad http://localhost:<port>/mcp`.
- **Tools:**
  - `list_review_comments(status?: 'open' | 'delivered' | 'all')` — returns
    comments with `body`, `path`, `line`, `hunkContext`, `chapterTitle`.
    Side effect: flips returned `open` comments to `delivered`. Default filter
    returns `open`.
  - `reply_to_comment(id, body)` — appends an agent reply; broadcasts via SSE so
    the UI updates live.
  - `resolve_comment(id, note?)` — marks `addressed` with an optional note;
    broadcasts via SSE.
- **What it does:** expose the store to the agent as MCP tools. **How it's
  used:** the agent (Claude Code) calls the tools. **Depends on:** Unit B, the
  server's `broadcast`.

### Integration points

- **`cli.ts`:** mode selection (PR vs local), prints the MCP connect command and
  the manual-fallback hint in agent-enabled modes.
- **`server.ts`:**
  - Mount `/mcp`.
  - New HTTP routes for the UI: `GET /api/agent-comments`,
    `POST /api/agent-comments` (compose), `POST /api/agent-comments/:id/promote`.
  - **Watch loop:** in local mode, replace GitHub SHA polling with a debounced
    working-tree watch that re-runs `git diff` and regenerates on change. When a
    file/line under a `delivered` comment changes, call
    `store.flagCodeChanged(...)` and broadcast.
  - **Lifecycle:** disable the 30s-after-browser-close auto-shutdown
    (`server.ts:549`) while any comment is unresolved or an MCP client is
    connected; resume normal shutdown once everything is resolved.
- **Web UI (`packages/web`):**
  - Comment composer gains a destination toggle (PR mode only): **GitHub** vs
    **Agent**. Local mode is always Agent.
  - Agent comments render in the existing `CommentThread.tsx`, badged 🤖 for
    agent authorship; agent replies render inline.
  - A `delivered` comment whose code changed shows a "code changed — likely
    addressed" affordance.
  - "Copy for agent" button: renders all open agent comments as a markdown block
    and copies to clipboard (manual fallback).
  - "Promote to GitHub" action on any agent comment: posts via existing
    `postComment` path, stamps `promotedTo`.
- **`dad comments` CLI subcommand:** prints open agent comments as markdown
  (manual fallback without the browser).

## Data Flow

### Local mode
1. `dad` (no PR arg) → Unit A builds `DiffFile[]` + synthetic metadata from the
   working tree.
2. Narrative generated as today; server starts; browser opens; MCP connect
   command + fallback hint printed.
3. User leaves a comment → `POST /api/agent-comments` → Unit B stores it `open`.
4. Agent calls `list_review_comments` → gets open comments → store flips them to
   `delivered`.
5. Agent edits files. Watch loop detects changes under delivered comments →
   flags `codeChangedSinceDelivery` → SSE → UI shows "likely addressed".
6. Agent calls `reply_to_comment` / `resolve_comment` → store updates → SSE →
   UI shows reply + `addressed`.

### PR mode
- As today, except the composer can target **Agent**, in which case the comment
  flows through Unit B instead of GitHub. GitHub-targeted comments are unchanged.
- "Promote to GitHub" on an agent comment posts it via the existing path.

## Error Handling

- **No git / not a repo (local mode):** clear error, exit non-zero.
- **Empty working-tree diff:** friendly message ("nothing to review — working
  tree is clean against `<base>`"), exit.
- **MCP tool referencing unknown comment id:** structured MCP error, no crash.
- **Store persistence failure:** log, keep in-memory copy authoritative for the
  session, surface a non-fatal warning.
- **Promote when not in PR mode / no GitHub client:** reject with a clear error.

## Testing

- **Unit A:** parse known `git diff` fixtures → expected `DiffFile[]`; base-ref
  resolution (merge-base, explicit, dirty tree); clean-tree case.
- **Unit B:** lifecycle transitions, persistence round-trip, reply/resolve/
  promote, `flagCodeChanged`. Pure functions over a temp cache dir.
- **Unit C:** each MCP tool — `list` flips `open → delivered`, `reply`/`resolve`
  mutate + (mock) broadcast, unknown-id errors.
- **Integration:** local-mode server boot serves `/api/agent-comments`; compose
  → list-via-MCP → reply → resolve round-trip updates both store and SSE.

## Open Questions

None blocking. (Storage location, routing, and MCP scope resolved during
brainstorming.)
