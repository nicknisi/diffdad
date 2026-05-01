# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Diff Dad is a CLI tool that turns GitHub PRs into narrated stories. `dad <pr>` fetches a PR diff, sends it to an LLM to generate semantic chapters, then serves a React UI in the browser. Comments sync bidirectionally with GitHub.

## Commands

```sh
bun install              # install dependencies
bun run build            # build web frontend (required before running CLI)
bun run build:bin        # build standalone binary
bun run dev              # vite dev server (frontend only)
bun run test             # run CLI tests
bun run lint             # oxlint
bun run format           # oxfmt
bun run release          # bump version, tag, push (triggers CI release)
```

Run the CLI locally after building:

```sh
bun packages/cli/src/cli.ts review owner/repo#123
```

Run a single test:

```sh
bun test packages/cli/src/__tests__/diff-parser.test.ts
```

## Architecture

Bun workspaces monorepo with two packages:

**`packages/cli`** — Bun CLI + Hono server. Entry point is `src/cli.ts`. The CLI fetches PR data from GitHub, generates a narrative via LLM, starts a local HTTP server, and opens the browser. All GitHub API calls are proxied through this server — the frontend never talks to GitHub directly.

**`packages/web`** — React 19 + Vite frontend. Static build served by the Hono server from `packages/web/dist`. State managed by Zustand in `src/state/review-store.ts`.

### Data Flow

1. CLI fetches PR metadata, diff, comments, checks, reviews from GitHub REST API (`src/github/client.ts`)
2. Diff is parsed into `DiffFile[]` by a custom unified diff parser (`src/github/diff-parser.ts`)
3. Diff + PR metadata are sent to the LLM via `src/narrative/engine.ts` which returns a `NarrativeResponse` (chapters with interleaved narrative and diff sections)
4. Narrative is cached at `~/.cache/diffdad/` keyed by `{owner}-{repo}-{number}-{sha}.json`
5. Hono server (`src/server.ts`) serves the narrative + PR data at `/api/narrative`, handles comment posting at `/api/comments`, and runs SSE at `/api/events` for live updates
6. Frontend loads data via `useNarrative` hook, connects to SSE via `useLiveStream` hook

### AI Provider

Default: shells out to `claude -p` (Claude Code CLI, uses existing subscription). Falls back to Vercel AI SDK providers (Anthropic/OpenAI/Ollama) when configured via `dad config`. The `callAi()` function in `src/narrative/engine.ts` is the unified entry point — both narrative generation and in-app AI features (ask, renarrate) go through it.

### Key Concepts

- **hunkIndex** — 0-based index into a file's hunks array (per-file, not global). The LLM prompt labels each hunk with `[hunkIndex=N]` to prevent miscounting. The `findHunk()` function in `Chapter.tsx` resolves narrative section references to actual diff data.
- **normalizePath()** — strips `a/`/`b/` prefixes and leading slashes. Must be used consistently when comparing file paths between GitHub comments, diff parser output, and LLM narrative sections.
- **OrphanedInlineComments** — catches inline comments on hunks the LLM didn't include in the narrative, renders them in a separate section so they're never invisible.

## Code Style

- Formatter: oxfmt (config in `.oxfmtrc.json`) — single quotes, trailing commas, 120 print width
- Linter: oxlint (config in `.oxlintrc.json`)
- CSS: Tailwind v4 with CSS custom properties for colors (Radix-style scale tokens in `src/index.css`). Dark mode via `@variant dark` class-based toggle, NOT media queries.
- Use `style={{ }}` with CSS custom properties (`var(--gray-3)`) for colors that need to work in both themes. Tailwind color classes like `text-gray-500` don't respect the theme.

## Common Pitfalls

- The web frontend must be built (`bun run build`) before running the CLI — the server serves static files from `packages/web/dist`.
- The compiled binary looks for web assets in multiple fallback paths (see `server.ts`). When running from the project root, it finds `packages/web/dist`.
- GitHub review comments use `line` for the new-side line number and `original_line` as fallback for outdated comments. The client maps `c.line ?? c.original_line ?? undefined`.
- The `mapCommentsToChapters()` function on the server adds `chapterIndices` to comments, but the frontend type doesn't declare these fields — they're present at runtime but invisible to TypeScript.
