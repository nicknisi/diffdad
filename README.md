<p align="center">
  <img src="packages/web/public/diff-dad-mark.svg" width="120" height="120" alt="Diff Dad" />
</p>

<h1 align="center">Diff Dad</h1>

<p align="center">
  GitHub PRs as narrated stories. Your local branch as a live one.<br/>
  <code>dad 139</code> turns a PR diff into a semantic walkthrough with AI-generated chapters, inline comments, and live sync. <code>dad watch</code> does the same for the branch you're working on, before you ever open a PR.
</p>

## Install

### Homebrew

```sh
brew install nicknisi/diffdad/dad
```

Or, equivalently:

```sh
brew tap nicknisi/diffdad
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
dad watch [branch]           # Narrate your in-progress branch (no GitHub required)
dad config                   # Configure AI provider, GitHub token, display settings
dad cache clear              # Clear cached narratives
dad --version                # Print version
```

Flags (can go in any position):

```sh
--with=claude|pi             # Force a specific AI CLI
--base <ref>                 # Watch mode: override base ref (default: origin/HEAD)
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

The CLI fetches the PR diff (or local branch diff in watch mode), generates a semantic narrative, and opens a local web UI in your browser.

### Watch your branch

`dad watch` is the local-branch counterpart to `dad <pr>`. It's built for the awkward modern workflow where an agent produced a lot of the code and you need to catch up on what was built before peer review.

```sh
dad watch                    # narrate the current branch vs origin/HEAD (or main)
dad watch some-branch        # watch a different branch
dad watch --base develop     # override the base ref
```

When you run it, you immediately see a **branch skeleton** — no LLM wait — with totals, touched directories, file categorization (tests / config / schema / migration / docs / public-api / source), and the most-changed files. In the background, Dad generates a **whole-branch narrative** that explains what the branch *does* — the feature it now describes, not just the sequence of edits.

Click a commit chip in the timeline to drill into a single commit. New commit lands? The skeleton refreshes and the whole-branch story regenerates. Rebase or amend? Orphaned narratives drop out automatically.

Watch mode is read-only and offline — no GitHub API calls, no comments posted, nothing written back to the repo. Cached at `~/.cache/diffdad/watch/`, keyed by `(baseSha, headSha)` for the whole-branch view.

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

PR-mode narratives are cached at `~/.cache/diffdad/` keyed by `{owner}-{repo}-{number}-{sha}`. Watch-mode narratives live under `~/.cache/diffdad/watch/`, keyed by repo fingerprint plus `(baseSha, headSha)` for the whole-branch view and per-SHA for individual commits. Same SHA = instant reload. Use `--no-cache` to regenerate (PR mode), or `dad cache clear` to wipe everything.

## Features

### Semantic Chapters

The AI groups hunks across files by behavior, not by filename. Each chapter has a title, risk level (low/medium/high), and narrative prose explaining the change. Chapters can reference the same hunk when it's relevant to multiple behaviors.

### Inline Comments

Review comments from GitHub appear inline next to the relevant code lines. Comments you post from Diff Dad sync back to GitHub as real review comments. Bot comments (Greptile, CodeRabbit, etc.) are clustered into collapsible groups.

### Live Sync

An SSE connection polls GitHub every 10 seconds. New comments, CI status changes, and check runs appear in real time. Comments you post are broadcast instantly via the server — no waiting for the next poll.

In watch mode, SSE pushes branch updates instead — new commits, regenerated whole-branch narratives, freshly-narrated commits — driven by a 2-second poll of `git rev-parse <branch>` instead of the GitHub API.

### Branch Skeleton (Watch Mode)

Before any model call returns, watch mode renders a local skeleton: totals, by-category file counts (tests / config / schema / migration / docs / public-api / source), top touched directories, and most-changed files. It's the cheap-and-immediate context layer — useful while the LLM is still thinking, and a sanity check that you're looking at the right diff.

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
