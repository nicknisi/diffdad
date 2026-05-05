# Dad Watch — Walking Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Realign the existing `dad watch` plumbing with the spec's branch-first vision: whole-branch story becomes the primary view, an immediate local skeleton renders before any model call, and per-commit narration drops back to on-demand only.

**Architecture:** Most scaffolding (CLI command, watch-server, polling, unified-cache, commit-cache, web mode) already exists at `packages/cli/src/{cli.ts,watch-server.ts,git/local.ts}` and `packages/web/src/...`. This plan does not rebuild it; it (a) makes whole-branch the default selection and auto-fires it on startup, (b) removes the eager per-commit narration loop, (c) adds a local skeleton (touched directories, file categorization, notable files) that renders without the LLM, and (d) wires that skeleton into the UI before the narrative arrives. A retrospective spike confirms whether the parallel server split deserves any consolidation.

**Tech Stack:** Bun + TypeScript + Hono (CLI), React 19 + Zustand + Tailwind v4 (web), vitest for tests.

**Spec reference:** `docs/dad-watch.md` — "Build now" items 1, 2, 3.

---

## What already exists (do NOT rebuild)

- `dad watch [branch] [--base <ref>]` CLI flow — `packages/cli/src/cli.ts:314-480`
- Watch server with SSE, synthetic PR, commit + unified narration, cache hits — `packages/cli/src/watch-server.ts`
- Local git helpers: `findRepoRoot`, `detectBaseBranch`, `mergeBase`, `listCommits`, `getDiffForRange`, `getDiffForCommit`, `getRangeStats`, `getCommitStats`, `repoFingerprint`, `getRemoteSlug` — `packages/cli/src/git/local.ts`
- Unified cache by `(repoFp, baseSha, headSha)` — `packages/cli/src/narrative/cache.ts:89-110`
- 2-second poll for new commits, refresh + drop orphaned narratives — `cli.ts:418-470`
- Web mode = 'watch' with `WatchHeader`, `CommitTimeline`, `StoryView` rendering — `App.tsx:125-148`
- "Whole branch" toggle pill in commit timeline (currently opt-in) — `CommitTimeline.tsx:70-87`

The plan modifies these files; it does not duplicate the work.

---

## File Structure

**Create:**
- `packages/cli/src/watch/skeleton.ts` — file categorization + skeleton builder (pure functions, no I/O)
- `packages/cli/src/__tests__/watch-skeleton.test.ts` — vitest tests for the classifier and aggregator
- `packages/web/src/components/BranchSkeletonView.tsx` — pre-narrative view that renders local facts immediately

**Modify:**
- `packages/cli/src/watch-server.ts` — wire skeleton into `/api/narrative` payload; default `selectionFromQuery` to unified
- `packages/cli/src/cli.ts` — auto-fire `narrateUnified` on startup; remove eager per-commit narration loop; keep on-new-commit refresh but stop auto-narrating each new commit
- `packages/web/src/state/types.ts` — add `BranchSkeleton`, extend `WatchData`
- `packages/web/src/state/review-store.ts` — store skeleton (keep changes minimal: skeleton lives inside `watch`)
- `packages/web/src/App.tsx` — render `BranchSkeletonView` in watch mode when narrative is missing instead of `GeneratingScreen`
- `packages/web/src/components/CommitTimeline.tsx` — make "Whole branch" the visually-active default when `selection.kind === 'unified'` (already true; verify) and surface a pending-narrative pill
- `packages/web/src/components/WatchHeader.tsx` — no behavior change required (it already adapts to `selection.kind`); verify "Whole branch" default copy reads sensibly

**Spike note (Task 0):** the spec asserts a parallel `watch-server.ts` is "cleaner" than grafting watch onto `server.ts`. That split already exists; the spike's job is retrospective — confirm the split was warranted and decide on optional small extractions.

---

## Task 0: Retrospective spike — server-split audit

**Files:**
- Read: `packages/cli/src/server.ts`, `packages/cli/src/watch-server.ts`
- Output: `docs/superpowers/plans/2026-05-03-dad-watch-walking-skeleton.md` (append "Spike findings" section)

This task produces a written decision, not code (unless a trivial extraction is obvious).

- [ ] **Step 1: Diff the surfaces**

List the routes each server defines and note which are unique vs shared. Append to this plan under a "Spike findings" heading. Expected list:

```
server.ts (PR mode):
  GET  /api/narrative         (PR data + cached/generating narrative)
  POST /api/ai                (ask, renarrate)
  GET  /api/checks            (GitHub check-runs refresh)
  GET  /api/comments          (GitHub review comments refresh)
  GET  /api/events            (SSE: pr, comments, checks, reviews, narrative)
  POST /api/comments          (post a GitHub comment)
  POST /api/review            (submit a GitHub review)
  GET  /*                     (static)

watch-server.ts (watch mode):
  GET  /api/narrative         (watch payload + selection-driven narrative)
  POST /api/narrative/unified (kick off unified narration)
  POST /api/narrative/commit  (kick off commit narration)
  GET  /api/events            (SSE: watch-update, commit-narrating, commit-narrative, unified-narrating, unified-narrative, *-error)
  GET  /*                     (static)
```

- [ ] **Step 2: Identify duplicated plumbing**

The genuinely duplicated blocks are SSE writer setup and the `webDist` resolution + serveStatic mount. Confirm by reading both files. Document the count of duplicated lines (rough order: ~40 lines combined).

- [ ] **Step 3: Decide and document**

Write a 6-10 line "Spike findings" section to this plan with:
- Verdict (keep split / collapse / extract helpers)
- Reasoning (API surfaces actually diverge: watch has no GitHub I/O, no comments/reviews/checks; PR mode polls GitHub on a 10s interval, watch is driven by cli polling)
- Optional follow-up (small `server-utils.ts` with `attachStaticAssets(app)` and `makeSseHandler()` — out of scope for this plan, but worth noting)

Default verdict: keep the split, defer extraction. The split is justified by surface divergence; extraction is a cosmetic win that doesn't unlock any spec item.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/plans/2026-05-03-dad-watch-walking-skeleton.md
git commit -m "docs(plan): spike findings on watch/PR server split"
```

---

## Task 1: Skeleton module — classifier + aggregator (TDD)

**Files:**
- Create: `packages/cli/src/watch/skeleton.ts`
- Test: `packages/cli/src/__tests__/watch-skeleton.test.ts`

The skeleton is the cheap-local-facts surface. It must run synchronously off `DiffFile[]` returned by `parseDiff(getDiffForRange(...))` — no I/O, no model calls. The watch-server already loads `DiffFile[]` for the unified range; the skeleton consumes that list.

### Types

Define in `skeleton.ts`:

```ts
export type FileCategory = 'test' | 'config' | 'schema' | 'migration' | 'docs' | 'public-api' | 'source';

export type SkeletonFile = {
  path: string;
  category: FileCategory;
  additions: number;
  deletions: number;
  isNewFile: boolean;
  isDeleted: boolean;
};

export type BranchSkeleton = {
  totals: { additions: number; deletions: number; changedFiles: number };
  byCategory: Record<FileCategory, number>;
  touchedDirs: { dir: string; count: number }[]; // top 8, sorted by count desc
  notable: SkeletonFile[]; // top 5 by (additions + deletions), excluding pure deletions of small files
  files: SkeletonFile[];   // every file, in insertion order
};
```

- [ ] **Step 1: Write failing tests**

Create `packages/cli/src/__tests__/watch-skeleton.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { DiffFile } from '../github/types';
import { buildBranchSkeleton, classifyFile } from '../watch/skeleton';

function file(path: string, opts: Partial<{ additions: number; deletions: number; isNewFile: boolean; isDeleted: boolean }> = {}): DiffFile {
  const adds = opts.additions ?? 1;
  const dels = opts.deletions ?? 0;
  return {
    file: path,
    isNewFile: opts.isNewFile ?? false,
    isDeleted: opts.isDeleted ?? false,
    hunks: [
      {
        header: '@@ -1,1 +1,1 @@',
        oldStart: 1,
        oldCount: dels,
        newStart: 1,
        newCount: adds,
        lines: [
          ...Array.from({ length: adds }, (_, i) => ({ type: 'add' as const, content: `a${i}`, lineNumber: { new: i + 1 } })),
          ...Array.from({ length: dels }, (_, i) => ({ type: 'remove' as const, content: `d${i}`, lineNumber: { old: i + 1 } })),
        ],
      },
    ],
  };
}

describe('classifyFile', () => {
  it('detects tests by directory', () => {
    expect(classifyFile('packages/cli/src/__tests__/foo.test.ts')).toBe('test');
    expect(classifyFile('src/foo.spec.ts')).toBe('test');
    expect(classifyFile('tests/integration/api.ts')).toBe('test');
  });

  it('detects migrations', () => {
    expect(classifyFile('db/migrations/0001_init.sql')).toBe('migration');
    expect(classifyFile('prisma/migrations/20240101_x/migration.sql')).toBe('migration');
  });

  it('detects schemas', () => {
    expect(classifyFile('prisma/schema.prisma')).toBe('schema');
    expect(classifyFile('src/db/schema.ts')).toBe('schema');
    expect(classifyFile('src/types/schema.ts')).toBe('schema');
  });

  it('detects config', () => {
    expect(classifyFile('vite.config.ts')).toBe('config');
    expect(classifyFile('tailwind.config.js')).toBe('config');
    expect(classifyFile('tsconfig.json')).toBe('config');
    expect(classifyFile('.oxlintrc.json')).toBe('config');
    expect(classifyFile('package.json')).toBe('config');
    expect(classifyFile('bun.lock')).toBe('config');
  });

  it('detects docs', () => {
    expect(classifyFile('README.md')).toBe('docs');
    expect(classifyFile('docs/dad-watch.md')).toBe('docs');
    expect(classifyFile('CHANGELOG.md')).toBe('docs');
  });

  it('detects public api', () => {
    expect(classifyFile('packages/cli/src/index.ts')).toBe('public-api');
    expect(classifyFile('src/types/public.d.ts')).toBe('public-api');
  });

  it('falls back to source', () => {
    expect(classifyFile('src/lib/foo.ts')).toBe('source');
    expect(classifyFile('packages/web/src/components/Hunk.tsx')).toBe('source');
  });
});

describe('buildBranchSkeleton', () => {
  const files: DiffFile[] = [
    file('packages/cli/src/watch-server.ts', { additions: 80, deletions: 10 }),
    file('packages/cli/src/__tests__/watch.test.ts', { additions: 40, deletions: 0, isNewFile: true }),
    file('packages/web/src/components/Foo.tsx', { additions: 20, deletions: 5 }),
    file('packages/web/src/components/Bar.tsx', { additions: 5, deletions: 1 }),
    file('docs/dad-watch.md', { additions: 200, deletions: 0 }),
    file('vite.config.ts', { additions: 2, deletions: 1 }),
  ];

  it('counts totals and category buckets', () => {
    const s = buildBranchSkeleton(files);
    expect(s.totals.changedFiles).toBe(6);
    expect(s.totals.additions).toBe(347);
    expect(s.totals.deletions).toBe(17);
    expect(s.byCategory.test).toBe(1);
    expect(s.byCategory.docs).toBe(1);
    expect(s.byCategory.config).toBe(1);
    expect(s.byCategory.source).toBe(3);
  });

  it('aggregates touched directories sorted by count', () => {
    const s = buildBranchSkeleton(files);
    const top = s.touchedDirs[0];
    expect(top.dir).toBe('packages/web/src/components');
    expect(top.count).toBe(2);
  });

  it('flags notable files by total change size', () => {
    const s = buildBranchSkeleton(files);
    expect(s.notable[0].path).toBe('docs/dad-watch.md');
    expect(s.notable.length).toBeLessThanOrEqual(5);
  });

  it('records every file in files[] preserving order', () => {
    const s = buildBranchSkeleton(files);
    expect(s.files.map((f) => f.path)).toEqual(files.map((f) => f.file));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
bun test packages/cli/src/__tests__/watch-skeleton.test.ts
```

Expected: FAIL — module `../watch/skeleton` does not exist.

- [ ] **Step 3: Implement `skeleton.ts`**

Create `packages/cli/src/watch/skeleton.ts`:

```ts
import type { DiffFile } from '../github/types';

export type FileCategory = 'test' | 'config' | 'schema' | 'migration' | 'docs' | 'public-api' | 'source';

export type SkeletonFile = {
  path: string;
  category: FileCategory;
  additions: number;
  deletions: number;
  isNewFile: boolean;
  isDeleted: boolean;
};

export type BranchSkeleton = {
  totals: { additions: number; deletions: number; changedFiles: number };
  byCategory: Record<FileCategory, number>;
  touchedDirs: { dir: string; count: number }[];
  notable: SkeletonFile[];
  files: SkeletonFile[];
};

const TEST_RE = /(^|\/)(__tests__|tests?)\//i;
const TEST_SUFFIX_RE = /\.(test|spec)\.[a-z0-9]+$/i;
const MIGRATION_RE = /(^|\/)migrations?\//i;
const SCHEMA_RE = /(^|\/)(schema)\.(ts|js|prisma|sql)$/i;
const SCHEMA_PRISMA_RE = /(^|\/)prisma\/schema\.prisma$/i;
const DOCS_RE = /(^|\/)docs?\//i;
const MARKDOWN_RE = /\.(md|mdx)$/i;
const PUBLIC_API_RE = /(^|\/)(src\/index|index)\.(ts|tsx|js)$/i;
const DTS_RE = /\.d\.ts$/i;
const CONFIG_FILES = new Set([
  'package.json',
  'bun.lock',
  'package-lock.json',
  'yarn.lock',
  'tsconfig.json',
  '.oxlintrc.json',
  '.oxfmtrc.json',
  '.gitignore',
  '.npmrc',
]);
const CONFIG_PATTERNS = [
  /\.config\.(ts|js|mjs|cjs|json)$/i,
  /(^|\/)(vite|vitest|tailwind|eslint|prettier|postcss|babel|rollup|webpack)\.config\./i,
  /(^|\/)\.[a-z0-9-]+rc(\.[a-z]+)?$/i, // .eslintrc, .prettierrc, .oxlintrc.json (also caught above)
];

export function classifyFile(path: string): FileCategory {
  if (TEST_RE.test(path) || TEST_SUFFIX_RE.test(path)) return 'test';
  if (MIGRATION_RE.test(path)) return 'migration';
  if (SCHEMA_PRISMA_RE.test(path) || SCHEMA_RE.test(path)) return 'schema';
  const basename = path.split('/').pop() ?? path;
  if (CONFIG_FILES.has(basename)) return 'config';
  if (CONFIG_PATTERNS.some((re) => re.test(path))) return 'config';
  if (MARKDOWN_RE.test(path) || DOCS_RE.test(path)) return 'docs';
  if (PUBLIC_API_RE.test(path) || DTS_RE.test(path)) return 'public-api';
  return 'source';
}

function countLines(file: DiffFile): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const h of file.hunks) {
    for (const l of h.lines) {
      if (l.type === 'add') additions += 1;
      else if (l.type === 'remove') deletions += 1;
    }
  }
  return { additions, deletions };
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

export function buildBranchSkeleton(files: DiffFile[]): BranchSkeleton {
  const skeletonFiles: SkeletonFile[] = files.map((f) => {
    const { additions, deletions } = countLines(f);
    return {
      path: f.file,
      category: classifyFile(f.file),
      additions,
      deletions,
      isNewFile: f.isNewFile,
      isDeleted: f.isDeleted,
    };
  });

  const totals = skeletonFiles.reduce(
    (acc, f) => ({
      additions: acc.additions + f.additions,
      deletions: acc.deletions + f.deletions,
      changedFiles: acc.changedFiles + 1,
    }),
    { additions: 0, deletions: 0, changedFiles: 0 },
  );

  const byCategory: Record<FileCategory, number> = {
    test: 0,
    config: 0,
    schema: 0,
    migration: 0,
    docs: 0,
    'public-api': 0,
    source: 0,
  };
  for (const f of skeletonFiles) byCategory[f.category] += 1;

  const dirCounts = new Map<string, number>();
  for (const f of skeletonFiles) {
    const d = dirOf(f.path) || '.';
    dirCounts.set(d, (dirCounts.get(d) ?? 0) + 1);
  }
  const touchedDirs = [...dirCounts.entries()]
    .map(([dir, count]) => ({ dir, count }))
    .sort((a, b) => b.count - a.count || a.dir.localeCompare(b.dir))
    .slice(0, 8);

  const notable = [...skeletonFiles]
    .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))
    .slice(0, 5);

  return { totals, byCategory, touchedDirs, notable, files: skeletonFiles };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
bun test packages/cli/src/__tests__/watch-skeleton.test.ts
```

Expected: PASS — all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/watch/skeleton.ts packages/cli/src/__tests__/watch-skeleton.test.ts
git commit -m "$(cat <<'EOF'
feat(watch): add branch skeleton classifier and aggregator

Pure functions that turn DiffFile[] into a BranchSkeleton: file
category, touched directories, notable files. Renders before any
LLM call returns.
EOF
)"
```

---

## Task 2: Wire skeleton into `/api/narrative` payload

**Files:**
- Modify: `packages/cli/src/watch-server.ts:339-385` (the `/api/narrative` handler) and the `WatchPayload` type at `:51-59`

The skeleton should be computed from the unified-range diff (`base...headSha`) and included in every `/api/narrative` response so the UI can render it without waiting for the model. Cache the computed skeleton in `WatchServerContext` keyed by `(baseSha, headSha)` to avoid recomputing on every request.

- [ ] **Step 1: Extend `WatchPayload` and `WatchServerContext`**

Add to `watch-server.ts`:

```ts
import { buildBranchSkeleton, type BranchSkeleton } from './watch/skeleton';
```

Update the `WatchPayload` type to include `skeleton: BranchSkeleton`:

```ts
type WatchPayload = {
  branch: string;
  base: string;
  baseSha: string;
  headSha: string;
  commits: CommitSummary[];
  selection: { kind: 'commit'; sha: string } | { kind: 'unified' } | { kind: 'pending' };
  unifiedReady: boolean;
  skeleton: BranchSkeleton;
};
```

Add a cached skeleton field to `WatchServerContext` (also exported):

```ts
export type WatchServerContext = {
  // ...existing fields...
  skeleton: BranchSkeleton | null;
  skeletonKey: string | null; // `${baseSha}:${headSha}`
};
```

- [ ] **Step 2: Compute and cache skeleton inside the request**

In `createWatchServer`, add a helper:

```ts
async function getSkeleton(): Promise<BranchSkeleton> {
  const key = `${ctx.baseSha}:${ctx.headSha}`;
  if (ctx.skeleton && ctx.skeletonKey === key) return ctx.skeleton;
  const files = await loadFilesForRange(ctx.repoRoot, ctx.base, ctx.headSha);
  const skeleton = buildBranchSkeleton(files);
  ctx.skeleton = skeleton;
  ctx.skeletonKey = key;
  return skeleton;
}
```

Invalidate it inside `refreshCommits`:

```ts
async function refreshCommits(newCommits: LocalCommit[], newHeadSha: string) {
  // ...existing code...
  ctx.skeleton = null;
  ctx.skeletonKey = null;
  // ...rest...
}
```

- [ ] **Step 3: Include skeleton in `/api/narrative` response**

Inside the handler, after `buildCommitSummaries()`:

```ts
const skeleton = await getSkeleton();

const watch: WatchPayload = {
  branch: ctx.branch,
  base: ctx.base,
  baseSha: ctx.baseSha,
  headSha: ctx.headSha,
  commits: summaries,
  selection,
  unifiedReady,
  skeleton,
};
```

- [ ] **Step 4: Update `cli.ts` initialization to set the new context fields**

In `packages/cli/src/cli.ts`, the `ctx: WatchServerContext = { ... }` literal at `:369-383` needs the two new fields:

```ts
const ctx: WatchServerContext = {
  // ...existing...
  skeleton: null,
  skeletonKey: null,
};
```

- [ ] **Step 5: Type-check + manual smoke**

```bash
bun run lint
bun test packages/cli/src/__tests__/
```

Expected: green. (Lint may warn — fix any new errors.)

Manual: in a repo with multiple commits ahead of main, run:

```bash
bun packages/cli/src/cli.ts watch --no-open
```

Then `curl -s localhost:<port>/api/narrative | jq '.watch.skeleton.totals, .watch.skeleton.byCategory, (.watch.skeleton.touchedDirs | length)'` and confirm sensible numbers. Stop the process with Ctrl-C.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/watch-server.ts packages/cli/src/cli.ts
git commit -m "$(cat <<'EOF'
feat(watch): include branch skeleton in /api/narrative payload

Computed from base..HEAD on demand and cached on the server context
keyed by (baseSha, headSha). Invalidated when refreshCommits fires.
EOF
)"
```

---

## Task 3: Default selection = unified (whole-branch primary)

**Files:**
- Modify: `packages/cli/src/watch-server.ts:296-337` (`selectionFromQuery`)

Right now `selectionFromQuery` returns the latest commit when no `sha`/`mode` is provided. The spec wants whole-branch as the primary unit.

- [ ] **Step 1: Flip the default branch in `selectionFromQuery`**

Replace the body. Show the full new function:

```ts
async function selectionFromQuery(c: { req: { query: (k: string) => string | undefined } }): Promise<{
  selection: WatchPayload['selection'];
  narrative: NarrativeResponse | null;
  files: DiffFile[];
  pr: PRMetadata;
}> {
  const sha = c.req.query('sha');
  const mode = c.req.query('mode');

  // Explicit per-commit request.
  if (sha) {
    const commit = ctx.commits.find((cm) => cm.sha === sha);
    if (commit) {
      const files = await loadFilesForCommit(ctx.repoRoot, commit.sha);
      const pr = syntheticPrForCommit(ctx, commit, files);
      const narrative = ctx.narratives.get(commit.sha) ?? null;
      return { selection: { kind: 'commit', sha: commit.sha }, narrative, files, pr };
    }
    // Fall through to unified default if sha unknown.
  }

  // Default and `?mode=unified` both land on the whole-branch view.
  if (ctx.commits.length === 0) {
    return {
      selection: { kind: 'pending' },
      narrative: null,
      files: [],
      pr: syntheticPrForUnified(ctx, []),
    };
  }

  const files = await loadFilesForRange(ctx.repoRoot, ctx.base, ctx.headSha);
  const pr = syntheticPrForUnified(ctx, files);
  const ready = ctx.unified && ctx.unifiedKey === `${ctx.baseSha}:${ctx.headSha}`;
  return {
    selection: { kind: 'unified' },
    narrative: ready ? ctx.unified : null,
    files,
    pr,
  };
  // Note: `mode` query param is now informational; both undefined and
  // 'unified' produce the same result.
}
```

- [ ] **Step 2: Verify the request path**

Manual: build, run `dad watch`, open the browser. The "Whole branch" pill in the timeline should be selected by default (it already styles `isUnified` correctly — verify visually). The main pane should render the unified narrative or the skeleton (Task 5+) while it generates.

```bash
bun run build
bun packages/cli/src/cli.ts watch
```

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/watch-server.ts
git commit -m "feat(watch): default selection to whole-branch view"
```

---

## Task 4: Auto-fire unified narration on startup; remove eager per-commit loop

**Files:**
- Modify: `packages/cli/src/cli.ts:400-415` (the eager narration block) and the polling block at `:418-470`

The current startup loop iterates `ctx.commits` and narrates each one synchronously. That contradicts the spec (per-commit on demand) and also blocks the unified narration from getting fair scheduling. Replace it.

- [ ] **Step 1: Replace the startup narration block**

In `cli.ts:watchCommand`, locate:

```ts
if (commits.length === 0) {
  console.log(`  ${a.dim}No commits ahead of ${base} yet — waiting for new commits...${a.reset}`);
} else {
  console.log(`  ${a.yellow}Narrating ${commits.length} commit${commits.length === 1 ? '' : 's'}...${a.reset}`);
  // Kick off narrations sequentially in the background; SSE updates the UI.
  void (async () => {
    for (const c of commits) {
      await narrateCommit(c.sha, { broadcastWhenDone: true });
      if (ctx.narratives.has(c.sha)) {
        console.log(
          `  ${a.green}✓${a.reset} ${a.gray}${c.shortSha}${a.reset} ${a.white}${c.subject}${a.reset}`,
        );
      }
    }
  })();
}
```

Replace with:

```ts
const { narrateUnified } = createWatchServerHandle; // see Step 2 — destructure earlier

if (commits.length === 0) {
  console.log(`  ${a.dim}No commits ahead of ${base} yet — waiting for new commits...${a.reset}`);
} else {
  console.log(
    `  ${a.yellow}Narrating whole branch${a.reset} ${a.dim}(${commits.length} commit${commits.length === 1 ? '' : 's'} as one story)${a.reset}`,
  );
  void (async () => {
    const narrative = await narrateUnified();
    if (narrative) {
      console.log(
        `  ${a.green}✓${a.reset} ${a.white}whole-branch story ready${a.reset} ${a.dim}(${narrative.chapters.length} chapters)${a.reset}`,
      );
    }
  })();
}
```

- [ ] **Step 2: Expose `narrateUnified` from `createWatchServer`**

It is already returned (`return { app, broadcast, narrateCommit, narrateUnified, refreshCommits };` at the bottom of `watch-server.ts`). Update the destructure in `cli.ts:385`:

```ts
const { app, narrateUnified, refreshCommits } = createWatchServer(ctx);
```

`narrateCommit` is no longer needed at the cli layer (Task 4 removes its only caller); the watch-server uses it internally for the on-demand POST endpoint.

- [ ] **Step 3: Update the polling block to refresh skeleton + re-fire unified**

Find the `setInterval` at `cli.ts:420-471`. After the existing `await refreshCommits(freshCommits, freshHead)` call, also re-fire unified narration in the background (skeleton invalidation already happens inside `refreshCommits` thanks to Task 2):

```ts
ctx.baseSha = freshBase;
await refreshCommits(freshCommits, freshHead);

// Whole-branch story is the primary surface — regenerate it when the
// branch moves. Per-commit narration stays on demand.
void (async () => {
  const narrative = await narrateUnified();
  if (narrative) {
    console.log(
      `  ${a.green}✓${a.reset} ${a.white}whole-branch story refreshed${a.reset} ${a.dim}(${narrative.chapters.length} chapters)${a.reset}`,
    );
  }
})();
```

Remove the `tickShas` block that polled `ctx.generating` for per-commit completion logging — it's dead now that commits aren't auto-narrated.

- [ ] **Step 4: Make `narrateUnified` idempotent across stale calls**

Read `watch-server.ts:225-258` (`narrateUnified`). It already early-returns when `ctx.unifiedGenerating` is true. After `refreshCommits` invalidates `ctx.unified`, the next call will start a fresh generation. Confirm by reading; no code change expected.

- [ ] **Step 5: Build and smoke**

```bash
bun run build
bun packages/cli/src/cli.ts watch --no-open
```

Expected console output (in a repo with N>0 commits):
```
  Narrating whole branch (N commits as one story)
  http://localhost:XXXX
  "<dad joke>"
  ✓ whole-branch story ready (M chapters)
```

No per-commit `✓ <shortSha>` lines on startup. Open the browser; "Whole branch" is the default selection; the unified narrative renders.

Then make a new commit on the watched branch in another terminal and confirm:
- `↻ History rewritten` or `+ 1 new commit:` log fires
- `✓ whole-branch story refreshed` follows
- The browser updates via SSE

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/cli.ts
git commit -m "$(cat <<'EOF'
feat(watch): auto-narrate whole branch; remove eager per-commit loop

The whole-branch story is the primary view per the spec; per-commit
narration drops back to on-demand only. The polling tick still
refreshes when the branch moves, and the unified narrative is
regenerated alongside the skeleton.
EOF
)"
```

---

## Task 5: Frontend skeleton type, state, and `BranchSkeletonView`

**Files:**
- Modify: `packages/web/src/state/types.ts`
- Modify: `packages/web/src/state/review-store.ts` (no behavior change beyond accepting the extended `WatchData`)
- Create: `packages/web/src/components/BranchSkeletonView.tsx`

The skeleton needs to render even when `narrative` is `null`. It uses data from `useReviewStore((s) => s.watch.skeleton)`.

- [ ] **Step 1: Add types**

Append to `packages/web/src/state/types.ts`:

```ts
export type SkeletonFileCategory =
  | 'test'
  | 'config'
  | 'schema'
  | 'migration'
  | 'docs'
  | 'public-api'
  | 'source';

export type SkeletonFile = {
  path: string;
  category: SkeletonFileCategory;
  additions: number;
  deletions: number;
  isNewFile: boolean;
  isDeleted: boolean;
};

export type BranchSkeleton = {
  totals: { additions: number; deletions: number; changedFiles: number };
  byCategory: Record<SkeletonFileCategory, number>;
  touchedDirs: { dir: string; count: number }[];
  notable: SkeletonFile[];
  files: SkeletonFile[];
};
```

Then update `WatchData`:

```ts
export type WatchData = {
  branch: string;
  base: string;
  baseSha: string;
  headSha: string;
  commits: WatchCommitSummary[];
  selection: WatchSelection;
  unifiedReady: boolean;
  skeleton: BranchSkeleton;
};
```

The store's `setWatch`/`patchWatch` already accept whatever `WatchData` shape we declare; no store changes are needed.

- [ ] **Step 2: Create `BranchSkeletonView.tsx`**

Create `packages/web/src/components/BranchSkeletonView.tsx`:

```tsx
import { useReviewStore } from '../state/review-store';
import type { BranchSkeleton, SkeletonFileCategory } from '../state/types';

const CATEGORY_LABELS: Record<SkeletonFileCategory, string> = {
  test: 'Tests',
  config: 'Config',
  schema: 'Schema',
  migration: 'Migrations',
  docs: 'Docs',
  'public-api': 'Public API',
  source: 'Source',
};

const CATEGORY_ORDER: SkeletonFileCategory[] = [
  'source',
  'test',
  'public-api',
  'schema',
  'migration',
  'config',
  'docs',
];

export function BranchSkeletonView({ message }: { message: string }) {
  const watch = useReviewStore((s) => s.watch);
  if (!watch) return null;
  const { skeleton } = watch;
  return (
    <section className="px-6 py-6 text-[var(--fg-1)]">
      <header className="mb-4">
        <p className="text-[13px] uppercase tracking-[0.08em] text-[var(--fg-3)]">Branch skeleton</p>
        <p className="mt-1 text-[15px] text-[var(--fg-2)]">{message}</p>
      </header>

      <Totals skeleton={skeleton} />
      <Categories skeleton={skeleton} />
      <TouchedDirs skeleton={skeleton} />
      <Notable skeleton={skeleton} />
    </section>
  );
}

function Totals({ skeleton }: { skeleton: BranchSkeleton }) {
  const { totals } = skeleton;
  return (
    <div className="mb-5 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[14px]">
      <span className="font-medium" style={{ color: 'var(--green-11)' }}>+{totals.additions}</span>
      <span className="font-medium" style={{ color: 'var(--red-11)' }}>−{totals.deletions}</span>
      <span className="text-[var(--fg-2)]">across {totals.changedFiles} {totals.changedFiles === 1 ? 'file' : 'files'}</span>
    </div>
  );
}

function Categories({ skeleton }: { skeleton: BranchSkeleton }) {
  const entries = CATEGORY_ORDER
    .map((c) => ({ category: c, count: skeleton.byCategory[c] ?? 0 }))
    .filter((e) => e.count > 0);
  if (entries.length === 0) return null;
  return (
    <div className="mb-5">
      <h3 className="mb-2 text-[12.5px] font-semibold uppercase tracking-[0.06em] text-[var(--fg-3)]">By category</h3>
      <ul className="flex flex-wrap gap-2">
        {entries.map(({ category, count }) => (
          <li
            key={category}
            className="rounded-[6px] bg-[var(--gray-2)] px-2.5 py-1 text-[12.5px]"
            style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a4)' }}
          >
            <span className="font-medium text-[var(--fg-1)]">{CATEGORY_LABELS[category]}</span>
            <span className="ml-1.5 text-[var(--fg-3)]">{count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TouchedDirs({ skeleton }: { skeleton: BranchSkeleton }) {
  if (skeleton.touchedDirs.length === 0) return null;
  return (
    <div className="mb-5">
      <h3 className="mb-2 text-[12.5px] font-semibold uppercase tracking-[0.06em] text-[var(--fg-3)]">Touched directories</h3>
      <ul className="flex flex-col gap-1">
        {skeleton.touchedDirs.map(({ dir, count }) => (
          <li key={dir} className="flex items-center justify-between text-[13px]">
            <span className="truncate font-mono text-[var(--fg-1)]">{dir || '.'}</span>
            <span className="ml-3 text-[var(--fg-3)]">{count}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Notable({ skeleton }: { skeleton: BranchSkeleton }) {
  if (skeleton.notable.length === 0) return null;
  return (
    <div className="mb-2">
      <h3 className="mb-2 text-[12.5px] font-semibold uppercase tracking-[0.06em] text-[var(--fg-3)]">Notable changes</h3>
      <ul className="flex flex-col gap-1">
        {skeleton.notable.map((f) => (
          <li key={f.path} className="flex items-center justify-between text-[13px]">
            <span className="truncate font-mono text-[var(--fg-1)]">{f.path}</span>
            <span className="ml-3 text-[var(--fg-3)]">
              <span style={{ color: 'var(--green-11)' }}>+{f.additions}</span>{' '}
              <span style={{ color: 'var(--red-11)' }}>−{f.deletions}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Verify type-checking**

```bash
bun run --filter '@diffdad/web' build
```

Expected: build succeeds. If TypeScript complains about `WatchData.skeleton` in code paths that previously accepted partial watch data, narrow the access to inside `BranchSkeletonView` (which already guards on `watch`).

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/state/types.ts packages/web/src/components/BranchSkeletonView.tsx
git commit -m "feat(web): add BranchSkeletonView and skeleton types"
```

---

## Task 6: Render `BranchSkeletonView` before narrative arrives

**Files:**
- Modify: `packages/web/src/App.tsx:125-148` (the `mode === 'watch'` branch)

The watch-mode branch currently renders `GeneratingScreen` when `narrative` is null. Swap it for `BranchSkeletonView`. Keep the loading-message rotation.

- [ ] **Step 1: Replace `GeneratingScreen` in watch mode**

In `App.tsx`, the watch-mode branch:

```tsx
if (mode === 'watch') {
  return (
    <div className="min-h-screen bg-[var(--bg-page)] pb-20 text-[var(--fg-1)]">
      <AppBar onOpenActivity={() => setActivityOpen(true)} />
      <WatchHeader />
      <CommitTimeline />
      {narrative ? (
        view === 'story' ? <StoryView /> : <ClassicView />
      ) : (
        <BranchSkeletonView message={copy.loadingMessages[loadingMsgIndex]!} />
      )}
      <ActivityDrawer open={activityOpen} onClose={() => setActivityOpen(false)} />
      <ShortcutsHelp open={shortcutsHelpOpen} onClose={() => setShortcutsHelpOpen(false)} />
    </div>
  );
}
```

Add the import:

```tsx
import { BranchSkeletonView } from './components/BranchSkeletonView';
```

Remove the now-unused `GeneratingScreen` import only if no other branch uses it — the PR-mode branch at `:150` still does, so keep it.

- [ ] **Step 2: Build and visually verify**

```bash
bun run build
bun packages/cli/src/cli.ts watch
```

Open the browser. While the unified narrative is generating, you should see:
- `WatchHeader` with branch/base/totals
- `CommitTimeline` with "Whole branch" pill selected
- `BranchSkeletonView` with totals, categories, touched dirs, notable files

When narration completes, the skeleton view is replaced by `StoryView`.

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/App.tsx
git commit -m "$(cat <<'EOF'
feat(web): show branch skeleton before whole-branch narrative arrives

Replaces the generic GeneratingScreen in watch mode with the cheap
local-facts view, keeping the UI useful while the model runs.
EOF
)"
```

---

## Task 7: End-to-end manual verification

This is the gate before declaring the slice done.

- [ ] **Step 1: Fresh build**

```bash
bun run build
```

- [ ] **Step 2: Smoke a real branch**

Pick a branch with several commits ahead of `main`. From the diffdad repo this branch (`claude/realtime-code-review-feedback-3uWQd`) is fine.

```bash
bun packages/cli/src/cli.ts watch
```

Verify each:

- [ ] Console shows "Narrating whole branch (N commits as one story)" — NOT a per-commit list.
- [ ] Browser opens; "Whole branch" pill is selected by default.
- [ ] `BranchSkeletonView` renders immediately (totals, categories, touched dirs, notable files) — before the model finishes.
- [ ] When the unified narrative completes, `StoryView` replaces the skeleton.
- [ ] Clicking a commit chip narrates that commit on demand and switches the main pane to the commit narrative.
- [ ] Console shows "✓ whole-branch story ready (M chapters)" on completion.
- [ ] Stop with Ctrl-C; console exits cleanly.

- [ ] **Step 3: Branch movement**

In another terminal, make a small commit on the watched branch. Confirm:

- [ ] Console logs the new commit.
- [ ] Console logs "✓ whole-branch story refreshed (...)" within ~2 polling ticks.
- [ ] Browser timeline updates via SSE; the new commit appears.
- [ ] Skeleton recomputes (totals/categories include the new file).

- [ ] **Step 4: Cache hit**

Restart `dad watch` on the same branch (no new commits). Verify:

- [ ] No "Generating narrative" message — cache hit on `(repoFp, baseSha, headSha)`.
- [ ] Whole-branch story renders immediately.

- [ ] **Step 5: No commits ahead**

Check out a branch with zero commits ahead of base (e.g., main itself):

```bash
git checkout main
bun packages/cli/src/cli.ts watch
```

Verify:

- [ ] Console: "No commits ahead of <base> yet — waiting for new commits..."
- [ ] Browser shows the WatchHeader with "0 commits ahead" and a clear empty state. The skeleton is empty (zero totals, empty lists). No crash.

- [ ] **Step 6: Lint and tests**

```bash
bun run lint
bun test packages/cli/src/__tests__/
```

Both green.

- [ ] **Step 7: Final commit (if any cleanup)**

If the verification turned up small fixes, commit them with a clear message. Otherwise the slice is done.

---

## Out of scope (do NOT do here)

These are listed in `docs/dad-watch.md` as "Build now" items 4-10 or "Consider and add later". They are deferred:

- Calibrated review items (concerns/missing/verify) — needs the comprehension+scrutiny prompt rewrite, separate plan.
- Latest-commit "what just changed" companion behavior — stays on the simpler "regenerate whole branch" path for the walking skeleton.
- Feedback objects, agent-readable feedback store, MCP surface.
- Manual resolution and dismissal UI.
- Eager mode (`--eager`) for narrating all commits on short branches.
- Working-tree auto-watch.
- GitHub publishing (`dad publish`).
- Stronger cross-rebase anchoring.

A new plan should pick the next slice — likely the prompt rewrite + review-item schema, since that's load-bearing for everything downstream.

---

## Spike findings

**Verdict: keep the split, defer extraction.**

Routes verified against `server.ts` and `watch-server.ts` — match the expected list in Task 0 Step 1 exactly (PR mode: 7 API routes + static; watch mode: 4 API routes + static). API surfaces meaningfully diverge: watch mode has zero GitHub I/O (no `/api/checks`, `/api/comments`, `/api/review`, no `/api/ai`), while PR mode has none of watch's selection-driven payload, on-demand `POST /api/narrative/{unified,commit}` kicks, or commit-narration SSE events. The two `/api/narrative` handlers and the two `/api/events` handlers share names but not contracts — collapsing them would mean a router with `if (mode === 'watch')` branches in every handler.

Genuinely duplicated plumbing is ~30 lines across the two files: the SSE writer/controller/abort wiring (~15 lines — PR mode then layers a 10s GitHub poll and a shutdown-joke timer on top, neither of which belongs in watch mode) and the `webDist` candidate resolution + `serveStatic` mount + SPA fallback (~16 lines, near-identical). Order-of-magnitude matches the plan's "~40 lines" estimate.

**Optional follow-up (out of scope for this plan):** a small `packages/cli/src/server-utils.ts` exporting `attachStaticAssets(app)` and `makeSseHandler({ onConnect, onAbort })` would erase the duplication without forcing the surfaces to converge. Cosmetic only — does not unlock any spec item, so it is deferred.

---

## Self-review checklist

**Spec coverage:**
- Build-now item 1 (whole-branch primary) → Tasks 3, 4, 6.
- Build-now item 2 (immediate local skeleton) → Tasks 1, 2, 5, 6.
- Build-now item 3 (whole-branch narrative + cache) → Task 4 (auto-fire); Task 6 (renders it). Cache plumbing already exists.
- Spike requested by the brief → Task 0.

**No placeholders:** every step shows the actual code or the actual command. No "TBD" or "implement appropriately."

**Type consistency:** `BranchSkeleton`, `SkeletonFile`, `FileCategory` (CLI side) ↔ `BranchSkeleton`, `SkeletonFile`, `SkeletonFileCategory` (web side) — names diverge intentionally because the web side avoids the bare-word `FileCategory` collision with general DOM types. Field names match exactly. `WatchData.skeleton` is non-optional on both sides because the server always sends one (empty when zero commits — verify in Task 7 Step 5; if it crashes, make it optional and adjust `BranchSkeletonView` to render an empty state).

**Risks the plan already names:**
- Empty branch (zero commits) — Task 7 Step 5 verifies the skeleton handles it without crashing.
- Cache hit on cold start — Task 7 Step 4 verifies.
- Polling-tick race between unified narration in flight and a new commit landing — `narrateUnified` early-returns when `ctx.unifiedGenerating`; the next tick will pick up the fresher key. Confirmed by reading the existing implementation; no code change.
