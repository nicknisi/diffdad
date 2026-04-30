# Diff Dad — Design Spec

> "Measure twice, merge once."

## Overview

Diff Dad is a local CLI tool that opens GitHub PRs as narrated stories. Instead of reviewing file-by-file, the AI groups diff hunks by semantic behavior into "chapters," writes narrative prose explaining what's happening and why, and presents it in a browser-based GUI where reviewers read top-to-bottom like a story.

Comments made in Diff Dad sync bidirectionally with GitHub. Every comment is a real GitHub comment. The PR remains canonical on GitHub — Diff Dad is augmented, not replaced.

## Branding

- **Product name:** Diff Dad
- **Domain:** diff.dad
- **npm package:** `@diffdad/cli`
- **CLI command:** `dad`
- **Tagline:** "Measure twice, merge once."
- **Alt tagline:** "I'm not mad, just diff-appointed."
- **Value prop:** "diff.dad keeps PRs on the happy path with simple, semantic reviews that cut through noise."

## Architecture

### Single-process CLI

```
dad review owner/repo#1847
  ├── Resolve GitHub token (env var → gh auth token → config file)
  ├── Resolve AI provider + key from ~/.config/diffdad/config.json
  ├── Fetch PR diff + metadata + existing comments (GitHub API)
  ├── Send diff to LLM → receive semantic grouping + narrative (structured JSON)
  ├── Boot local Hono server on random available port
  │   ├── Serve pre-built React app at /
  │   ├── Narrative JSON at /api/narrative
  │   ├── Comment CRUD proxied at /api/comments/*
  │   └── GitHub token never leaves the local machine
  └── Open browser
```

### Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | Bun | Fast startup, native TS, ships as npm package |
| CLI framework | Minimal (Bun.argv or commander) | Few commands, low complexity |
| Server | Hono | Lightweight, runs on Bun natively |
| Frontend | React + Vite | Component model for comments, syntax highlighting, interactive narrative |
| AI | Vercel AI SDK (provider-agnostic) | User picks Claude, OpenAI, Ollama, or custom |
| Syntax highlighting | Shiki | VS Code-quality highlighting, every language |
| Styling | Tailwind | Dark theme default, light toggle |
| Design system | WorkOS design system (workds) on Radix Themes tokens | See design_files/ for reference |

### Input Source

GitHub PRs only (v1). Auth resolution in priority order:
1. `DIFFDAD_GITHUB_TOKEN` env var
2. `gh auth token` (GitHub CLI)
3. Prompt on first run, saved to `~/.config/diffdad/config.json`

### AI Provider Config

```bash
dad config
# → Pick provider: Claude / OpenAI / Ollama / custom
# → Enter API key
# Saved to ~/.config/diffdad/config.json
```

On-demand generation: fetch diff → call LLM → render. No backend infra, no webhooks for v1.

## Semantic Narrative Engine

### Input to the LLM

- Full unified diff
- PR title, description, labels
- File tree of the repo (paths only, for context)

### Output (structured JSON)

```typescript
type NarrativeResponse = {
  title: string;
  chapters: Chapter[];
  suggestedStart?: { chapter: number; reason: string };
}

type Chapter = {
  title: string;
  summary: string;
  risk: "low" | "medium" | "high";
  sections: Section[];
}

type Section =
  | { type: "narrative"; content: string }
  | { type: "diff"; file: string; startLine: number; endLine: number; hunks: DiffHunk[] }

type DiffHunk = {
  header: string;
  lines: DiffLine[];
}

type DiffLine = {
  type: "add" | "remove" | "context";
  content: string;
  lineNumber: { old?: number; new?: number };
}
```

### Grouping Rules

- The LLM groups hunks by semantic intent, not file boundaries
- A chapter like "Add rate limiting" may pull hunks from multiple files
- Chapters are ordered as a logical reading sequence (setup → core logic → wiring → tests)
- **Hunks can appear in multiple chapters** when they're relevant to more than one story. A cross-reference indicator ("also in Chapter N") shows when a hunk appears elsewhere.
- Narrative blocks explain the *intent*, referencing the code that follows

### Token Management

For large PRs exceeding context:
1. Pass 1: Summarize each file's changes independently
2. Pass 2: Group summaries into chapters, request relevant hunks per chapter

### Prompt Strategy

Single call with structured output. System prompt instructs the model to:
1. Identify distinct behavioral changes in the diff
2. Group hunks by behavior, not by file
3. Order chapters as a logical reading sequence
4. Write narrative blocks explaining intent
5. Assess risk per chapter (low/medium/high)
6. Suggest where to start reviewing and why

## GUI

### Form Factor

Local web app served by the CLI. `dad review <url>` boots a Hono server and opens the browser. No hosting, no deployment. Ships as an npm package.

### Layout: Chapter Sidebar + Detail Pane

Two-column grid. 280px sidebar (TOC) + 1fr main. Max-width 1280px centered.

See `README.md` sections 2-12 and `design_files/` for pixel-level component specs including:
- App Bar (persistent, 48px, brand mark + CLI framing + live pill + theme toggle)
- PR Header (title, branch chip, author, stats, view toggle Story/Files)
- Chapter TOC sidebar (sticky, reviewed state badges, active indicator)
- Suggested Start callout (AI recommends where to begin)
- Chapter cards (number badge, title, risk pill, reviewed toggle, narration, hunks)
- Hunk component (file path, line numbers, syntax highlighting, hover-to-comment)
- Comment threads (avatar, author, timestamp, sync status badge, markdown body)
- Activity Drawer (live event log, triggered from Live pill)
- Submit Review modal (Approve / Request Changes / Comment)
- Submit Review bar (sticky bottom, progress + pending drafts)

### Narration Controls

Per-chapter narration anchor with:
- **Density toggle:** Terse (1 sentence) / Normal (2-3 sentences) / Verbose (short paragraph)
- **Re-narrate:** Cycle through lenses (security / performance / API consumer)
- **Ask AI:** Free-form question about the chapter's changes
- **Comment on chapter:** Opens comment form on the narrative block

### Tweaks Panel (Design-time, strip or simplify for production)

- Story structure: chapters / linear / outline
- Narration density: terse / normal / verbose
- Code/narration ratio: code / balanced / prose
- Visual style: stripe / linear / github
- Layout: toc / linear
- Density: comfortable / compact
- Cluster bot suggestions: boolean
- Live replay speed: 0.5x / 1x / 2x

## Comment Sync System

### Mapping Rules

| Comment placed on... | Becomes on GitHub... |
|---|---|
| A diff line | Inline review comment on that exact file + line |
| A narrative block | PR comment prefixed with `[diff.dad: Chapter N]` + quote of narrative |
| A reply to either | Reply on the same thread |

### GitHub → Diff Dad

- Inline review comments: matched to hunks by file + line, rendered in the correct chapter(s)
- PR-level comments: shown in a "Discussion" section in the sidebar
- `[diff.dad]`-prefixed comments: parsed and placed back on the originating narrative block

### Sync Timing

- Initial load: fetch all comments with the diff
- While open: poll every 30s for new comments
- On submit: POST immediately, optimistic UI update
- Conflict UX: amber banner when new comments arrive while composing (see README.md section 10)

### Line Mapping

GitHub uses diff hunk offsets, not absolute line numbers. The server translates between the two when reading/writing comments.

### Review Submission

Batched draft flow: comments accumulate as drafts, submitted together via Submit Review modal with resolution (Comment / Approve / Request Changes).

## Microcopy

### Positioning

- Tagline: "Measure twice, merge once."
- Alt tagline: "I'm not mad, just diff-appointed."
- Value prop: "diff.dad keeps PRs on the happy path with simple, semantic reviews that cut through noise."

### UI Microcopy

| Context | Copy |
|---------|------|
| Empty state | "Go make a diff-erence." |
| Inline hint | "Use your comment sense." |
| Approval toast | "Proud of you, champ. Approved." |
| Warning | "Not on my branch." |
| Blocker (tests failing) | "Grounded until tests pass." |
| Nudge | "Measure twice, commit once." |

## Interactions & Behavior

### Keyboard Shortcuts

- `j` / `k` — next / previous chapter
- `r` — toggle "Mark reviewed" on current chapter
- `c` — focus comment composer for hovered code line
- `?` — show shortcuts overlay
- `Enter` — newline in composer
- `Cmd/Ctrl+Enter` — submit comment

### Chapter Review State Machine

Each chapter: `reading → reviewing → replied → reviewed`
- `reading` — in viewport
- `reviewing` — has open drafts
- `replied` — has synced comments
- `reviewed` — explicitly marked

### Animations

- Live pill flash: 600ms background fade
- New comment arrival: 1200ms ease-out flash
- Drawer slide-in: 240ms translateX ease-out
- Sync spinner: 1600ms linear
- Live dot pulse: 2000ms ease-in-out infinite, opacity 0.55 ↔ 1.0
- Toast: 240ms slide-up, 4000ms hold, 200ms fade-out

## Design Tokens

See `README.md` "Design Tokens" section for complete token reference including:
- Fonts: Untitled Sans / IBM Plex Mono / Source Serif 4
- Brand purple: `#6565EC`
- Full Radix Themes color scale
- Spacing scale (4px-based)
- Type scale
- Shadow system
- Border radius conventions

## Design Reference Files

The `design_files/` directory contains a high-fidelity HTML prototype:

| File | Role |
|------|------|
| `index.html` | App shell, splash, app bar, tweaks mount |
| `Review.jsx` | Main review screen — TOC, chapters, narration, submit flow |
| `Diff.jsx` | Hunk, CodeLine, Thread, Comment, conflict UX |
| `data.jsx` | Sample PR data (workos/workos#1847) |
| `narrations.jsx` | Per-chapter narrations at three densities |
| `live.jsx` | useLiveStream hook, LivePill, ActivityDrawer |
| `md.jsx` | GitHub-flavored markdown renderer |
| `icons.jsx` | Inline SVG icon library |
| `tweaks-panel.jsx` | Design-time tweaks panel |
| `app.css` | All styling (~1700 lines) |

These are design references, not production code. The task is to recreate these in a proper React + Vite app using the established design system.

## Future Work (not v1)

- Local `git diff` support (no PR, no comment sync)
- GitLab / other providers
- Webhook-based live stream (real-time events via SSE/WebSocket from CLI)
- Pre-generated narratives with caching (keyed by commit SHA)
- Hosted version at diff.dad with OAuth
- VS Code extension
