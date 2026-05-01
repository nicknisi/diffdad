<p align="center">
  <img src="packages/web/public/diff-dad-mark.svg" width="120" height="120" alt="Diff Dad" />
</p>

<h1 align="center">Diff Dad</h1>

<p align="center">
  GitHub PRs as narrated stories.<br/>
  <code>dad 139</code> turns a file-by-file diff into a semantic walkthrough with AI-generated chapters, inline comments, and live sync.
</p>

## Install

### Homebrew

```sh
brew tap nicknisi/diffdad https://github.com/nicknisi/diffdad
brew install dad
```

### From source

```sh
git clone https://github.com/nicknisi/diffdad && cd diffdad
bun install && bun run build
bun link
```

Requires [Bun](https://bun.sh) when building from source. The Homebrew install is a standalone binary — no runtime needed.

## Usage

```sh
dad <pr>                     # Open a PR as a narrated story
dad review <pr>              # Same as above (explicit subcommand)
dad config                   # Configure AI provider, GitHub token, display settings
dad cache clear              # Clear cached narratives
dad --version                # Print version
```

Flags (can go in any position):

```sh
--with=claude|pi             # Force a specific AI CLI
--no-cache                   # Regenerate narrative even if cached
--no-open                    # Don't auto-open the browser
--port=3000                  # Use a specific port
```

PR argument formats:

```
https://github.com/owner/repo/pull/123
owner/repo#123
139                          # bare number — infers repo from git remote
```

The CLI fetches the PR diff, generates a semantic narrative, and opens a local web UI in your browser.

## How It Works

Instead of reviewing files one by one, Diff Dad groups code changes into **chapters** by semantic behavior. An AI reads the entire diff and produces a reading order — setup first, then core changes, then wiring, then edge cases — with prose explaining what each group does and why.

### AI Provider

By default, Diff Dad uses `claude -p` (the Claude Code CLI), which runs on your existing Claude subscription — no API key needed. If Claude Code isn't installed, it falls back to `pi`. You can force a specific CLI with the `--with` flag:

```sh
dad --with=claude owner/repo#123
dad --with=pi owner/repo#123
```

For API-based providers instead of local CLIs, run `dad config`:

- **Claude CLI** (default) — uses your Claude subscription
- **pi CLI** (fallback) — uses your pi subscription
- **Anthropic API** — requires `ANTHROPIC_API_KEY`
- **OpenAI** — requires OpenAI API key
- **Ollama** — local models, no key needed

When a provider is configured via `dad config`, it takes priority over CLI discovery. The `--with` flag always takes top priority.

### GitHub Token

Diff Dad needs a GitHub token to fetch PR data and post comments. It checks, in order:

1. `DIFFDAD_GITHUB_TOKEN` environment variable
2. `gh auth token` (GitHub CLI)
3. Token saved via `dad config`

### Caching

Narratives are cached at `~/.cache/diffdad/` keyed by `{owner}-{repo}-{number}-{sha}`. Same commit = instant reload. Use `--no-cache` to regenerate, or `dad cache clear` to wipe all cached narratives.

## Features

### Semantic Chapters

The AI groups hunks across files by behavior, not by filename. Each chapter has a title, risk level (low/medium/high), and narrative prose explaining the change. Chapters can reference the same hunk when it's relevant to multiple behaviors.

### Inline Comments

Review comments from GitHub appear inline next to the relevant code lines. Comments you post from Diff Dad sync back to GitHub as real review comments. Bot comments (Greptile, CodeRabbit, etc.) are clustered into collapsible groups.

### Live Sync

An SSE connection polls GitHub every 10 seconds. New comments, CI status changes, and check runs appear in real time. Comments you post are broadcast instantly via the server — no waiting for the next poll.

### Story Controls

- **Density** — toggle narration between terse (1 sentence), normal, and verbose per chapter
- **Re-narrate** — rewrite a chapter's narration through a different lens (security, performance, API consumer)
- **Ask AI** — ask a question about a specific chapter's code changes
- **Mark reviewed** — track your progress through the PR, persisted across page reloads

### Review Submission

Submit reviews directly from the UI — Comment, Approve, or Request Changes. Inline comments are posted to GitHub along with your summary.

### Keyboard Shortcuts

| Key       | Action                                |
| --------- | ------------------------------------- |
| `j` / `k` | Next / previous chapter               |
| `r`       | Toggle reviewed on current chapter    |
| `c`       | Open comment composer on hovered line |
| `?`       | Show shortcuts help                   |
| `Esc`     | Close open panels                     |

### Display Options

Configurable via `dad config`:

- **Story structure** — chapters (cards), linear (continuous flow), outline (collapsed)
- **Layout** — TOC sidebar or full-width linear
- **Density** — comfortable or compact
- **Narration density** — terse, normal, or verbose default

## Architecture

Monorepo with two packages:

```
packages/cli/    Bun CLI + Hono server
packages/web/    React + Vite frontend
```

The CLI fetches the PR, generates the narrative, starts a local Hono server, and opens the browser. The frontend is a static Vite build served by the Hono server. All GitHub API calls go through the CLI server — the frontend never talks to GitHub directly.

### Tech Stack

- **Runtime:** Bun
- **Server:** Hono
- **Frontend:** React 19, Vite, Zustand, Tailwind CSS v4
- **AI:** Vercel AI SDK (multi-provider) or Claude CLI
- **Syntax highlighting:** Shiki (github-light/dark themes)
- **Markdown:** Custom renderer with DOMPurify sanitization

## Development

```sh
bun install
bun run dev              # Start Vite dev server (frontend only)
bun run build            # Build frontend
bun run build:bin        # Build standalone binary
bun run test             # Run tests
```

To test end-to-end, build the frontend first, then run the CLI:

```sh
bun run build
cd packages/cli && bun run src/cli.ts review owner/repo#123
```

## License

MIT
