# Diff Dad Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local CLI tool (`dad`) that fetches a GitHub PR diff, sends it to an LLM for semantic grouping into narrated chapters, and serves a React-based review UI in the browser with bidirectional GitHub comment sync.

**Architecture:** Single-process Bun CLI. Hono server serves a pre-built React+Vite frontend and proxies GitHub API calls. The LLM call uses Vercel AI SDK for provider-agnostic support (Claude, OpenAI, Ollama). GitHub token stays server-side.

**Tech Stack:** Bun, Hono, React 19, Vite, Vercel AI SDK, Shiki, Tailwind CSS, Radix Themes tokens, Vitest, DOMPurify (for safe HTML rendering)

---

## Subsystem Decomposition

This plan is scoped as **Phase 1: CLI + Backend + Core UI**. It produces a working `dad review <url>` command that fetches a PR, narrates it, and serves the review UI with mock comment sync. Later phases (live webhook stream, full comment CRUD, tweaks panel, keyboard shortcuts) build on top.

Phase 1 covers:

1. Project scaffolding (monorepo structure, Bun + Vite + Tailwind)
2. CLI entry point with auth resolution
3. GitHub API client (fetch PR diff, metadata, comments)
4. Diff parser (unified diff → structured hunk data)
5. Narrative engine (LLM call → semantic chapters)
6. Hono server (serve frontend + API routes)
7. Core React UI (app shell, PR header, chapter TOC, chapter cards, hunk component, comment threads)
8. Comment sync (read existing GitHub comments, post new ones)

---

## File Structure

```
packages/
  cli/                          # The dad CLI + Hono server
    src/
      cli.ts                    # Entry point: arg parsing, auth, orchestration
      config.ts                 # Read/write ~/.config/diffdad/config.json
      auth.ts                   # GitHub token resolution (env → gh CLI → config)
      server.ts                 # Hono app: static files + API routes
      github/
        client.ts               # GitHub API wrapper (Octokit-lite, typed)
        types.ts                # GitHub API response types
        diff-parser.ts          # Unified diff text → DiffHunk[] structured data
        line-mapper.ts          # Translate absolute line ↔ GitHub diff position
        comments.ts             # Read/write PR comments, map to narrative
      narrative/
        engine.ts               # Orchestrate: diff → LLM → NarrativeResponse
        prompt.ts               # System prompt + structured output schema
        types.ts                # NarrativeResponse, Chapter, Section, etc.
      __tests__/
        auth.test.ts
        diff-parser.test.ts
        line-mapper.test.ts
        comments.test.ts
        engine.test.ts
        prompt.test.ts

  web/                          # React + Vite frontend
    src/
      main.tsx                  # React root, fetch /api/narrative
      App.tsx                   # Shell: AppBar + PRHeader + StoryView
      state/
        review-store.ts         # Zustand store: chapters, reviewed state, drafts
        types.ts                # Shared frontend types (mirrors narrative/types.ts)
      components/
        AppBar.tsx              # Brand mark, CLI framing, theme toggle
        PRHeader.tsx            # Title, branch, author, stats, view toggle
        ChapterTOC.tsx          # Sidebar: chapter list with reviewed badges
        StoryView.tsx           # Two-column layout: TOC + main content
        Chapter.tsx             # Chapter card: head, narration, hunks
        NarrationBlock.tsx      # AI prose block, commentable
        NarrationAnchor.tsx     # Density toggle, re-narrate, ask AI, comment
        Hunk.tsx                # Code hunk: head, lines, comment gutter
        CodeLine.tsx            # Single diff line with hover comment button
        CrossRef.tsx            # "Also in Chapter N" indicator
        CommentThread.tsx       # Thread: comments + reply form
        Comment.tsx             # Single comment: avatar, author, body, badges
        SuggestedStart.tsx      # AI suggestion callout
        SubmitBar.tsx           # Sticky bottom: progress + submit button
        SubmitDialog.tsx        # Modal: resolution radio + summary textarea
        Toast.tsx               # Transient notification
      components/markdown/
        Markdown.tsx            # GFM renderer (sanitized with DOMPurify)
      hooks/
        useComments.ts          # Fetch/post comments via /api/comments
        useNarrative.ts         # Fetch /api/narrative on mount
      lib/
        shiki.ts                # Shiki highlighter singleton
        microcopy.ts            # Dad jokes and UI copy constants
    index.html
    vite.config.ts
    tailwind.config.ts

package.json                    # Workspace root
tsconfig.base.json
```

---

## Task 1: Project Scaffolding

**Files:**

- Create: `package.json` (workspace root)
- Create: `tsconfig.base.json`
- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/web/package.json`
- Create: `packages/web/tsconfig.json`
- Create: `packages/web/index.html`
- Create: `packages/web/vite.config.ts`
- Create: `packages/web/tailwind.config.ts`
- Create: `packages/web/src/main.tsx`
- Create: `packages/web/src/App.tsx`
- Create: `packages/web/src/index.css`

- [ ] **Step 1: Create workspace root package.json**

```json
{
  "name": "diffdad",
  "private": true,
  "workspaces": ["packages/*"]
}
```

- [ ] **Step 2: Create tsconfig.base.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 3: Create CLI package**

`packages/cli/package.json`:

```json
{
  "name": "@diffdad/cli",
  "version": "0.0.1",
  "type": "module",
  "bin": {
    "dad": "./src/cli.ts"
  },
  "dependencies": {
    "hono": "^4",
    "ai": "^4",
    "@ai-sdk/anthropic": "^1",
    "@ai-sdk/openai": "^1",
    "parse-diff": "^0.11",
    "open": "^10",
    "zod": "^3"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "vitest": "^3"
  },
  "scripts": {
    "dev": "bun run src/cli.ts",
    "test": "vitest run"
  }
}
```

`packages/cli/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "types": ["bun-types"]
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create web package with Vite + Tailwind**

`packages/web/package.json`:

```json
{
  "name": "@diffdad/web",
  "version": "0.0.1",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^19",
    "react-dom": "^19",
    "zustand": "^5",
    "shiki": "^3",
    "dompurify": "^3",
    "@radix-ui/themes": "^3"
  },
  "devDependencies": {
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@types/dompurify": "^3",
    "@vitejs/plugin-react": "^4",
    "vite": "^6",
    "tailwindcss": "^4",
    "@tailwindcss/vite": "^4",
    "vitest": "^3",
    "typescript": "^5"
  }
}
```

`packages/web/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist' },
  server: {
    proxy: { '/api': 'http://localhost:4317' },
  },
});
```

`packages/web/tailwind.config.ts`:

```ts
import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#6565EC',
          hover: '#5151CD',
          text: '#5753C6',
          deep: '#272962',
        },
      },
      fontFamily: {
        sans: ['Untitled Sans', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['IBM Plex Mono', 'Menlo', 'monospace'],
        em: ['Source Serif 4', 'Source Serif Pro', 'Georgia', 'serif'],
      },
    },
  },
} satisfies Config;
```

`packages/web/index.html`:

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Diff Dad</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`packages/web/src/index.css`:

```css
@import 'tailwindcss';
```

`packages/web/src/main.tsx`:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`packages/web/src/App.tsx`:

```tsx
export function App() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <p className="p-8 text-lg">Diff Dad — loading...</p>
    </div>
  );
}
```

- [ ] **Step 5: Install dependencies**

Run: `bun install`
Expected: All packages resolve.

- [ ] **Step 6: Verify Vite dev server starts**

Run: `cd packages/web && bun run dev -- --port 5199 &` then `curl -s http://localhost:5199 | head -5`
Expected: HTML with `<div id="root">`.

- [ ] **Step 7: Commit**

```bash
git add packages/ package.json tsconfig.base.json
git commit -m "scaffold: monorepo with cli and web packages"
```

---

## Task 2: CLI Entry Point + Auth

**Files:**

- Create: `packages/cli/src/cli.ts`
- Create: `packages/cli/src/auth.ts`
- Create: `packages/cli/src/config.ts`
- Test: `packages/cli/src/__tests__/auth.test.ts`

- [ ] **Step 1: Write the auth test**

```ts
// packages/cli/src/__tests__/auth.test.ts
import { describe, it, expect, afterEach } from 'vitest';
import { resolveGitHubToken } from '../auth';

describe('resolveGitHubToken', () => {
  const origEnv = process.env.DIFFDAD_GITHUB_TOKEN;

  afterEach(() => {
    if (origEnv !== undefined) process.env.DIFFDAD_GITHUB_TOKEN = origEnv;
    else delete process.env.DIFFDAD_GITHUB_TOKEN;
  });

  it('returns env var when set', async () => {
    process.env.DIFFDAD_GITHUB_TOKEN = 'ghp_test123';
    const token = await resolveGitHubToken();
    expect(token).toBe('ghp_test123');
  });

  it('returns null when no source available', async () => {
    delete process.env.DIFFDAD_GITHUB_TOKEN;
    const token = await resolveGitHubToken({ skipGhCli: true, skipConfig: true });
    expect(token).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun test src/__tests__/auth.test.ts`
Expected: FAIL — `resolveGitHubToken` not found.

- [ ] **Step 3: Implement config.ts**

```ts
// packages/cli/src/config.ts
import { homedir } from 'os';
import { join } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';

const CONFIG_DIR = join(homedir(), '.config', 'diffdad');
const CONFIG_PATH = join(CONFIG_DIR, 'config.json');

export type DiffDadConfig = {
  githubToken?: string;
  aiProvider?: 'anthropic' | 'openai' | 'ollama';
  aiApiKey?: string;
  aiModel?: string;
  aiBaseUrl?: string;
};

export async function readConfig(): Promise<DiffDadConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

export async function writeConfig(config: DiffDadConfig): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}
```

- [ ] **Step 4: Implement auth.ts**

```ts
// packages/cli/src/auth.ts
import { readConfig } from './config';

type ResolveOptions = { skipGhCli?: boolean; skipConfig?: boolean };

export async function resolveGitHubToken(opts: ResolveOptions = {}): Promise<string | null> {
  const fromEnv = process.env.DIFFDAD_GITHUB_TOKEN;
  if (fromEnv) return fromEnv;

  if (!opts.skipGhCli) {
    try {
      const proc = Bun.spawn(['gh', 'auth', 'token'], { stdout: 'pipe', stderr: 'pipe' });
      const text = await new Response(proc.stdout).text();
      const token = text.trim();
      if (token) return token;
    } catch {}
  }

  if (!opts.skipConfig) {
    const config = await readConfig();
    if (config.githubToken) return config.githubToken;
  }

  return null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/cli && bun test src/__tests__/auth.test.ts`
Expected: PASS

- [ ] **Step 6: Implement cli.ts (entry point)**

```ts
// packages/cli/src/cli.ts
#!/usr/bin/env bun
import { resolveGitHubToken } from "./auth";

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === "--help" || command === "-h") {
  console.log(`
  Diff Dad — measure twice, merge once.

  Usage:
    dad review <pr-url-or-shorthand>
    dad config

  Examples:
    dad review https://github.com/owner/repo/pull/123
    dad review owner/repo#123

  Environment:
    DIFFDAD_GITHUB_TOKEN  GitHub personal access token
  `);
  process.exit(0);
}

if (command === "review") {
  const prArg = args[1];
  if (!prArg) {
    console.error("Error: missing PR argument. Usage: dad review <pr-url-or-shorthand>");
    process.exit(1);
  }

  const token = await resolveGitHubToken();
  if (!token) {
    console.error("Error: no GitHub token found. Run `dad config` or set DIFFDAD_GITHUB_TOKEN.");
    process.exit(1);
  }

  const pr = parsePrArg(prArg);
  if (!pr) {
    console.error(`Error: could not parse "${prArg}". Use owner/repo#123 or a GitHub PR URL.`);
    process.exit(1);
  }

  console.log(`Fetching ${pr.owner}/${pr.repo}#${pr.number}...`);
  // Wired up in Task 6
}

if (command === "config") {
  console.log("Config setup not yet implemented.");
}

type ParsedPR = { owner: string; repo: string; number: number };

function parsePrArg(arg: string): ParsedPR | null {
  const urlMatch = arg.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (urlMatch) return { owner: urlMatch[1], repo: urlMatch[2], number: parseInt(urlMatch[3]) };

  const shortMatch = arg.match(/^([^/]+)\/([^#]+)#(\d+)$/);
  if (shortMatch) return { owner: shortMatch[1], repo: shortMatch[2], number: parseInt(shortMatch[3]) };

  return null;
}
```

- [ ] **Step 7: Verify CLI runs**

Run: `cd packages/cli && bun run src/cli.ts --help`
Expected: Usage text printed.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/
git commit -m "feat(cli): entry point with auth resolution and PR arg parsing"
```

---

## Task 3: GitHub API Client + Diff Parser

**Files:**

- Create: `packages/cli/src/github/types.ts`
- Create: `packages/cli/src/github/client.ts`
- Create: `packages/cli/src/github/diff-parser.ts`
- Test: `packages/cli/src/__tests__/diff-parser.test.ts`

- [ ] **Step 1: Write the diff parser test**

```ts
// packages/cli/src/__tests__/diff-parser.test.ts
import { describe, it, expect } from 'vitest';
import { parseDiff } from '../github/diff-parser';

const SAMPLE_DIFF = `diff --git a/src/math.ts b/src/math.ts
index abc1234..def5678 100644
--- a/src/math.ts
+++ b/src/math.ts
@@ -1,4 +1,5 @@
 export function add(a: number, b: number) {
-  return a + b;
+  const result = a + b;
+  return result;
 }
`;

describe('parseDiff', () => {
  it('parses a unified diff into structured hunks', () => {
    const files = parseDiff(SAMPLE_DIFF);
    expect(files).toHaveLength(1);
    expect(files[0].file).toBe('src/math.ts');
    expect(files[0].hunks).toHaveLength(1);
    const hunk = files[0].hunks[0];
    expect(hunk.lines.some((l) => l.type === 'remove' && l.content.includes('return a + b'))).toBe(true);
    expect(hunk.lines.some((l) => l.type === 'add' && l.content.includes('const result'))).toBe(true);
  });

  it('handles new files', () => {
    const diff = `diff --git a/src/new.ts b/src/new.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,3 @@
+export function hello() {
+  return "world";
+}
`;
    const files = parseDiff(diff);
    expect(files).toHaveLength(1);
    expect(files[0].isNewFile).toBe(true);
    expect(files[0].hunks[0].lines.every((l) => l.type === 'add')).toBe(true);
  });

  it('parses multiple files', () => {
    const diff = `diff --git a/a.ts b/a.ts
index abc..def 100644
--- a/a.ts
+++ b/a.ts
@@ -1,2 +1,2 @@
-old
+new
diff --git a/b.ts b/b.ts
index abc..def 100644
--- a/b.ts
+++ b/b.ts
@@ -1,2 +1,2 @@
-old2
+new2
`;
    const files = parseDiff(diff);
    expect(files).toHaveLength(2);
    expect(files[0].file).toBe('a.ts');
    expect(files[1].file).toBe('b.ts');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun test src/__tests__/diff-parser.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement types.ts**

```ts
// packages/cli/src/github/types.ts
export type PRMetadata = {
  number: number;
  title: string;
  body: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  author: { login: string; avatarUrl: string };
  branch: string;
  base: string;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: number;
};

export type PRComment = {
  id: number;
  author: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  path?: string;
  line?: number;
  side?: 'LEFT' | 'RIGHT';
  inReplyToId?: number;
  diffHunk?: string;
};

export type DiffFile = {
  file: string;
  isNewFile: boolean;
  isDeleted: boolean;
  hunks: DiffHunk[];
};

export type DiffHunk = {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
};

export type DiffLine = {
  type: 'add' | 'remove' | 'context';
  content: string;
  lineNumber: { old?: number; new?: number };
};
```

- [ ] **Step 4: Implement diff-parser.ts**

```ts
// packages/cli/src/github/diff-parser.ts
import type { DiffFile, DiffHunk, DiffLine } from './types';

export function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = [];
  const fileSections = raw.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const lines = section.split('\n');
    const pathMatch = lines[0]?.match(/b\/(.+)$/);
    const file = pathMatch?.[1] ?? 'unknown';
    const isNewFile = section.includes('new file mode');
    const isDeleted = section.includes('deleted file mode');

    const hunks: DiffHunk[] = [];
    let currentHunk: DiffHunk | null = null;
    let oldLine = 0;
    let newLine = 0;

    for (const line of lines) {
      const hunkMatch = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (hunkMatch) {
        currentHunk = {
          header: line,
          oldStart: parseInt(hunkMatch[1]),
          oldCount: parseInt(hunkMatch[2] ?? '1'),
          newStart: parseInt(hunkMatch[3]),
          newCount: parseInt(hunkMatch[4] ?? '1'),
          lines: [],
        };
        hunks.push(currentHunk);
        oldLine = currentHunk.oldStart;
        newLine = currentHunk.newStart;
        continue;
      }

      if (!currentHunk) continue;

      if (line.startsWith('+')) {
        currentHunk.lines.push({ type: 'add', content: line.slice(1), lineNumber: { new: newLine } });
        newLine++;
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({ type: 'remove', content: line.slice(1), lineNumber: { old: oldLine } });
        oldLine++;
      } else if (line.startsWith(' ')) {
        currentHunk.lines.push({ type: 'context', content: line.slice(1), lineNumber: { old: oldLine, new: newLine } });
        oldLine++;
        newLine++;
      }
    }

    files.push({ file, isNewFile, isDeleted, hunks });
  }

  return files;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/cli && bun test src/__tests__/diff-parser.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 6: Implement client.ts**

```ts
// packages/cli/src/github/client.ts
import type { PRMetadata, PRComment, DiffFile } from './types';
import { parseDiff } from './diff-parser';

export class GitHubClient {
  private baseUrl = 'https://api.github.com';

  constructor(private token: string) {}

  private async fetch(path: string, init?: RequestInit) {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github.v3+json',
        ...init?.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GitHub API ${res.status}: ${path}\n${body}`);
    }
    return res;
  }

  async getPR(owner: string, repo: string, number: number): Promise<PRMetadata> {
    const res = await this.fetch(`/repos/${owner}/${repo}/pulls/${number}`);
    const d = await res.json();
    return {
      number: d.number,
      title: d.title,
      body: d.body ?? '',
      state: d.merged ? 'merged' : d.state,
      draft: d.draft,
      author: { login: d.user.login, avatarUrl: d.user.avatar_url },
      branch: d.head.ref,
      base: d.base.ref,
      labels: d.labels.map((l: any) => l.name),
      createdAt: d.created_at,
      updatedAt: d.updated_at,
      additions: d.additions,
      deletions: d.deletions,
      changedFiles: d.changed_files,
      commits: d.commits,
    };
  }

  async getDiff(owner: string, repo: string, number: number): Promise<DiffFile[]> {
    const res = await this.fetch(`/repos/${owner}/${repo}/pulls/${number}`, {
      headers: { Accept: 'application/vnd.github.v3.diff' },
    });
    return parseDiff(await res.text());
  }

  async getComments(owner: string, repo: string, number: number): Promise<PRComment[]> {
    const [review, issue] = await Promise.all([
      this.fetch(`/repos/${owner}/${repo}/pulls/${number}/comments`).then((r) => r.json()),
      this.fetch(`/repos/${owner}/${repo}/issues/${number}/comments`).then((r) => r.json()),
    ]);
    return [
      ...review.map((c: any) => ({
        id: c.id,
        author: c.user.login,
        body: c.body,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
        path: c.path,
        line: c.line ?? c.original_line,
        side: c.side,
        inReplyToId: c.in_reply_to_id,
        diffHunk: c.diff_hunk,
      })),
      ...issue.map((c: any) => ({
        id: c.id,
        author: c.user.login,
        body: c.body,
        createdAt: c.created_at,
        updatedAt: c.updated_at,
      })),
    ];
  }

  async postComment(
    owner: string,
    repo: string,
    number: number,
    body: string,
    opts?: { path?: string; line?: number; side?: 'LEFT' | 'RIGHT'; commitId?: string },
  ): Promise<PRComment> {
    if (opts?.path && opts?.line && opts?.commitId) {
      const res = await this.fetch(`/repos/${owner}/${repo}/pulls/${number}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body,
          path: opts.path,
          line: opts.line,
          side: opts.side ?? 'RIGHT',
          commit_id: opts.commitId,
        }),
      });
      const d = await res.json();
      return {
        id: d.id,
        author: d.user.login,
        body: d.body,
        createdAt: d.created_at,
        updatedAt: d.updated_at,
        path: d.path,
        line: d.line,
        side: d.side,
      };
    }
    const res = await this.fetch(`/repos/${owner}/${repo}/issues/${number}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    const d = await res.json();
    return { id: d.id, author: d.user.login, body: d.body, createdAt: d.created_at, updatedAt: d.updated_at };
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/github/ packages/cli/src/__tests__/diff-parser.test.ts
git commit -m "feat(cli): GitHub API client and diff parser"
```

---

## Task 4: Narrative Engine

**Files:**

- Create: `packages/cli/src/narrative/types.ts`
- Create: `packages/cli/src/narrative/prompt.ts`
- Create: `packages/cli/src/narrative/engine.ts`
- Test: `packages/cli/src/__tests__/prompt.test.ts`

- [ ] **Step 1: Write prompt construction test**

```ts
// packages/cli/src/__tests__/prompt.test.ts
import { describe, it, expect } from 'vitest';
import { buildNarrativePrompt } from '../narrative/prompt';

describe('buildNarrativePrompt', () => {
  it('includes PR metadata and diff content', () => {
    const { system, user } = buildNarrativePrompt({
      title: 'Add y constant',
      description: 'We need y.',
      labels: ['enhancement'],
      files: [
        {
          file: 'src/index.ts',
          isNewFile: false,
          isDeleted: false,
          hunks: [
            {
              header: '@@ -1,3 +1,4 @@',
              oldStart: 1,
              oldCount: 3,
              newStart: 1,
              newCount: 4,
              lines: [
                { type: 'context', content: 'const x = 1;', lineNumber: { old: 1, new: 1 } },
                { type: 'add', content: 'const y = 2;', lineNumber: { new: 2 } },
              ],
            },
          ],
        },
      ],
      fileTree: ['src/index.ts', 'src/other.ts'],
    });

    expect(system).toContain('semantic');
    expect(system).toContain('chapters');
    expect(user).toContain('Add y constant');
    expect(user).toContain('src/index.ts');
    expect(user).toContain('const y = 2;');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun test src/__tests__/prompt.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement narrative/types.ts**

```ts
// packages/cli/src/narrative/types.ts
export type NarrativeResponse = {
  title: string;
  chapters: NarrativeChapter[];
  suggestedStart?: { chapter: number; reason: string };
};

export type NarrativeChapter = {
  title: string;
  summary: string;
  risk: 'low' | 'medium' | 'high';
  sections: NarrativeSection[];
};

export type NarrativeSection =
  | { type: 'narrative'; content: string }
  | { type: 'diff'; file: string; startLine: number; endLine: number; hunkIndex: number };
```

- [ ] **Step 4: Implement narrative/prompt.ts**

```ts
// packages/cli/src/narrative/prompt.ts
import type { DiffFile } from '../github/types';

type PromptInput = {
  title: string;
  description: string;
  labels: string[];
  files: DiffFile[];
  fileTree: string[];
};

export function buildNarrativePrompt(input: PromptInput): { system: string; user: string } {
  const system = `You are a code review narrator. Your job is to take a pull request diff and reorganize it into semantic chapters that tell the story of what the PR does.

Rules:
1. Group diff hunks by semantic behavior, NOT by file. A single chapter may reference hunks from multiple files.
2. Order chapters as a logical reading sequence: setup/foundations first, then core logic, then wiring/integration, then tests.
3. Each chapter gets a title, a 2-3 sentence summary explaining the intent, and a risk assessment (low/medium/high).
4. Between code references, write narrative prose explaining WHY the changes connect and what they accomplish together.
5. A hunk may appear in multiple chapters if it is relevant to more than one semantic story.
6. Suggest which chapter to start reviewing and why.

Respond with valid JSON matching this schema:
{
  "title": "string — AI-generated PR summary",
  "suggestedStart": { "chapter": number, "reason": "string" },
  "chapters": [{
    "title": "string",
    "summary": "string — 2-3 sentences",
    "risk": "low | medium | high",
    "sections": [
      { "type": "narrative", "content": "string — markdown prose" },
      { "type": "diff", "file": "string", "startLine": number, "endLine": number, "hunkIndex": number }
    ]
  }]
}

hunkIndex is zero-based into the flat list of hunks across all files (ordered as they appear in the diff).`;

  const diffText = input.files
    .map((f) => {
      const header = f.isNewFile ? `--- /dev/null\n+++ ${f.file} (new file)` : `--- ${f.file}\n+++ ${f.file}`;
      const hunks = f.hunks
        .map((h) => {
          const lines = h.lines
            .map((l) => {
              const prefix = l.type === 'add' ? '+' : l.type === 'remove' ? '-' : ' ';
              return `${prefix}${l.content}`;
            })
            .join('\n');
          return `${h.header}\n${lines}`;
        })
        .join('\n');
      return `${header}\n${hunks}`;
    })
    .join('\n\n');

  const user = `# PR: ${input.title}

## Description
${input.description || '(no description)'}

## Labels
${input.labels.length ? input.labels.join(', ') : '(none)'}

## Repository file tree
${input.fileTree.slice(0, 200).join('\n')}
${input.fileTree.length > 200 ? `\n... and ${input.fileTree.length - 200} more files` : ''}

## Diff
${diffText}`;

  return { system, user };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/cli && bun test src/__tests__/prompt.test.ts`
Expected: PASS

- [ ] **Step 6: Implement narrative/engine.ts**

```ts
// packages/cli/src/narrative/engine.ts
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { buildNarrativePrompt } from './prompt';
import type { NarrativeResponse } from './types';
import type { DiffFile, PRMetadata } from '../github/types';
import type { DiffDadConfig } from '../config';

export async function generateNarrative(
  pr: PRMetadata,
  files: DiffFile[],
  fileTree: string[],
  config: DiffDadConfig,
): Promise<NarrativeResponse> {
  const { system, user } = buildNarrativePrompt({
    title: pr.title,
    description: pr.body,
    labels: pr.labels,
    files,
    fileTree,
  });
  const model = getModel(config);
  const result = await generateText({ model, system, messages: [{ role: 'user', content: user }] });
  return JSON.parse(result.text) as NarrativeResponse;
}

function getModel(config: DiffDadConfig) {
  const provider = config.aiProvider ?? 'anthropic';
  switch (provider) {
    case 'anthropic': {
      const a = createAnthropic({ apiKey: config.aiApiKey });
      return a(config.aiModel ?? 'claude-sonnet-4-6');
    }
    case 'openai': {
      const o = createOpenAI({ apiKey: config.aiApiKey });
      return o(config.aiModel ?? 'gpt-4o');
    }
    case 'ollama': {
      const o = createOpenAI({ baseURL: config.aiBaseUrl ?? 'http://localhost:11434/v1', apiKey: 'ollama' });
      return o(config.aiModel ?? 'llama3.1');
    }
    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/narrative/ packages/cli/src/__tests__/prompt.test.ts
git commit -m "feat(cli): narrative engine with provider-agnostic LLM support"
```

---

## Task 5: Hono Server + Line Mapper

**Files:**

- Create: `packages/cli/src/server.ts`
- Create: `packages/cli/src/github/line-mapper.ts`
- Create: `packages/cli/src/github/comments.ts`
- Test: `packages/cli/src/__tests__/line-mapper.test.ts`

- [ ] **Step 1: Write line mapper test**

```ts
// packages/cli/src/__tests__/line-mapper.test.ts
import { describe, it, expect } from 'vitest';
import { absoluteToPosition, positionToAbsolute } from '../github/line-mapper';
import type { DiffHunk } from '../github/types';

const hunk: DiffHunk = {
  header: '@@ -10,6 +10,8 @@',
  oldStart: 10,
  oldCount: 6,
  newStart: 10,
  newCount: 8,
  lines: [
    { type: 'context', content: 'a', lineNumber: { old: 10, new: 10 } },
    { type: 'context', content: 'b', lineNumber: { old: 11, new: 11 } },
    { type: 'add', content: 'c', lineNumber: { new: 12 } },
    { type: 'add', content: 'd', lineNumber: { new: 13 } },
    { type: 'context', content: 'e', lineNumber: { old: 12, new: 14 } },
    { type: 'context', content: 'f', lineNumber: { old: 13, new: 15 } },
  ],
};

describe('line-mapper', () => {
  it('converts absolute new-side line to diff position', () => {
    expect(absoluteToPosition(hunk, 12)).toBe(3);
    expect(absoluteToPosition(hunk, 10)).toBe(1);
  });

  it('returns null for lines not in the hunk', () => {
    expect(absoluteToPosition(hunk, 99)).toBeNull();
  });

  it('converts diff position back to absolute line', () => {
    expect(positionToAbsolute(hunk, 3)).toEqual({ new: 12 });
    expect(positionToAbsolute(hunk, 1)).toEqual({ old: 10, new: 10 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && bun test src/__tests__/line-mapper.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement line-mapper.ts**

```ts
// packages/cli/src/github/line-mapper.ts
import type { DiffHunk } from './types';

export function absoluteToPosition(hunk: DiffHunk, absoluteNewLine: number): number | null {
  for (let i = 0; i < hunk.lines.length; i++) {
    if (hunk.lines[i].lineNumber.new === absoluteNewLine) return i + 1;
  }
  return null;
}

export function positionToAbsolute(hunk: DiffHunk, position: number): { old?: number; new?: number } | null {
  const idx = position - 1;
  if (idx < 0 || idx >= hunk.lines.length) return null;
  return hunk.lines[idx].lineNumber;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && bun test src/__tests__/line-mapper.test.ts`
Expected: PASS

- [ ] **Step 5: Implement comments.ts (mapping helper)**

```ts
// packages/cli/src/github/comments.ts
import type { PRComment } from './types';
import type { NarrativeResponse } from '../narrative/types';

export type MappedComment = PRComment & {
  chapterIndices: number[];
  isNarrativeComment: boolean;
  narrativeChapter?: number;
};

export function mapCommentsToChapters(comments: PRComment[], narrative: NarrativeResponse): MappedComment[] {
  return comments.map((comment) => {
    if (!comment.path || comment.line == null) {
      const match = comment.body.match(/\[diff\.dad: Chapter (\d+)\]/);
      return {
        ...comment,
        chapterIndices: [],
        isNarrativeComment: !!match,
        narrativeChapter: match ? parseInt(match[1]) - 1 : undefined,
      };
    }

    const chapterIndices: number[] = [];
    narrative.chapters.forEach((ch, idx) => {
      for (const section of ch.sections) {
        if (section.type === 'diff' && section.file === comment.path) {
          chapterIndices.push(idx);
          break;
        }
      }
    });

    return { ...comment, chapterIndices, isNarrativeComment: false };
  });
}
```

- [ ] **Step 6: Implement server.ts**

```ts
// packages/cli/src/server.ts
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { resolve } from 'path';
import type { NarrativeResponse } from './narrative/types';
import type { PRMetadata, PRComment, DiffFile } from './github/types';
import type { GitHubClient } from './github/client';

type ServerContext = {
  narrative: NarrativeResponse;
  pr: PRMetadata;
  files: DiffFile[];
  comments: PRComment[];
  github: GitHubClient;
  owner: string;
  repo: string;
};

export function createServer(ctx: ServerContext) {
  const app = new Hono();

  app.get('/api/narrative', (c) =>
    c.json({ narrative: ctx.narrative, pr: ctx.pr, files: ctx.files, comments: ctx.comments }),
  );

  app.get('/api/comments', async (c) => {
    ctx.comments = await ctx.github.getComments(ctx.owner, ctx.repo, ctx.pr.number);
    return c.json(ctx.comments);
  });

  app.post('/api/comments', async (c) => {
    const body = await c.req.json();
    const comment = await ctx.github.postComment(
      ctx.owner,
      ctx.repo,
      ctx.pr.number,
      body.body,
      body.path ? { path: body.path, line: body.line, side: body.side, commitId: body.commitId } : undefined,
    );
    ctx.comments.push(comment);
    return c.json(comment, 201);
  });

  const webDistPath = resolve(import.meta.dir, '../../web/dist');
  app.use('/*', serveStatic({ root: webDistPath }));
  app.get('/*', serveStatic({ root: webDistPath, path: 'index.html' }));

  return app;
}
```

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/server.ts packages/cli/src/github/line-mapper.ts packages/cli/src/github/comments.ts packages/cli/src/__tests__/line-mapper.test.ts
git commit -m "feat(cli): Hono server with API routes and line mapper"
```

---

## Task 6: Wire CLI End-to-End

**Files:**

- Modify: `packages/cli/src/cli.ts`

- [ ] **Step 1: Add imports and wire the review command**

Add to the top of `cli.ts`:

```ts
import { readConfig } from './config';
import { GitHubClient } from './github/client';
import { generateNarrative } from './narrative/engine';
import { createServer } from './server';
```

Replace the `if (command === "review")` block with the full pipeline:

```ts
if (command === 'review') {
  const prArg = args[1];
  if (!prArg) {
    console.error('Error: missing PR argument.');
    process.exit(1);
  }

  const token = await resolveGitHubToken();
  if (!token) {
    console.error('Error: no GitHub token found. Run `dad config` or set DIFFDAD_GITHUB_TOKEN.');
    process.exit(1);
  }

  const pr = parsePrArg(prArg);
  if (!pr) {
    console.error(`Error: could not parse "${prArg}".`);
    process.exit(1);
  }

  const config = await readConfig();
  const github = new GitHubClient(token);

  console.log(`Fetching ${pr.owner}/${pr.repo}#${pr.number}...`);
  const [metadata, files, comments] = await Promise.all([
    github.getPR(pr.owner, pr.repo, pr.number),
    github.getDiff(pr.owner, pr.repo, pr.number),
    github.getComments(pr.owner, pr.repo, pr.number),
  ]);

  console.log(`${metadata.title} — ${files.length} files, +${metadata.additions} -${metadata.deletions}`);
  console.log('Generating narrative...');

  const narrative = await generateNarrative(metadata, files, [], config);
  console.log(`${narrative.chapters.length} chapters generated. Starting server...`);

  const app = createServer({ narrative, pr: metadata, files, comments, github, owner: pr.owner, repo: pr.repo });
  const port = parseInt(args.find((a) => a.startsWith('--port='))?.split('=')[1] ?? '0') || 0;
  const server = Bun.serve({ fetch: app.fetch, port });

  const url = `http://localhost:${server.port}`;
  console.log(`\n  Diff Dad — ${url}\n`);
  console.log(`  Reviewing: ${pr.owner}/${pr.repo}#${pr.number}`);
  console.log(`  ${narrative.chapters.length} chapters · ${comments.length} comments\n`);

  if (!args.includes('--no-open')) {
    const { default: open } = await import('open');
    await open(url);
  }
}
```

- [ ] **Step 2: Build web frontend**

Run: `cd packages/web && bun run build`
Expected: `dist/` created.

- [ ] **Step 3: Smoke test**

Run: `cd packages/cli && bun run src/cli.ts --help`
Expected: Usage text.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/cli.ts
git commit -m "feat(cli): wire end-to-end review flow"
```

---

## Task 7: Frontend State + Hooks

**Files:**

- Create: `packages/web/src/state/types.ts`
- Create: `packages/web/src/state/review-store.ts`
- Create: `packages/web/src/hooks/useNarrative.ts`
- Create: `packages/web/src/hooks/useComments.ts`
- Create: `packages/web/src/lib/microcopy.ts`

**Note:** Frontend types mirror the CLI's types. In a future task, these could be shared via a `@diffdad/shared` package, but for Phase 1 we duplicate them to avoid cross-package build complexity.

- [ ] **Step 1: Create state/types.ts**

(Same types as `packages/cli/src/github/types.ts` and `packages/cli/src/narrative/types.ts`, re-exported for frontend use. Plus `ChapterState` and `DraftComment`.)

```ts
// packages/web/src/state/types.ts
export type PRData = {
  number: number;
  title: string;
  body: string;
  state: string;
  draft: boolean;
  author: { login: string; avatarUrl: string };
  branch: string;
  base: string;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: number;
};

export type NarrativeResponse = {
  title: string;
  chapters: Chapter[];
  suggestedStart?: { chapter: number; reason: string };
};

export type Chapter = {
  title: string;
  summary: string;
  risk: 'low' | 'medium' | 'high';
  sections: Section[];
};

export type Section =
  | { type: 'narrative'; content: string }
  | { type: 'diff'; file: string; startLine: number; endLine: number; hunkIndex: number };

export type DiffFile = { file: string; isNewFile: boolean; isDeleted: boolean; hunks: DiffHunk[] };
export type DiffHunk = {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
};
export type DiffLine = {
  type: 'add' | 'remove' | 'context';
  content: string;
  lineNumber: { old?: number; new?: number };
};

export type PRComment = {
  id: number;
  author: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  path?: string;
  line?: number;
  side?: string;
  inReplyToId?: number;
};

export type ChapterState = 'reading' | 'reviewing' | 'replied' | 'reviewed';
export type DraftComment = { id: string; body: string; path?: string; line?: number; chapterIndex?: number };
```

- [ ] **Step 2: Create review-store.ts**

```ts
// packages/web/src/state/review-store.ts
import { create } from 'zustand';
import type { NarrativeResponse, PRData, DiffFile, PRComment, ChapterState, DraftComment } from './types';

type ReviewState = {
  pr: PRData | null;
  narrative: NarrativeResponse | null;
  files: DiffFile[];
  comments: PRComment[];
  chapterStates: Record<string, ChapterState>;
  activeChapterId: string | null;
  drafts: DraftComment[];
  openLine: string | null;
  theme: 'light' | 'dark';
  density: 'terse' | 'normal' | 'verbose';

  setData: (pr: PRData, narrative: NarrativeResponse, files: DiffFile[], comments: PRComment[]) => void;
  setActiveChapter: (id: string) => void;
  toggleReviewed: (idx: number) => void;
  setOpenLine: (key: string | null) => void;
  addComment: (comment: PRComment) => void;
  addDraft: (draft: DraftComment) => void;
  removeDraft: (id: string) => void;
  clearDrafts: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
  setDensity: (d: 'terse' | 'normal' | 'verbose') => void;
};

export const useReviewStore = create<ReviewState>((set) => ({
  pr: null,
  narrative: null,
  files: [],
  comments: [],
  chapterStates: {},
  activeChapterId: null,
  drafts: [],
  openLine: null,
  theme: 'dark',
  density: 'normal',

  setData: (pr, narrative, files, comments) =>
    set({
      pr,
      narrative,
      files,
      comments,
      activeChapterId: 'ch-0',
      chapterStates: Object.fromEntries(narrative.chapters.map((_, i) => [`ch-${i}`, 'reading' as const])),
    }),
  setActiveChapter: (id) => set({ activeChapterId: id }),
  toggleReviewed: (idx) =>
    set((s) => {
      const key = `ch-${idx}`;
      return {
        chapterStates: { ...s.chapterStates, [key]: s.chapterStates[key] === 'reviewed' ? 'reading' : 'reviewed' },
      };
    }),
  setOpenLine: (key) => set({ openLine: key }),
  addComment: (c) => set((s) => ({ comments: [...s.comments, c] })),
  addDraft: (d) => set((s) => ({ drafts: [...s.drafts, d] })),
  removeDraft: (id) => set((s) => ({ drafts: s.drafts.filter((d) => d.id !== id) })),
  clearDrafts: () => set({ drafts: [] }),
  setTheme: (theme) => set({ theme }),
  setDensity: (density) => set({ density }),
}));
```

- [ ] **Step 3: Create hooks and microcopy**

```ts
// packages/web/src/hooks/useNarrative.ts
import { useEffect, useState } from 'react';
import { useReviewStore } from '../state/review-store';

export function useNarrative() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const setData = useReviewStore((s) => s.setData);

  useEffect(() => {
    fetch('/api/narrative')
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json();
      })
      .then((d) => {
        setData(d.pr, d.narrative, d.files, d.comments);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [setData]);

  return { loading, error };
}
```

```ts
// packages/web/src/hooks/useComments.ts
import { useCallback } from 'react';
import { useReviewStore } from '../state/review-store';

export function useComments() {
  const addComment = useReviewStore((s) => s.addComment);

  const postComment = useCallback(
    async (body: string, opts?: { path?: string; line?: number }) => {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, ...opts }),
      });
      if (!res.ok) throw new Error('Failed to post comment');
      const comment = await res.json();
      addComment(comment);
      return comment;
    },
    [addComment],
  );

  return { postComment };
}
```

```ts
// packages/web/src/lib/microcopy.ts
export const copy = {
  tagline: 'Measure twice, merge once.',
  altTagline: "I'm not mad, just diff-appointed.",
  emptyState: 'Go make a diff-erence.',
  inlineHint: 'Use your comment sense.',
  approvalToast: 'Proud of you, champ. Approved.',
  warning: 'Not on my branch.',
  blocker: 'Grounded until tests pass.',
  nudge: 'Measure twice, commit once.',
  loading: "Reading the diff so you don't have to...",
  errorGeneric: 'Something went sideways. Try again?',
} as const;
```

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/state/ packages/web/src/hooks/ packages/web/src/lib/
git commit -m "feat(web): Zustand store, data hooks, and microcopy"
```

---

## Task 8: Frontend Core Components

**Files:** All component files listed in the File Structure under `packages/web/src/components/`.

This is the largest task — each component is a focused file. Components should closely follow the design in `design_files/` but use proper React patterns. All markdown rendering MUST sanitize with DOMPurify before setting innerHTML.

- [ ] **Step 1: Create all component files**

Create each of these files with the implementation matching the design spec. Reference `design_files/Review.jsx`, `design_files/Diff.jsx`, and `design_files/index.html` for the exact component structure and behavior. Use Tailwind classes matching the design tokens from `README.md`.

Components to create (in dependency order):

1. `AppBar.tsx` — brand mark, CLI framing, theme toggle
2. `PRHeader.tsx` — title, branch, author, stats
3. `CodeLine.tsx` — single diff line with hover comment button
4. `Hunk.tsx` — code hunk wrapper with file header
5. `NarrationBlock.tsx` — AI prose block
6. `SuggestedStart.tsx` — AI suggestion callout
7. `Comment.tsx` — single comment display
8. `CommentThread.tsx` — thread with reply form
9. `Chapter.tsx` — chapter card with narration + hunks
10. `ChapterTOC.tsx` — sidebar chapter list
11. `StoryView.tsx` — two-column layout
12. `SubmitDialog.tsx` — review submission modal
13. `SubmitBar.tsx` — sticky bottom progress bar
14. `Toast.tsx` — transient notification
15. `markdown/Markdown.tsx` — GFM renderer (**must use DOMPurify**)

**Critical: Markdown.tsx must sanitize all HTML:**

```ts
import DOMPurify from 'dompurify';
// ...
const clean = DOMPurify.sanitize(html);
// Then use clean in the rendered output
```

- [ ] **Step 2: Wire into App.tsx**

Update `App.tsx` to compose: `AppBar` → `PRHeader` → `StoryView` → `SubmitBar`, with loading/error states using microcopy.

- [ ] **Step 3: Build and verify**

Run: `cd packages/web && bun run build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/
git commit -m "feat(web): core UI — app shell, chapters, hunks, comments, submit flow"
```

---

## Task 9: Integration Test

**Files:**

- Test: `packages/cli/src/__tests__/server.test.ts`

- [ ] **Step 1: Write server integration test**

```ts
// packages/cli/src/__tests__/server.test.ts
import { describe, it, expect } from 'vitest';
import { createServer } from '../server';
import type { NarrativeResponse } from '../narrative/types';
import type { PRMetadata } from '../github/types';

const mockNarrative: NarrativeResponse = {
  title: 'Test PR',
  chapters: [
    {
      title: 'Add feature',
      summary: 'Adds a new feature',
      risk: 'low',
      sections: [
        { type: 'narrative', content: 'This adds a feature.' },
        { type: 'diff', file: 'src/index.ts', startLine: 1, endLine: 5, hunkIndex: 0 },
      ],
    },
  ],
};

const mockPR: PRMetadata = {
  number: 1,
  title: 'Test PR',
  body: '',
  state: 'open',
  draft: false,
  author: { login: 'test', avatarUrl: '' },
  branch: 'feat',
  base: 'main',
  labels: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  additions: 10,
  deletions: 2,
  changedFiles: 1,
  commits: 1,
};

describe('server', () => {
  it('serves narrative at /api/narrative', async () => {
    const app = createServer({
      narrative: mockNarrative,
      pr: mockPR,
      files: [],
      comments: [],
      github: {} as any,
      owner: 'test',
      repo: 'test',
    });
    const res = await app.request('/api/narrative');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.narrative.title).toBe('Test PR');
    expect(data.narrative.chapters).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run all tests**

Run: `cd /Users/nicknisi/Developer/diffappointment && bun test --recursive`
Expected: All tests pass (auth, diff-parser, line-mapper, prompt, server).

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/__tests__/server.test.ts
git commit -m "test: integration test for Hono server API"
```

---

## Summary

After completing all 9 tasks:

- A working `dad review <url>` CLI that fetches a GitHub PR, generates a semantic narrative via any LLM, and serves a React UI
- Two-column chapter sidebar + detail pane matching the design spec
- Inline code diffs with line-level comment hover buttons
- Narrative blocks explaining the semantic story between code hunks
- Comment display with markdown rendering (sanitized) and GitHub sync badges
- Submit review modal (Approve / Comment / Request Changes)
- Progress bar with reviewed chapter count
- 5 test files covering core backend logic

**Not in Phase 1** (future phases):

- Full comment write + reply + thread CRUD
- Live webhook stream + Activity Drawer
- Keyboard shortcuts (j/k/r/c/?)
- Narration density toggle + re-narrate + Ask AI
- Bot comment clustering
- Tweaks panel
- Conflict UX (concurrent editing)
- Shiki syntax highlighting (plain text in Phase 1)
- Dark/light theme token tuning
- Cross-reference indicator ("also in Chapter N")
- CLI `config` interactive flow
