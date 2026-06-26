# Implementation Spec: Diff Dad Agent Comment Loop

**Contract**: ./contract.md
**Estimated Effort**: L

## Technical Approach

Add a pre-PR `dad watch [base]` mode to Diff Dad that reviews the local working-tree diff and lets the developer leave comments that feed back to an AI agent (Claude Code) over an MCP server, with the loop visibly closing (`open → delivered → addressed`, inline agent replies). The work reuses the existing narrative pipeline, SSE broadcast spine, and comment-thread UI; the genuinely new units are a **local diff source**, an **agent-comment store**, and an **MCP adapter**. A server refactor makes the GitHub client optional so watch mode runs with no PR and no token.

Three sequencing rules drive the build order. **First, a transport spike**: no MCP SDK exists in the repo and mounting an HTTP-transport MCP server inside Hono is unproven — prove the `@modelcontextprotocol/sdk` Streamable-HTTP transport bridges to Hono (`c.req.raw`) and answers `claude mcp add --transport http` before building the three tools. **Second, the store is the spine**: it is the single source of truth shared by the HTTP routes and the MCP tools, so build and test it before either consumer. **Third, the web reuse is not free**: `groupThreads()` is hard-typed to numeric ids and provenance is an `id<0` heuristic, so widen `PRComment.id`/`inReplyToId`/`groupThreads` to `string | number` and add an **additive** `source`/`status` field (coexisting with the draft heuristic) rather than rewriting it.

Key decisions: shell out to `git diff` with the existing `Bun.spawn` pattern (`inferRepoFromGit`, `cli.ts:99-129`); feed the raw output straight into `parseDiff()` (the parser is source-agnostic — verified against `git diff`'s standard unified format); key the narrative cache by a **diff content hash** in the opaque `sha` slot (never overload `ctx.headSha`, which is still used for real-SHA logic); key the comment store by base ref so threads survive regeneration.

## Feedback Strategy

**Inner-loop command**: `cd packages/cli && npx vitest run src/__tests__/agent-comments.test.ts`

**Playground**: Vitest for the store/MCP/route logic (the bulk of the work and where iteration happens); the Vite dev server (`bun run dev` + a `dad watch` CLI server on :4317) for the UI components.

**Why this approach**: Most changes are to store and MCP-tool logic, so a scoped, sub-second test runner is the tightest loop; the UI is a thin reuse of `CommentThread`, validated in the dev server.

## File Changes

### New Files

| File Path | Purpose |
| --------- | ------- |
| `packages/cli/src/local/diff-source.ts` | Shell out to `git diff`, resolve base ref, synthesize `PRMetadata`, return `DiffFile[]` + content hash. |
| `packages/cli/src/local/identity.ts` | Derive `owner`/`repo` from `git remote get-url origin` with directory-name fallback. |
| `packages/cli/src/agent-comments/store.ts` | The agent-comment store: lifecycle, replies, write-through persistence. |
| `packages/cli/src/agent-comments/types.ts` | `AgentComment` / `AgentReply` types. |
| `packages/cli/src/agent-comments/markdown.ts` | Render open agent comments as a markdown block (clipboard + `dad comments`). |
| `packages/cli/src/mcp/server.ts` | Mount the MCP Streamable-HTTP transport on the Hono app; wire the 3 tools to the store. |
| `packages/cli/src/mcp/tools.ts` | Tool definitions: `list_review_comments`, `reply_to_comment`, `resolve_comment`. |
| `packages/cli/src/__tests__/local-diff.test.ts` | Parse `git diff` fixtures; base-ref resolution; clean-tree case. |
| `packages/cli/src/__tests__/agent-comments.test.ts` | Store lifecycle + persistence round-trip. |
| `packages/cli/src/__tests__/mcp-tools.test.ts` | Each tool's behavior + unknown-id errors. |
| `packages/cli/src/__tests__/agent-comments-routes.test.ts` | `GET`/`POST /api/agent-comments` via in-memory `app.request()`. |
| `packages/cli/src/__tests__/agent-comments-sse.test.ts` | Mutation emits an `agent-comment` SSE event. |
| `packages/cli/src/__tests__/agent-comments-markdown.test.ts` | Markdown renderer output. |
| `packages/web/src/components/AgentCommentBadge.tsx` | 🤖 author/status badge for agent comments. |

### Modified Files

| File Path | Changes |
| --------- | ------- |
| `packages/cli/src/cli.ts` | Add `case 'watch':` → `watchCommand(base?)` and `case 'comments':` → print markdown; bootstrap a local `ServerContext` with `github: null`. |
| `packages/cli/src/server.ts` | Make `ctx.github` nullable; guard `/api/checks`, `/api/comments` GET+POST, `/api/review`, recap path; **replace** the SSE poller body with a debounced working-tree watcher in watch mode; mount `/mcp` **before** the static catch-all; add `GET`/`POST /api/agent-comments`; broadcast `agent-comment`; keep server alive while unresolved comments exist. |
| `packages/cli/src/narrative/cache.ts` | Rename the `sha` positional to a neutral `contentKey` (mechanical; opaque already) so passing a diff hash reads honestly. |
| `packages/web/src/state/types.ts` | Widen `PRComment.id`/`inReplyToId` to `string \| number`; add optional `source?: 'github' \| 'agent'` and `status?: 'open' \| 'delivered' \| 'addressed'`. |
| `packages/web/src/components/CommentThread.tsx` | Widen `groupThreads()` keys to `string \| number`; render agent threads with the new badge. |
| `packages/web/src/components/Comment.tsx` | Extend `Provenance`/`SourceBadge` to recognize an agent `source`; gate the Reply button on the widened id. |
| `packages/web/src/hooks/useComments.ts` | Add agent-comment fetch/post against `/api/agent-comments`; merge into the store. |

## Implementation Details

### 1. Transport spike (gate — do this first)

**Overview**: De-risk the single highest-uncertainty item before building tools. Add `@modelcontextprotocol/sdk`, stand up a minimal MCP server exposing one trivial `ping` tool over Streamable-HTTP, mount it at `/mcp` on a throwaway Hono app, and confirm a real client connects.

**Implementation steps**:
1. `cd packages/cli && bun add @modelcontextprotocol/sdk`.
2. Wire the SDK's Streamable-HTTP transport to a Hono route, bridging via `c.req.raw` (the request) and returning the transport's `Response` — follow the raw-`Response` pattern already used by `/api/events` (`server.ts:350-578`).
3. Register the route **before** `app.use('/*', serveStatic(...))` (`server.ts:664-673`).
4. Run `claude mcp add --transport http diffdad-spike http://localhost:<port>/mcp` and call `ping`.

**Feedback loop**:
- **Playground**: a scratch `mcp-spike.ts` that boots `Bun.serve` with the Hono app.
- **Experiment**: connect with `claude mcp add`, list tools, call `ping` → expect a pong.
- **Check command**: `claude mcp list` shows the server connected; the `ping` call returns.

**Exit criterion**: a real client completes the handshake and a tool call round-trips. Only then build the three real tools. If the SDK's HTTP transport cannot bridge to Hono, fall back to a standalone `Bun.serve` MCP listener on a second port (documented in Open Items) — but try the mounted path first.

### 2. Local diff source

**Pattern to follow**: `inferRepoFromGit()` (`cli.ts:99-129`) for `Bun.spawn(['git', ...])`; `parseDiff()` input format (`diff-parser.ts:3-4`).

**Overview**: Turn the working tree into the same `DiffFile[]` + metadata the PR path produces.

```typescript
type LocalReview = {
  files: DiffFile[];
  metadata: PRMetadata;   // title=branch, body='', labels=[], number=local sentinel, headSha=HEAD sha
  contentKey: string;     // sha256(diff text).slice(0,12) — the narrative cache key
  baseRef: string;        // resolved base (for the store key)
};

async function buildLocalReview(base?: string): Promise<LocalReview> {
  // 1. resolve base: base ?? `git merge-base HEAD <default-branch>`
  // 2. const diff = await spawnText(['git', 'diff', `${base}`]);  // working tree vs base
  // 3. if (!diff.trim()) throw new CleanTreeError(baseRef);
  // 4. return { files: parseDiff(diff), metadata: synth(), contentKey: hash(diff), baseRef };
}
```

**Key decisions**:
- `git diff <base>` (not `<base>...`) so uncommitted working-tree edits are included.
- Default base = `git merge-base HEAD <default-branch>`; resolve the default branch via `git symbolic-ref refs/remotes/origin/HEAD` with a `main`/`master` fallback.
- `contentKey` goes in the cache's `sha` slot; `baseRef` keys the store. Never overload `ctx.headSha`.

**Feedback loop**:
- **Playground**: `local-diff.test.ts` with committed `git diff` fixture strings.
- **Experiment**: parse a fixture with an added file, a deleted file, and a `\ No newline` marker; assert `DiffFile[]`. Separately assert the empty-diff string triggers `CleanTreeError`.
- **Check command**: `cd packages/cli && npx vitest run src/__tests__/local-diff.test.ts`.

### 3. Agent comment store

**Pattern to follow**: `narrative/cache.ts` for cache-dir paths; `narrative-cache.test.ts` for fixture-prefixed fs tests.

**Overview**: In-memory map with write-through JSON persistence; the single source of truth for both consumers.

```typescript
type AgentComment = {
  id: string; path: string; line: number; side: 'LEFT' | 'RIGHT';
  body: string; status: 'open' | 'delivered' | 'addressed'; author: 'user' | 'agent';
  replies: AgentReply[]; hunkContext: string; chapterTitle?: string;
  createdAt: string; deliveredAt?: string; addressedAt?: string; addressedNote?: string;
};

class AgentCommentStore {
  constructor(private key: string) {}        // file: ~/.cache/diffdad/agent-comments/<key>.json
  add(c: NewComment): AgentComment;          // status='open', author='user', generated id
  list(status?: Status | 'all'): AgentComment[];
  markDelivered(ids: string[]): void;        // open → delivered, stamp deliveredAt
  addReply(id: string, r: AgentReply): AgentComment;
  resolve(id: string, note?: string): AgentComment;  // → addressed
  // load()/save() — save is called write-through after every mutation
}
```

**Key decisions**:
- IDs are strings (`crypto.randomUUID()`); this is why the web id-model must widen.
- `save()` is best-effort: on failure, log and keep the in-memory copy authoritative (non-fatal).
- Unknown id in `addReply`/`resolve` throws a typed `UnknownCommentError` (the MCP layer maps it to a structured error).

**Feedback loop**:
- **Playground**: `agent-comments.test.ts`, fixture-prefixed key (`__diffdad_test__...`), cleaned in `afterEach` like `narrative-cache.test.ts:35-52`.
- **Experiment**: add 0/1/3 comments; assert `markDelivered` flips only `open`; resolve one; reload from disk and assert equality; call `resolve` on a bogus id → throws.
- **Check command**: `cd packages/cli && npx vitest run src/__tests__/agent-comments.test.ts`.

### 4. MCP tools

**Overview**: Three thin tools over the store; mutations call `broadcast('agent-comment', ...)`.

```typescript
// list_review_comments(status?: 'open'|'delivered'|'all')  default 'open'
//   → returns [{ id, path, line, hunkContext, chapterTitle, body }]; flips returned open → delivered
// reply_to_comment(id, body)    → store.addReply(id, {author:'agent', body}); broadcast
// resolve_comment(id, note?)    → store.resolve(id, note); broadcast
```

**Key decisions**:
- `list` is the only stateful read (the auto-delivery side effect); document it in the tool description so the agent knows fetching = acknowledging.
- Tools receive the store + `broadcast` by closure from `mcp/server.ts`.

**Feedback loop**:
- **Playground**: `mcp-tools.test.ts` calling the tool handlers directly with a stub `broadcast`.
- **Experiment**: seed 2 open + 1 delivered; `list('open')` returns 2 and flips them; `list('all')` returns 3; `reply`/`resolve` mutate + assert `broadcast` called with `agent-comment`; unknown id → structured error.
- **Check command**: `cd packages/cli && npx vitest run src/__tests__/mcp-tools.test.ts`.

### 5. Server integration

**Pattern to follow**: the SSE handler (`server.ts:350-578`); `app.request()` tests (`server.test.ts:118`); SSE tests (`server-sse.test.ts`).

**Key decisions**:
- `ServerContext.github: GitHubClient | null`. Each GitHub route guards `if (!ctx.github) return c.json({error:'unavailable in watch mode'}, 409)`.
- In watch mode the SSE `setInterval` body is **replaced** with a debounced (≈500ms) working-tree watcher: re-run `git diff`, and if `contentKey` changed, regenerate the narrative (reusing the existing regen/broadcast block) — it never calls `ctx.github`.
- Shutdown guard (`server.ts:549`): in watch mode, skip the exit timer while `store.list('all').some(c => c.status !== 'addressed')`.
- New routes: `GET /api/agent-comments` → `store.list()`; `POST /api/agent-comments` → `store.add(...)` + broadcast.

**Feedback loop**:
- **Playground**: `agent-comments-routes.test.ts` + `agent-comments-sse.test.ts` using a local-mode `ServerContext` (`github: null`).
- **Experiment**: `POST` a comment → 201; `GET` returns it; assert a `/api/events` stream yields an `agent-comment` event after a mutation (drive with `StreamReader` like `server-sse.test.ts:235`).
- **Check command**: `cd packages/cli && npx vitest run src/__tests__/agent-comments-routes.test.ts src/__tests__/agent-comments-sse.test.ts`.

### 6. Web UI

**Pattern to follow**: `CommentThread.tsx` / `Comment.tsx` / `useComments.ts`.

**Key decisions**:
- **Additive** `source`/`status` on `PRComment`; the `id<0` draft heuristic stays untouched.
- Widen `groupThreads()` `Map<number,...>` → `Map<string|number,...>`; audit every numeric-id comparison.
- Watch mode is always Agent-directed — no GitHub/Agent toggle (out of scope).
- "Copy for agent" button reuses `navigator.clipboard.writeText` (pattern: `Splash.tsx:37`) over the markdown renderer's output.

**Feedback loop**:
- **Playground**: `bun run dev` (Vite) + a `dad watch` server on :4317 (Vite proxies `/api`).
- **Experiment**: compose a comment → appears in thread badged 🤖-pending; simulate an agent reply via a `reply_to_comment` call → reply renders inline and status flips to addressed.
- **Check command**: visual in the dev server; `bun run typecheck` for the id-model widening.

### 7. `dad comments` + markdown

**Overview**: `dad comments` loads the store for the current repo/base and prints the markdown block to stdout (manual fallback without the browser).

**Feedback loop**:
- **Playground**: `agent-comments-markdown.test.ts`.
- **Experiment**: render 0 comments (friendly empty message), 1, and 3 with replies; assert headings, `file:line`, and bodies.
- **Check command**: `cd packages/cli && npx vitest run src/__tests__/agent-comments-markdown.test.ts`.

## API Design

### New Endpoints

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET`  | `/api/agent-comments` | List agent comments for the current session. |
| `POST` | `/api/agent-comments` | Compose a new agent comment (`{ body, path, line, side?, hunkContext, chapterTitle? }`). |
| `POST` | `/mcp` | MCP Streamable-HTTP transport endpoint (mounted before static catch-all). |

### Request/Response Examples

```jsonc
// POST /api/agent-comments  (request)
{ "body": "extract this guard clause", "path": "src/auth.ts", "line": 42, "side": "RIGHT", "hunkContext": "@@ ... @@" }
// response 201
{ "id": "a1b2", "status": "open", "author": "user", "replies": [], "createdAt": "..." , "path": "src/auth.ts", "line": 42 }
```

## Testing Requirements

### Unit Tests

| Test File | Coverage |
| --------- | -------- |
| `local-diff.test.ts` | `git diff` parse, base resolution, clean-tree error. |
| `agent-comments.test.ts` | Lifecycle transitions, persistence round-trip, unknown-id throw. |
| `mcp-tools.test.ts` | `list` auto-delivery, reply/resolve mutate+broadcast, unknown-id error. |
| `agent-comments-markdown.test.ts` | Markdown rendering (0/1/3 comments). |

### Integration Tests

| Test File | Coverage |
| --------- | -------- |
| `agent-comments-routes.test.ts` | `GET`/`POST /api/agent-comments` via `app.request()`. |
| `agent-comments-sse.test.ts` | Mutation emits `agent-comment` SSE event. |

### Manual Testing

- [ ] `dad watch` in a dirty repo opens the UI with the working-tree narrative.
- [ ] Compose a comment; confirm it appears badged 🤖-pending.
- [ ] `claude mcp add --transport http diffdad http://localhost:<port>/mcp`; agent calls `list_review_comments`, sees the comment, calls `resolve_comment`.
- [ ] Watch the comment close (reply + addressed) live in the UI.
- [ ] `dad comments` prints the markdown block; "Copy for agent" copies it.

## Error Handling

| Error Scenario | Handling Strategy |
| -------------- | ----------------- |
| Not a git repo / no `git` | Clear message, exit non-zero. |
| Clean working tree | Friendly "nothing to review against `<base>`", exit 0. |
| MCP tool unknown comment id | Structured MCP error, no crash. |
| Store `save()` fails | Log non-fatal warning; in-memory copy stays authoritative. |
| GitHub route hit in watch mode | `409` "unavailable in watch mode". |
| MCP transport can't mount on Hono | Fall back to standalone `Bun.serve` MCP listener (Open Items). |

## Failure Modes

| Component | Failure Mode | Trigger | Impact | Mitigation |
| --------- | ------------ | ------- | ------ | ---------- |
| Local diff source | Stale narrative served | `contentKey` collision (same diff text, different intent) | UI shows old narrative | Acceptable — identical diff ⇒ identical narrative by design. |
| Local diff source | Wrong base | Repo has no `origin/HEAD` and isn't `main`/`master` | Diff against wrong ref | Require explicit `dad watch <base>`; document fallback order. |
| Agent comment store | Lost comments | Concurrent writes from route + MCP tool in same tick | A mutation clobbers another | Single-process, synchronous mutations; `save()` after each — no real concurrency in Bun's loop. |
| Agent comment store | Orphaned thread | Diff regenerates and the commented hunk vanishes | Comment references gone code | Store keyed by base ref (survives regen); show as orphaned (reuse `OrphanedInlineComments` concept). |
| MCP adapter | Silent no-delivery | Agent never calls `list_review_comments` | Loop never closes | Manual fallback (`dad comments` / clipboard) always available. |
| Web id-model | Broken reply grouping | A numeric-id call site missed during widening | Replies detach from roots | Audit all `id`/`inReplyToId` comparisons; typecheck + thread test. |
| Server lifecycle | Server never exits | Unresolved comments linger forever | Stray process | Exit guard only blocks while browser closed AND unresolved; user can Ctrl-C. |

## Validation Commands

```bash
# Type checking (both packages)
bun run typecheck

# Linting
bun run lint

# Unit + integration tests
cd packages/cli && npx vitest run

# Build
bun run build
```

## Open Items

- [ ] **Transport spike outcome**: if the MCP SDK's HTTP transport cannot bridge to Hono, switch to a standalone `Bun.serve` MCP listener on a second port and update the connect command. Resolve during step 1 before building tools.
- [ ] Confirm the default-branch resolution order (`origin/HEAD` → `main` → `master`) covers the user's repos.

---

_This spec is ready for implementation. Follow the patterns and validate at each step._
