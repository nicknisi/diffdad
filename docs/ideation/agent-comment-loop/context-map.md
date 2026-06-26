# Context Map: agent-comment-loop

**Phase**: single phase (MVP)
**Gates**: 5/5 ready
**Verdict**: GO

## Key Patterns

- `packages/cli/src/cli.ts:99-129` — `inferRepoFromGit()`: `Bun.spawn(['git', ...], {stdout:'pipe', stderr:'pipe'})` + `await proc.exited` + `new Response(proc.stdout).text()`. Replicate for `diff-source.ts`/`identity.ts` (`spawnText` is to be written). SSH + HTTPS remote-URL regex parsing lives here too.
- `packages/cli/src/github/diff-parser.ts:6-30` — `parseDiff(raw)` returns `[]` for empty input (not an error). `diff-source.ts` must throw `CleanTreeError` itself on empty diff.
- `packages/cli/src/narrative/cache.ts` — cache dir `join(homedir(), '.cache', 'diffdad')`; positional `sha` used opaquely → rename to `contentKey` (mechanical). Store follows `mkdir(recursive)` + `writeFile(JSON.stringify())` write-through.
- `packages/cli/src/server.ts:350-578` — SSE handler returns raw `new Response(stream, {headers})`; the MCP spike imitates this (bridge `c.req.raw`). Poller body `372-539` is replaced in watch mode. Shutdown guard `549-566`. Register `/mcp` before static catch-all `664-673`.
- `packages/cli/src/__tests__/server-sse.test.ts:11-60` — `parseSseChunk` + `StreamReader.drain()`; copy for `agent-comments-sse.test.ts`.
- `packages/cli/src/__tests__/server.test.ts:67-114` — `createStubGithub` + `buildContext(overrides)`; pass `{ github: null }` for watch-mode tests after widening.
- `packages/cli/src/__tests__/narrative-cache.test.ts:30-52` — fixture-prefix (`__diffdad_test__`) + `afterEach` cleanup for fs tests.
- `packages/web/src/components/Comment.tsx:30-72` — `Provenance` union + `SourceBadge`, keyed off `id<0`/`id>0`; agent `source`/`status` must be additive. Bot badge at `:172-182` uses `var(--purple-3)/--purple-11)` — `AgentCommentBadge` follows this, not Tailwind classes.
- `packages/web/src/components/CommentThread.tsx:26-56` — `groupThreads()` `Map<number, PRComment[]>` (:27), `Set<number>` (:99) — widen to `string | number`.

## Dependencies

- `ctx.github` consumed at server.ts lines **157, 339, 345, 374, 392, 402, 406, 430, 607, 644** — all need null-guards. `ServerContext.github` → `GitHubClient | null`; `cli.ts:253` passes `github: null` for watch.
- `narrative/cache.ts` `sha` positional → `cli.ts:243-344`, `server.ts:435-516`. Rename to `contentKey` is type-transparent.
- `PRComment.id`/`inReplyToId` (web `state/types.ts:131-145`) consumed by: `Comment.tsx` (id heuristics, ReplyBox `inReplyToId: number` :74), `CommentThread.tsx` (`Map/Set<number>`), `Hunk.tsx` (`Map<id>` :577, clustering :318/:334/:394/:609-612, traversal :578-584), `StoryView.tsx` (`Map<id>` :124-160), `useLiveStream.ts:72`, `review-store.ts:375`.

## Conventions

- Files kebab-case; types PascalCase `type` aliases (not interface); functions camelCase. Tests `*.test.ts` under `packages/cli/src/__tests__/`.
- `import type` for type-only imports (enforced). ESM.
- Typed error classes for control flow (`CleanTreeError`, `UnknownCommentError`). Routes return `c.json({error}, status)`. Best-effort fs wrapped in try/catch with fallback.
- Add fields as optional (`?`) for back-compat.
- Vitest (`vitest run`), NOT `bun test`, despite CLAUDE.md. Follow the spec's `npx vitest run`.
- Server/CLI use `PRMetadata` (`github/types.ts`, `state: 'open'|'closed'|'merged'`); web uses `PRData`. `synth()` must satisfy `PRMetadata`.
- Theme colors via `style={{ background: 'var(--purple-3)', ... }}` Radix tokens, not Tailwind color classes.

## Risks

1. **Id-widening blast radius exceeds the spec's file list** — also `Hunk.tsx`, `StoryView.tsx`, `useLiveStream.ts:72`, `review-store.ts:375`. Loose `c.id === x` / `.has(c.id)` tolerate `string|number` at runtime; explicit `Map<number>`/`Set<number>` annotations will fail typecheck. `bun run typecheck` is the safety net.
2. **`ReplyBox` prop `inReplyToId: number` (Comment.tsx:74)** must widen too (agent ids are UUID strings).
3. **MCP transport mounting unproven** — step-1 spike is load-bearing; `Bun.serve` second-port fallback documented. Real `claude mcp add` round-trip gates tool-building.
4. **Watch-mode SSE replacement is invasive** — poller `372-539` interleaves GitHub polling with regen/broadcast; the regen block calls `ctx.github.getDiff` (:430). Branch cleanly on `github === null`; substitute `buildLocalReview()` while keeping cache/broadcast tail. Risk of regressing PR-mode poller.
5. **Lifecycle guard (skip-exit-while-unresolved)** is only reachable via real socket disconnect — `app.request()` can't simulate; relies on manual testing.
