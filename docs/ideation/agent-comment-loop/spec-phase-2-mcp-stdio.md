# Implementation Spec: `dad mcp` stdio proxy + per-repo discovery — Phase 2

**Contract**: ./contract.md (extends the agent-comment loop)
**Estimated Effort**: M

## Problem

The agent connects to the MCP server via an **ephemeral** HTTP URL (`http://localhost:<random>/mcp`), so the `claude mcp add` command changes every run. A fixed port would make registration one-time but allows only **one** `dad watch` at a time (port collision across repos).

## Goal

One-time, global registration that supports **multiple concurrent `dad watch` sessions**:

```
claude mcp add diffdad -- dad mcp          # registered once, ever
```

Each agent tool call is routed to the `dad watch` session for the repo it's invoked in. No fixed port; each `dad watch` keeps its own ephemeral port.

## Approach

Add a stdio `dad mcp` command that **proxies** to a running `dad watch`'s HTTP API, discovered per-repo via a session file. `dad watch` keeps serving `/mcp` over HTTP (unchanged) — `dad mcp` is additive. Single writer is preserved: `dad watch` still owns the store and the SSE broadcast, so the live loop is unchanged.

Key decisions (for review):

1. **Session key granularity: repo-level** (`<owner>-<repo>`), not repo+base. Discovery only needs repo identity from cwd; the common case is one watch per repo. Two watches on the same repo → last writer wins the session file (documented limitation).
2. **Proxy talks to dad watch over plain REST**, not a nested MCP client→server handshake. The MCP tool logic (deliver-on-list, reply, resolve, broadcast) is extracted into shared service functions called by BOTH the in-process MCP tools and new REST endpoints. `dad mcp`'s stdio tools call those REST endpoints. Avoids a double MCP initialize per call and keeps logic DRY.
3. **Keep the HTTP `/mcp` connect command** as a documented alternative for non-Claude/direct users.
4. **Lazy, per-call discovery**: `dad mcp` starts its stdio server immediately and resolves+validates the session on each tool call. So starting `dad watch` _after_ the agent connected still works, with no re-registration.

## File Changes

### New Files

| File Path                                                   | Purpose                                                                                                                                |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/cli/src/local/session.ts`                         | Read/write/remove the per-repo session discovery file; validate liveness.                                                              |
| `packages/cli/src/agent-comments/service.ts`                | Shared service fns: `listAndDeliver`, `addAgentReply`, `resolveAgentComment` (store mutation + broadcast), used by MCP tools and REST. |
| `packages/cli/src/mcp/stdio.ts`                             | The `dad mcp` stdio server: 3 tools that proxy to the discovered `dad watch` REST API.                                                 |
| `packages/cli/src/__tests__/session.test.ts`                | Session file round-trip, staleness, key derivation.                                                                                    |
| `packages/cli/src/__tests__/agent-comments-service.test.ts` | Shared service fns + REST endpoints (`app.request`).                                                                                   |

### Modified Files

| File Path                       | Changes                                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/cli/src/mcp/tools.ts` | Reimplement the 3 in-process tools on top of `agent-comments/service.ts` (no behavior change).                                                                     |
| `packages/cli/src/server.ts`    | Add REST endpoints `GET /api/agent-comments?deliver=true`, `POST /api/agent-comments/:id/reply`, `POST /api/agent-comments/:id/resolve` (call the shared service). |
| `packages/cli/src/cli.ts`       | `watchCommand`: write the session file on boot, remove on exit; print the `dad mcp` registration hint. Add `case 'mcp':` → `mcpCommand()`.                         |

## Implementation Details

### 1. Session discovery (`local/session.ts`)

```typescript
type Session = { port: number; pid: number; cwd: string; baseRef: string; startedAt: string };
// file: ~/.cache/diffdad/sessions/<owner>-<repo>.json  (sanitized key)

writeSession(key, Session): Promise<void>   // atomic: write temp + rename
readSession(key): Promise<Session | null>    // null if missing/corrupt
removeSession(key): Promise<void>
isAlive(s: Session): Promise<boolean>        // GET http://localhost:<port>/api/health (add a trivial health route) with a short timeout
```

**Feedback loop**: `session.test.ts` — write/read/remove round-trip + key sanitization; `isAlive` against a stub port (or skip the network bit in unit tests). Check: `bun test packages/cli/src/__tests__/session.test.ts`.

### 2. Shared service (`agent-comments/service.ts`)

Extract from the current MCP tools, verbatim logic:

```typescript
listAndDeliver(store, broadcast, filter): AgentComment[]     // flips open→delivered, broadcasts
addAgentReply(store, broadcast, id, body): AgentComment      // throws UnknownCommentError
resolveAgentComment(store, broadcast, id, note?): AgentComment
```

**Feedback loop**: `agent-comments-service.test.ts` + reuse existing mcp-tools test (now thinner). Check: `bun test ...service.test.ts`.

### 3. REST endpoints (`server.ts`)

`GET /api/agent-comments?deliver=true` → `listAndDeliver`; `POST /api/agent-comments/:id/reply {body}`; `POST /api/agent-comments/:id/resolve {note?}`. Unknown id → 404. Plus a trivial `GET /api/health` → `{ ok: true }` for liveness checks.

**Feedback loop**: `app.request()` tests. Check: `bun test ...agent-comments-service.test.ts`.

### 4. `dad mcp` stdio server (`mcp/stdio.ts` + cli dispatch)

Uses the SDK's `StdioServerTransport`. Registers `list_review_comments`, `reply_to_comment`, `resolve_comment` with the same schemas. Each handler:

1. Resolve `key` from cwd (`resolveLocalIdentity`).
2. `readSession(key)`; if missing or `!isAlive` → return a structured error: "No active `dad watch` for <owner>/<repo> — run `dad watch` in that repo."
3. Forward to the REST endpoint on `localhost:<port>`; return the response as the tool result.

**Feedback loop**: manual — `claude mcp add diffdad -- dad mcp`, run `dad watch` in two repos, confirm each agent routes correctly. (The proxy needs a live server; not unit-tested.)

### 5. `watchCommand` wiring (`cli.ts`)

On boot after `Bun.serve`: `await writeSession(key, { port: server.port, pid: process.pid, cwd, baseRef, startedAt })`. On the existing exit path (browser-close shutdown) and on SIGINT: `await removeSession(key)`. Print:

```
Connect your agent (one-time):  claude mcp add diffdad -- dad mcp
(or direct HTTP: claude mcp add --transport http diffdad http://localhost:<port>/mcp)
```

## Error Handling

| Scenario                            | Handling                                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| `dad mcp` outside a git repo        | Tool returns structured error; stderr hint.                                          |
| No `dad watch` running for the repo | Structured "no active session" error (not a crash).                                  |
| Stale session file (watch crashed)  | `isAlive` fails → treated as no session; stale file overwritten on next `dad watch`. |
| Two watches same repo               | Last writer wins the session file; documented.                                       |
| Session file write fails            | Log non-fatal; HTTP `/mcp` still works as fallback.                                  |

## Failure Modes

| Component                 | Failure                  | Trigger                           | Impact          | Mitigation                                          |
| ------------------------- | ------------------------ | --------------------------------- | --------------- | --------------------------------------------------- |
| Session discovery         | Routes to wrong/old port | `dad watch` restarted, stale file | Tool calls fail | Per-call `isAlive` check; re-read each call.        |
| stdio proxy               | Hang                     | dad watch unresponsive            | Agent waits     | Short fetch timeout on proxy calls.                 |
| Shared service extraction | Behavior drift           | Refactor changes tool semantics   | Loop breaks     | Existing mcp-tools tests must still pass unchanged. |

## Validation Commands

```bash
bun run lint && bun run typecheck && bun run build
bun test packages/cli/src/__tests__/   # incl. session + service tests; existing mcp-tools tests unchanged
```

## Open Items

- [ ] Confirm session key is repo-level (not repo+base).
- [ ] `dad mcp` proxy fetch timeout value (default 10s?).
