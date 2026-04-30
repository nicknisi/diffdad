# Handoff: Diffappointment

> A per-PR code review tool that opens the diff as a story.

## Overview

Diffappointment is a per-PR code review tool. The maintainer of a PR runs a CLI on their machine that subscribes to GitHub webhooks, then opens a browser tab where the diff is reorganized as a **narrated story**: hunks are grouped into "chapters" (Setup → Core change → Wiring → Edges), each chapter has a 1-3 sentence narration explaining what's happening and why, and reviewers move through the change top-to-bottom instead of file-by-file.

Comments stream live from GitHub. Bot suggestions, human comments, commits, CI runs, title edits, and approvals all arrive over the webhook stream and appear in real time. Comments made in Diffappointment sync back to GitHub.

The product is **augmented, not replaced** — every Diffappointment comment is a real GitHub comment, every reviewed marker becomes a GitHub `Reviewed` state, and the PR remains canonical on GitHub.

The sample PR used throughout the design is `workos/workos#1847 — Support OIDC discovery for Microsoft Entra ID`, an authentic-looking SSO change that touches 7 files across 5 chapters with realistic risk distribution.

## About the Design Files

The files in `design_files/` are **design references created in HTML** — high-fidelity prototypes showing intended look and behavior, not production code to copy directly. The task is to **recreate these designs in the target codebase's existing environment** (likely a Next.js / React app that already wraps a WorkOS internal design system) using its established components, tokens, and patterns. If no environment exists yet, choose a modern React stack (Next.js + Radix Themes is a natural fit given the Radix tokens used here).

The HTML prototype runs entirely in-browser with mock data — there's no real backend, no real GitHub webhook, no real CLI. Synthetic events fire on a timer to simulate the live stream.

## Fidelity

**High-fidelity (hifi).** Pixel-level decisions — typography scale, spacing, color, motion durations, hover states, empty states, conflict states — are intentional and should be matched precisely. Recreate the UI pixel-perfectly using the codebase's existing libraries and patterns.

The design uses an internal WorkOS design system (referred to in the project as `workds`) built on Radix Themes color tokens and Untitled Sans / IBM Plex Mono / Source Serif 4. If your target codebase already has this design system, use it directly. If not, the design tokens section below has every value needed to rebuild it.

---

## Screens / Views

The product has **one main screen**: the Review screen. It is preceded by a one-time CLI splash and surfaces an Activity Drawer overlay on demand.

### 1. CLI Splash (one-time per session)

**Purpose:** First-run education. The user just opened the app from `bunx diffappointment <pr-number>` (or by clicking a stale link); show them the bunx command, explain the three-stage flow, and direct them into the demo PR.

**Layout:** Full-viewport overlay (rgba(0,0,0,0.4) backdrop) centered on a 520px-wide card with 28px padding and 14px border-radius.

**Components:**
- **Splash mark:** 56×56px purple square (`--purple-9 #6565EC`) with white "D", 12px radius, drop-shadow.
- **Title:** "Diffappointment" — 28px/32px, weight 700, letter-spacing -0.0125em.
- **Subtitle:** "A per-PR review tool that opens the diff as a story." — 14.5px, `--fg-2`.
- **CLI block:** Light gray panel (`--gray-2`), 12px radius, 14px padding. Shows `$ bunx diffappointment <pr-number>` in IBM Plex Mono with a copy button on the right. Below: a muted line `e.g. bunx diffappointment 1847 opens this PR with a live webhook stream from your local checkout.`
- **3-step flow:** Three rows, each with a numbered circle (`--gray-3`/`--fg-2`, 18×18, 999px radius) followed by the step text. Steps: (1) CLI subscribes to workos/workos webhooks. (2) Browser opens to a per-PR review with story-laid-out diff. (3) Comments, commits, CI all stream in live.
- **Continue button:** Primary purple, full-width, "Continue with demo PR →"
- **Foot note:** "No CLI? You're seeing a static demo with synthetic webhook events." — 11.5px, `--fg-3`.

**Behavior:** Dismiss on click → set `sessionStorage["diffapp.splashSeen"] = "1"`. Re-show only if user explicitly hits "Show splash again" in Tweaks.

### 2. App Bar (persistent across all states)

**Layout:** Horizontal flex, 48px height, 1px bottom border (`--gray-a4`), 16px horizontal padding.

**Left cluster:**
- **Brand mark:** 24×24 purple square + bold "Diffappointment" wordmark.
- **Vertical separator:** 1px × 20px, `--gray-a4`.
- **CLI framing:** A minimal monospace echo of how this session was launched: `$ bunx diffappointment 1847 → workos/workos#1847`. Hover reveals a "Copy command" button. The chapter count and last-updated time appear inline (`5 chapters · 2 days ago · updated 14 minutes ago`).

**Right cluster:**
- **Live pill** (see Live Indicator below).
- **Theme toggle** (sun/moon icon button, 30×30, 6px radius, inset border).
- **User avatar:** 28×28 circle, purple `#6565EC`, initials "YN" in white, weight 700, 11px.

### 3. Live Indicator (Live Pill)

**Purpose:** Show the connection to the local CLI and the recent event count. Click to open the Activity Drawer.

**Layout:** Capsule, 28px height, 12px horizontal padding, 999px radius.

**States:**
- **Live (default):** White-ish surface, inset 1px `--gray-a5`. Green 6×6 dot (`--green-9`) with a soft pulse animation. Text: `Live :4317 · 4 events · last 1s ago`. The port and event count come from the CLI session.
- **Reconnecting:** Amber dot, text reads `Reconnecting…`.
- **Disconnected:** Gray dot, text reads `CLI offline — reconnect`. Click triggers reconnect.

**Animation:** The dot has a 2s ease-in-out pulse (opacity 0.55 → 1.0). When a new event arrives, the entire pill flashes once — background fades from `--purple-3` back to default over 600ms.

### 4. PR Header

**Layout:** Full-width band below the app bar, 24px vertical / 32px horizontal padding, 1px bottom border.

**Row 1:**
- **Title:** `#1847 Support OIDC discovery for Microsoft Entra ID` — 22px/27px weight 700, letter-spacing -0.0125em. The `#1847` portion is `--fg-3` weight 400.
- **Right cluster:**
  - **View toggle (segmented):** Two buttons — "Story" (default active) and "Files" (classic GitHub-style flat diff). 26px height, 5px inner radius, the active one gets a white surface with inset 1px border and a tiny 1px shadow.
  - **Submit review button:** Surface style (`--color-panel-solid`, inset 1px `--gray-a6`).

**Row 2 (meta):** 13px row, 12px gap, `--fg-2`:
- Branch chip: monospace, `--gray-3` background, `fb/entra-oidc-discovery → main`.
- Author + dates: `Frances Barber opened 2 days ago · updated 14 minutes ago`.
- Stats: `+184 −47 across 7 files` (additions are `--green-11`, removals `--red-11`, both weight 500).
- Checks: `✓ 11 checks passing` in green.

### 5. Story View (default)

**Layout:** Two-column grid below PR header. Max-width 1280px centered. 280px sidebar (TOC) + 1fr main. Inner 32px horizontal padding, 24px gap.

#### Sidebar — Chapter TOC

**Sticky** at `top: 16px`. 13px sans, `--fg-2`.

- **Label:** `STORY` — 11px uppercase, weight 700, letter-spacing 0.06em, `--fg-3`, padded 0 10px 8px.
- **Items (one per chapter):** 8px vertical padding, 10px horizontal, 6px radius, 8px gap between rows.
  - **Number badge:** 18×18 circle, `--gray-3` bg, weight 700 monospace 10.5px. **When chapter is reviewed**, badge becomes `--green-9` background with white check icon (10×10).
  - **Title:** weight 500, 17px line-height.
  - **Meta:** 11.5px, `--fg-3`, 14px line-height. Examples: `2 hunks · risk low · has comments`, `1 hunk · risk medium · 0 comments`.
  - **Active:** background `--purple-a3`, color `--purple-11`, with a 6×6 purple dot pinned to the right edge.
  - **Hover:** background `--gray-a3`, color `--fg-1`.

#### Main — Suggested Start callout

A single purple-tinted info row sitting above Chapter 1.

- **Background:** `--purple-2` with inset 1px `--purple-a4`. 12px radius. 14px padding.
- **AI sparkle mark:** 28×28 rounded square (`--purple-9` bg, white sparkle icon).
- **Body:** "**Suggested place to start:** Chapter 4 — *Wire discovery into the connection setup flow*. It's the user-visible change and has the highest blast radius. Yusuf already flagged a debounce concern there." The italic chapter title uses Source Serif 4. The reasoning sentence references actual prior comments by name to feel grounded.
- **Action row:** Two ghost buttons with translucent white backgrounds and inset purple borders — "Jump to chapter 4" / "Start from chapter 1".

#### Main — Chapter card

Each chapter is a `<section>` with white surface (`--color-panel-solid`), 16px radius, 1px shadow, 24px padding, 16px vertical margin.

- **Chapter head row:**
  - **Number badge:** 24×24, `--gray-12` background, white text, 7px radius, monospace 12px weight 700.
  - **Title (h2):** 18px/24px weight 700, letter-spacing -0.01em.
  - **Risk pill (inline next to title):** 10.5px uppercase, weight 700, letter-spacing 0.06em, 999px radius, 2px/7px padding. **Low** = `--gray-3` / `--fg-2`. **Medium** = `--yellow-3` / `--yellow-11`. **High** = `--red-3` / `--red-11`.
  - **Reviewed toggle (right):** 12px sans weight 500, 4×8px padding, 6px radius. Default state shows "Mark reviewed". When toggled on, becomes a green chip with a check: `--green-3` background, `--green-11` text, "✓ Reviewed".
- **When chapter is marked reviewed:** the entire `.chapter` gets a subtle `opacity: 0.85` and the narration paragraph becomes muted.

- **Narration paragraph:** 14.5px / 22px weight 400. `--fg-1`. Indented `margin-left: 34px` (aligning past the number badge), `max-width: 64ch`, `text-wrap: pretty`. Inline accents:
  - `<em>` rendered in Source Serif 4 italic at 1.05em — used sparingly for terms-of-art ("*discovery*", "*lazy hydration*").
  - `<b>` weight 700 — for new identifiers and key concepts.
  - `<code>` 0.9em IBM Plex Mono on a `--gray-a3` chip with 4px radius.
- **Three densities:** terse (1 sentence), normal (2-3 sentences, default), verbose (1 short paragraph). Stored per-chapter; toggled via the narration anchor.

- **Narration anchor (below paragraph):** A flex row of small ghost buttons. 12px weight 500, `--fg-3`. Buttons: `Terse | Normal | Verbose` (segmented, the active one gets a white surface), then `↻ Re-narrate`, `✦ Ask AI`, `💬 Comment on chapter`. Indented 34px to align with the narration.

- **Hunks (each one a code block):** See Hunk component below.

### 6. Hunk component

The atomic diff unit. White surface, 1px `--gray-a5` border, 8px radius, 14px vertical margin.

- **Hunk head:** Light bar, `--gray-2` background, 1px bottom border. 8px / 12px padding. 12.5px IBM Plex Mono. Shows: file path (`--fg-1` weight 600) — range (`--fg-3`, e.g. `@@ -42,7 +42,18 @@`) — optional `NEW` badge (10px uppercase, weight 700, `--purple-9` background, white text, 4px radius).
- **Code lines:** Each line is a row with three columns:
  1. **Old line number** — 12px monospace, `--fg-3`, right-aligned, 48px wide.
  2. **New line number** — same, 48px wide.
  3. **Sign + content** — sign is `+`/`−`/` ` with 16px gutter; content is the code itself, syntax-highlighted (subtle: keywords `--purple-11`, strings `--green-11`, comments `--fg-3`).
  - **Added lines:** background `--green-2`, sign column `--green-3`.
  - **Removed lines:** background `--red-2`, sign column `--red-3`.
  - **Hover:** a `+` button appears in the gutter (24×24, `--purple-9`, 4px radius, white plus icon). Click → opens a comment composer pinned to that line.
- **When a comment exists on a line:** the line gets a 2px `--purple-9` left border. Below the line, an inline `<Thread>` renders.

#### Bot suggestion clustering

When `clusterBots` tweak is on (default), N consecutive bot comments on adjacent lines collapse into a single chip:

- **Chip:** 24px height capsule, purple-tinted (`--purple-2` background, `--purple-a5` inset border), with the AI sparkle icon followed by `3 bot suggestions` (or count).
- Click → expands into the individual bot Comment cards inline, each rendered as a normal Comment with a `bot` badge.

### 7. Comment component

A single comment in a thread. The visual contract:

- **Container:** 12px / 14px padding, 8px radius, white surface, 1px `--gray-a5` inset border.
- **Header row (avatar + author + meta):**
  - **Avatar:** 24×24 circle, deterministic color per author hash, white initials, weight 700, 11px.
  - **Author name:** weight 600, 13.5px.
  - **Timestamp:** `--fg-3`, 12px, `47 minutes ago` style.
  - **Sync status badge** (right-aligned): one of `from GitHub` (green pill: `--green-3` bg / `--green-11` fg with the GitHub mark icon), `synced` (gray check pill), `syncing…` (amber spinner pill), `draft` (`--gray-a3` outline pill, no fill).
  - **Bot badge:** purple sparkle pill `bot` for `*[bot]` accounts.
- **Body (markdown):** Rendered by the markdown renderer below.
- **Reactions row:** Optional. Inline pills, each `+1 3` style with hover-state outline.

### 8. Markdown rendering (in comments)

GitHub-flavored markdown subset, rendered inline in comment bodies. Implementation: `md.jsx`. Visual rules:

- **Paragraphs:** 13.5px / 19px, `--fg-1`, 8px bottom margin.
- **`**bold**`** → weight 700.
- **`*italic*`** → Source Serif 4 italic (font-em) at 1.02em.
- **`` `inline code` ``** → IBM Plex Mono 0.9em on `--gray-a3` chip, 4px radius, 1px/5px padding.
- **Code blocks** (fenced ```ts ```):
  - Background `--gray-2`, 1px `--gray-a5` border, 8px radius, 12px padding.
  - Lang label (top-right): 10.5px monospace, uppercase, `--fg-3`, on its own row, 8px bottom border separator.
  - Body: IBM Plex Mono 12.5px / 18px, scrollable horizontally with a thin `--gray-a3` 4px scrollbar.
  - Token coloring: keywords `--purple-11`, strings `--green-11`, numbers `--amber-11`, comments italic `--fg-3`.
- **Blockquotes** (`> text`) → 3px left border `--gray-a6`, 12px left padding, italic, `--fg-2`.
- **Lists** (`- item`, `1. item`) → 16px left padding, marker `--fg-3`, 4px between rows.
- **Task lists** (`- [ ]`, `- [x]`) → render as 14px native checkbox aligned to text baseline; checked uses `--purple-9`.
- **Links** (`[text](url)`) → `--fg-link` (`--purple-11`), no underline by default, underline on hover.
- **@mentions** (`@username`) → purple chip: `--purple-3` background, `--purple-11` text, 2px/6px padding, 4px radius. Use a regex pass: `/(^|\s)@([\w-]+)/g`.
- **Issue refs** (`workos/workos#1402`) → underlined link in `--fg-link`. Regex: `/[\w-]+\/[\w-]+#\d+/g`.
- **GitHub-style suggestion blocks:**
  - Fenced ```` ```suggestion ```` blocks render as a special card.
  - Header strip: 8px/12px padding, `--green-3` background, `--green-11` text weight 600, "Suggested change" label.
  - Body: the diff inside, monospace, with red `−` and green `+` lines.
  - Footer: a "Apply suggestion" primary button + "Add to a batch" ghost button.

### 9. Live stream — Activity Drawer

**Trigger:** Click the Live pill in the app bar.

**Layout:** Right-side drawer overlay, 380px wide, full-height, white surface with 1px left border, slides in from `translateX(100%)` over 240ms ease-out. Backdrop is `rgba(0,0,0,0.18)`.

**Header:** "Activity" 18px weight 700, with the Live status pill inline. Close X button.

**Subhead:** A "Replay last 3 events" ghost button — fires recent events again with new IDs (useful for demoing).

**Event log:** Reverse-chronological list. Each entry is a row, 8px / 12px padding:
- **Icon column** (24×24, `--gray-3` rounded): `✦` for bot comments, `💬` for human comments, `✓` for CI, the GitHub mark for commits, `⊙` for system messages.
- **Body:** weight 500 13px summary line + 12px `--fg-3` timestamp + a one-line excerpt of the event payload.
- **New entries:** flash with a 1.2s `--purple-2 → transparent` fade-in.

### 10. Conflict UX (live comment lands while user is composing)

When the user is typing in a thread's reply textarea and a new comment arrives in that same thread:

- The thread container gets a 2px `--amber-a5` outline with 2px offset.
- A **conflict banner** renders above the reply box:
  - Background `--amber-3`, 1px `--amber-a5` border, 6px radius, 8px/12px padding.
  - Refresh icon spins once (1.6s linear).
  - Text: `**N new comments** arrived while you were typing.` (12.5px sans, weight 500, `--amber-11`).
  - Right-aligned "Got it" button: `--amber-9` background, white text, 11.5px weight 600.
- Each newly-arrived comment gets a 1.2s flash: `--amber-2` background fading to transparent, with a 3px `--amber-9` left border that persists.
- Clicking "Got it" updates the baseline so the banner clears.

### 11. Submit Review bar (sticky bottom)

When the user has any pending drafts or hasn't yet submitted, a slim bar pins to the bottom of the viewport.

- **Layout:** 56px height, white surface, 1px top border, 8px shadow above. 32px horizontal padding. Sticky at `bottom: 0`.
- **Left:** A progress segment — `1 of 5 chapters reviewed · 2 pending drafts`. The number adapts as the user marks chapters reviewed. Below the text, a 4px progress bar fills `--purple-9` for the reviewed proportion.
- **Right:** A primary "Submit review" button.
- Click → opens the **Submit Review modal**.

### 12. Submit Review modal

Centered, 480px wide, 16px radius, 24px padding.

- **Title:** "Submit review" 20px weight 700.
- **Resolution radio group:** Three vertically-stacked options, each a `border: 1px solid --gray-a5` row that turns `--purple-a5` border + `--purple-2` background when selected:
  - `Comment` — Submit general feedback without explicit approval.
  - `Approve` (default for happy path) — Submit feedback approving these changes.
  - `Request changes` — Submit feedback that must be addressed before merging.
- **Summary textarea:** 14.5px sans, 100px min-height, full-width, 8px radius, 1px `--gray-a5` border. Placeholder: `Optional summary that will accompany your N inline comments…`.
- **Footer:** "Cancel" ghost + "Submit" primary (label adapts: "Approve PR" / "Request changes" / "Submit comment").
- **On submit:** modal closes, a toast appears bottom-right: `✓ Review submitted to GitHub` (green check, slides in 240ms, dismisses after 4s).

---

## Interactions & Behavior

### Live event stream

A `useLiveStream(enabled, speed)` hook drives the simulation:
- Maintains `pr`, `log`, `lastEventAt`, `status` state.
- Schedules a list of scripted events (`bot_comment`, `human_comment`, `commit`, `ci`, `title_edit`, `approval`) on `setTimeout` with `afterMs / speed` delays.
- `applyEvent(ev)` mutates `pr` (e.g. injects new comments into the right hunk), appends to `log`, updates `lastEventAt`, and pulses the Live pill.
- `replayLastN(n)` re-fires the last n events with regenerated IDs for demo replay.
- A speed knob (`0.5x / 1x / 2x`) lives in the Tweaks panel.

In production, this hook is replaced with a real WebSocket-or-SSE client that subscribes to the local CLI on `localhost:4317`.

### Reviewed-state machine (per chapter)

Each chapter is independently `reading | reviewing | reviewed | replied`:
- `reading` (default) — chapter is in viewport.
- `reviewing` — user has at least one open draft on the chapter.
- `replied` — user has at least one synced comment on the chapter.
- `reviewed` — user clicked "Mark reviewed".

The TOC reflects the current state (purple dot = active, green check = reviewed, comment dot = has-comments).

### Re-narrate

The "Re-narrate" button in the narration anchor cycles through three lenses (`security → performance → API consumer`). Triggers a 700ms loading state ("Re-narrating…"), then prepends a lens tag and a framing sentence to the existing narration. A "Restore default" link in a banner reverts.

In production, this should call a real LLM with the chapter's diff and the chosen lens as context.

### Markdown auto-detection in code

Chapter narrations and comment bodies recognize:
- `@username` → mention pill.
- `owner/repo#NNN` → issue link.
- `path/to/file.ts:N` → file/line link.
- Backtick code → inline code.

### Animations & transitions

- **Live pill flash:** 600ms `background-color` fade.
- **New comment arrival flash:** 1200ms `background-color` ease-out.
- **Drawer slide-in:** 240ms `transform: translateX` ease-out.
- **Spin:** 1600ms linear (used for the conflict-banner refresh icon and syncing badges).
- **Pulse (live dot):** 2000ms ease-in-out infinite alternate, opacity 0.55 ↔ 1.0.
- **Toast:** 240ms slide-up + fade-in, 4000ms hold, 200ms fade-out.

### Keyboard shortcuts (recommended for production)

- `j` / `k` — next / previous chapter (smooth-scroll, update active TOC item).
- `r` — toggle "Mark reviewed" on the current chapter.
- `c` — focus the comment composer for the currently-hovered code line.
- `?` — show shortcuts help overlay.
- `Enter` (in comment composer) — newline.
- `Cmd/Ctrl+Enter` — submit comment.

---

## State Management

For a production rewrite, the state can be split into:

```ts
type Reviewer = { id: string; name: string; avatar: string };

type ChapterState =
  | "reading"
  | "reviewing"   // has open drafts
  | "replied"     // has synced comments
  | "reviewed";   // explicitly marked

type Tweaks = {
  theme: "light" | "dark";
  storyDensity: "terse" | "normal" | "verbose";
  codeRatio: "code" | "balanced" | "prose";
  layout: "toc" | "linear";
  density: "comfortable" | "compact";
  collapseNarration: boolean;
  clusterBots: boolean;
  liveSpeed: 0.5 | 1 | 2;
  storyStructure: "chapters" | "linear" | "outline";
  visualStyle: "stripe" | "linear" | "github";
};

type ReviewState = {
  pr: PullRequest;
  liveStatus: "live" | "reconnecting" | "disconnected";
  log: LiveEvent[];
  reviewedMap: Record<ChapterId, boolean>;
  pendingDrafts: number;
  activeChapter: ChapterId;
  openLine: { hunkId: string; line: number } | null;
  tweaks: Tweaks;
};
```

Data fetching:
- Initial `pr` payload comes from the CLI's local server on session start.
- All subsequent state mutations come over the live stream.
- Optimistic write on comment submit, with `syncStatus: "syncing"` until the server confirms `synced`.

---

## Design Tokens

The design uses an internal WorkOS design system (referred to in the project as `workds`) built on Radix Themes. Full tokens are in `design_files/` referenced as `workds/colors_and_type.css` (not bundled — assume it lives in the target project's design system).

### Fonts

```
--font-sans: 'Untitled Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
--font-mono: 'IBM Plex Mono', 'Menlo', monospace;
--font-em:   'Source Serif 4', 'Source Serif Pro', Georgia, serif;
```

### Brand colors (light theme)

```
--purple-9:  #6565EC   /* WorkOS purple — primary accent, brand mark */
--purple-10: #5151CD   /* primary hover */
--purple-11: #5753C6   /* on-tint text */
--purple-12: #272962   /* high-contrast on tint */
--purple-2:  #f6f6ff   /* tint surface (suggested-start callout) */
--purple-3:  #ededfe   /* tint chip background (mention pill) */
--purple-a3: rgba(101, 101, 236, 0.10)
--purple-a4: rgba(101, 101, 236, 0.18)
--purple-a5: rgba(101, 101, 236, 0.30)
```

### Semantic foreground / background

```
--fg-1: var(--gray-12)   /* primary text */
--fg-2: var(--gray-11)   /* secondary, body meta */
--fg-3: var(--gray-10)   /* tertiary, muted labels */
--fg-4: var(--gray-9)    /* placeholder */
--fg-link: var(--purple-11)

--bg-1: var(--gray-1)             /* base page background */
--bg-2: var(--gray-2)             /* surrounding canvas */
--bg-panel: white                 /* card surface */
--color-panel-solid: white        /* opaque panel for floating elements */
```

### Status colors

```
--green-2:  #ebfaef     --green-3:  #d1f5da     --green-9:  #1a9b3c     --green-11: #1f7a32
--red-2:    #ffeff0     --red-3:    #ffd9dc     --red-9:    #d8364c     --red-11:   #b53247
--amber-2:  #fff7d6     --amber-3:  #ffeea8     --amber-9:  #ffba18     --amber-11: #885e0a
--yellow-3: #fff1a6     --yellow-11: #966800
```

### Spacing scale (4px-based)

```
2 | 4 | 6 | 8 | 10 | 12 | 14 | 16 | 20 | 24 | 28 | 32 | 40 | 48
```

Common patterns:
- Card padding: 24px
- Card radius: 16px
- Pill radius: 999px
- Element radius: 6px (small), 8px (medium), 12px (large), 14px (modal)
- Inter-card vertical margin: 16px
- Gutter between sidebar and main: 24px

### Type scale

```
H1 PR title        22px / 27px / weight 700 / -0.0125em
H2 Chapter title   18px / 24px / weight 700 / -0.01em
Body narration     14.5px / 22px / weight 400
Body meta          13px / weight 400
UI label           12px / weight 500
UI micro-label     11px uppercase / weight 700 / 0.06em
Code (inline)      0.9em IBM Plex Mono
Code (block)       12.5px / 18px IBM Plex Mono
```

### Shadows

```
--shadow-card:    0 1px 2px rgba(3,2,13,0.06), 0 3px 6px -1px rgba(3,2,13,0.10)
--shadow-elev-2:  0 4px 12px rgba(3,2,13,0.10), 0 12px 24px -4px rgba(3,2,13,0.12)
--shadow-button:  0 1px 2px rgba(3,2,13,0.08)
```

---

## Variations exposed via Tweaks

The Tweaks panel exposes design dimensions for the reviewer to dial in:

- **Story structure:** `chapters` (default — distinct cards per chapter), `linear` (chapters become section breaks in a continuous flow), `outline` (chapters collapsed by default; click to drill into one).
- **Narration density:** `terse | normal | verbose`.
- **Code / narration ratio:** `code` (collapse narration paragraph by default), `balanced`, `prose` (narration first, hunks below).
- **Visual style:** `stripe` (default — rounded cards, soft shadows, purple), `linear` (Linear.app-style — no shadows, hairline borders, 1px-bordered hunks, neutral-focused), `github` (more boxy — 6px radii, blue accent `hsl(215, 80%, 56%)`, classic file-diff treatment).
- **Layout:** `toc` (sidebar visible) vs `linear` (no sidebar, chapters flow full-width).
- **Density:** `comfortable | compact`.
- **Collapse narration by default:** boolean.
- **Cluster bot suggestions:** boolean.
- **Live replay speed:** `0.5x | 1x | 2x`.

---

## Assets

All assets used in the design are inline SVG icons defined in `design_files/icons.jsx`. There are no external images, no fonts beyond the WorkOS font stack, and no third-party dependencies (the prototype uses pinned React 18 + Babel via CDN; production should compile JSX ahead of time).

---

## Files

The HTML reference implementation is in `design_files/`:

| File | Role |
|------|------|
| `index.html` | App shell, scripts, splash, app bar, Tweaks panel mount, `TWEAK_DEFAULTS` JSON. |
| `Review.jsx` | Main Review screen — TOC, suggested-start, chapters, narration anchor, AiAsk, re-narrate, ClassicView, submit modal, submit bar. |
| `Diff.jsx` | Hunk, CodeLine, Thread (with conflict UX), Comment. |
| `data.jsx` | Sample PR (`workos/workos#1847`) — chapters, hunks, code lines with syntax tokens, comments with realistic markdown. |
| `narrations.jsx` | Per-chapter narrations at three densities (terse / normal / verbose). |
| `live.jsx` | `useLiveStream` hook + scripted events + LivePill + ActivityDrawer. |
| `md.jsx` | GitHub-flavored markdown renderer (paragraphs, headings, code blocks, suggestion blocks, mentions, issue refs, task lists). |
| `icons.jsx` | Inline-SVG icon library (sparkle, chat, check, refresh, send, chevron, files, github, story, sun, moon, …). |
| `tweaks-panel.jsx` | Generic Tweaks panel scaffold (host protocol, drag, controls). Replace with the target codebase's settings UI. |
| `app.css` | All styling. Roughly 1700 lines covering app bar, splash, review screen, chapters, hunks, comments, markdown, drawer, modal, conflict UX, re-narrate banner, and the three visual-style variations (`stripe / linear / github`). |

---

## Implementation notes for Claude Code

- The HTML reference is **a single-page in-browser React app via Babel CDN** with mock data. Production should be a normal compiled React app (Next.js fits well given the WorkOS context).
- The Tweaks panel is a **design-time mechanism** for exploring variations — strip it from production. Pick the canonical configuration (likely `chapters / normal / balanced / toc / comfortable / clusterBots:true / stripe`) as the only shipping behavior, OR keep a minimal user-facing Settings panel for the genuinely useful axes (story structure, density, narration density).
- The CLI integration (the bunx command, the `:4317` port, the webhook subscription) is **future product work** — the design assumes it exists. Implement the browser side against a stub WebSocket; the CLI is a separate workstream.
- The "Re-narrate", "Ask AI", and "Suggested place to start" features are **LLM-backed** in production. The prototype hard-codes responses. Wire them to your existing AI infrastructure with the chapter diff + chapter title + narration as context.
- Bot comment clustering is **a frontend concern** — the underlying GitHub data has individual comments; the UI groups them client-side when there are ≥2 from `*[bot]` accounts on the same hunk within N consecutive lines.
- All comments, reviewed states, and submissions are **bidirectional with GitHub**. No data is purely Diffappointment-local. Treat GitHub as the source of truth and the live stream as the synchronization channel.
