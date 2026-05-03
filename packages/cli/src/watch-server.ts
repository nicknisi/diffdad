import { existsSync } from 'fs';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { dirname, resolve } from 'path';
import { readConfig } from './config';
import {
  cacheCommitNarrative,
  cacheUnifiedNarrative,
  getCachedCommitNarrative,
  getCachedUnifiedNarrative,
} from './narrative/cache';
import { generateNarrative } from './narrative/engine';
import type { NarrativeResponse } from './narrative/types';
import { parseDiff } from './github/diff-parser';
import type { DiffFile, PRMetadata } from './github/types';
import {
  getDiffForCommit,
  getDiffForRange,
  getCommitStats,
  type LocalCommit,
} from './git/local';
import { buildBranchSkeleton, type BranchSkeleton } from './watch/skeleton';

export type WatchServerContext = {
  repoRoot: string;
  repoFp: string;
  branch: string;
  base: string;
  baseSha: string;
  headSha: string;
  commits: LocalCommit[];
  narratives: Map<string, NarrativeResponse>;
  unified: NarrativeResponse | null;
  unifiedKey: string | null;
  generating: Set<string>;
  unifiedGenerating: boolean;
  remoteSlug: { owner: string; repo: string } | null;
  skeleton: BranchSkeleton | null;
  skeletonKey: string | null;
};

type CommitSummary = {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  date: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  hasNarrative: boolean;
};

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

function syntheticPrForCommit(ctx: WatchServerContext, commit: LocalCommit, files: DiffFile[]): PRMetadata {
  const totals = files.reduce(
    (acc, f) => {
      for (const h of f.hunks) {
        for (const l of h.lines) {
          if (l.type === 'add') acc.additions += 1;
          else if (l.type === 'remove') acc.deletions += 1;
        }
      }
      return acc;
    },
    { additions: 0, deletions: 0 },
  );

  return {
    number: 0,
    title: commit.subject || commit.shortSha,
    body: commit.body,
    state: 'open',
    draft: false,
    author: { login: commit.author.name, avatarUrl: '' },
    branch: ctx.branch,
    base: ctx.base,
    labels: [],
    createdAt: commit.date,
    updatedAt: commit.date,
    additions: totals.additions,
    deletions: totals.deletions,
    changedFiles: files.length,
    commits: 1,
    headSha: commit.sha,
  };
}

function syntheticPrForUnified(ctx: WatchServerContext, files: DiffFile[]): PRMetadata {
  const subject = `${ctx.branch} → ${ctx.base}`;
  const body =
    ctx.commits.length > 0
      ? ctx.commits.map((c) => `${c.shortSha} ${c.subject}`).join('\n')
      : '(no commits)';
  const totals = files.reduce(
    (acc, f) => {
      for (const h of f.hunks) {
        for (const l of h.lines) {
          if (l.type === 'add') acc.additions += 1;
          else if (l.type === 'remove') acc.deletions += 1;
        }
      }
      return acc;
    },
    { additions: 0, deletions: 0 },
  );
  const last = ctx.commits[ctx.commits.length - 1];

  return {
    number: 0,
    title: subject,
    body,
    state: 'open',
    draft: false,
    author: { login: last?.author.name ?? '', avatarUrl: '' },
    branch: ctx.branch,
    base: ctx.base,
    labels: [],
    createdAt: ctx.commits[0]?.date ?? new Date().toISOString(),
    updatedAt: last?.date ?? new Date().toISOString(),
    additions: totals.additions,
    deletions: totals.deletions,
    changedFiles: files.length,
    commits: ctx.commits.length,
    headSha: ctx.headSha,
  };
}

async function loadFilesForCommit(repoRoot: string, sha: string): Promise<DiffFile[]> {
  const raw = await getDiffForCommit(sha, repoRoot);
  return parseDiff(raw);
}

async function loadFilesForRange(repoRoot: string, base: string, head: string): Promise<DiffFile[]> {
  const raw = await getDiffForRange(base, head, repoRoot);
  return parseDiff(raw);
}

function commitSummary(ctx: WatchServerContext, c: LocalCommit, stats: { additions: number; deletions: number; changedFiles: number }): CommitSummary {
  return {
    sha: c.sha,
    shortSha: c.shortSha,
    subject: c.subject,
    author: c.author.name,
    date: c.date,
    additions: stats.additions,
    deletions: stats.deletions,
    changedFiles: stats.changedFiles,
    hasNarrative: ctx.narratives.has(c.sha),
  };
}

export function createWatchServer(ctx: WatchServerContext) {
  const app = new Hono();
  type SseClient = (event: string, data: unknown) => void;
  const sseClients = new Set<SseClient>();
  const commitStats = new Map<string, { additions: number; deletions: number; changedFiles: number }>();

  function broadcast(event: string, data: unknown) {
    for (const send of sseClients) send(event, data);
  }

  async function getCommitStatsCached(sha: string): Promise<{ additions: number; deletions: number; changedFiles: number }> {
    const cached = commitStats.get(sha);
    if (cached) return cached;
    const stats = await getCommitStats(sha, ctx.repoRoot);
    commitStats.set(sha, stats);
    return stats;
  }

  async function buildCommitSummaries(): Promise<CommitSummary[]> {
    const out: CommitSummary[] = [];
    for (const c of ctx.commits) {
      const stats = await getCommitStatsCached(c.sha);
      out.push(commitSummary(ctx, c, stats));
    }
    return out;
  }

  async function getSkeleton(): Promise<BranchSkeleton> {
    const key = `${ctx.baseSha}:${ctx.headSha}`;
    if (ctx.skeleton && ctx.skeletonKey === key) return ctx.skeleton;
    const files = await loadFilesForRange(ctx.repoRoot, ctx.base, ctx.headSha);
    const skeleton = buildBranchSkeleton(files);
    ctx.skeleton = skeleton;
    ctx.skeletonKey = key;
    return skeleton;
  }

  async function narrateCommit(sha: string, opts: { broadcastWhenDone?: boolean } = {}): Promise<NarrativeResponse | null> {
    if (ctx.narratives.has(sha)) return ctx.narratives.get(sha)!;
    if (ctx.generating.has(sha)) return null;

    const cached = await getCachedCommitNarrative(ctx.repoFp, sha);
    if (cached) {
      ctx.narratives.set(sha, cached);
      if (opts.broadcastWhenDone) {
        broadcast('commit-narrative', { sha });
      }
      return cached;
    }

    const commit = ctx.commits.find((c) => c.sha === sha);
    if (!commit) return null;

    ctx.generating.add(sha);
    broadcast('commit-narrating', { sha });
    try {
      const config = await readConfig();
      const files = await loadFilesForCommit(ctx.repoRoot, sha);
      const pr = syntheticPrForCommit(ctx, commit, files);
      const { narrative } = await generateNarrative(pr, files, [], config, undefined, 'scrutinize');
      ctx.narratives.set(sha, narrative);
      await cacheCommitNarrative(ctx.repoFp, sha, narrative);
      if (opts.broadcastWhenDone) {
        broadcast('commit-narrative', { sha });
      }
      return narrative;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  \x1b[38;5;204m✗\x1b[0m Narration failed for ${sha.slice(0, 7)}: ${msg}`);
      broadcast('commit-narrate-error', { sha, message: msg });
      return null;
    } finally {
      ctx.generating.delete(sha);
    }
  }

  async function narrateUnified(): Promise<NarrativeResponse | null> {
    const key = `${ctx.baseSha}:${ctx.headSha}`;
    if (ctx.unified && ctx.unifiedKey === key) return ctx.unified;
    if (ctx.unifiedGenerating) return null;

    const cached = await getCachedUnifiedNarrative(ctx.repoFp, ctx.baseSha, ctx.headSha);
    if (cached) {
      ctx.unified = cached;
      ctx.unifiedKey = key;
      broadcast('unified-narrative', { ready: true });
      return cached;
    }

    ctx.unifiedGenerating = true;
    broadcast('unified-narrating', {});
    try {
      const config = await readConfig();
      const files = await loadFilesForRange(ctx.repoRoot, ctx.base, ctx.headSha);
      const pr = syntheticPrForUnified(ctx, files);
      const { narrative } = await generateNarrative(pr, files, [], config, undefined, 'scrutinize');
      ctx.unified = narrative;
      ctx.unifiedKey = key;
      await cacheUnifiedNarrative(ctx.repoFp, ctx.baseSha, ctx.headSha, narrative);
      broadcast('unified-narrative', { ready: true });
      return narrative;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  \x1b[38;5;204m✗\x1b[0m Unified narration failed: ${msg}`);
      broadcast('unified-narrate-error', { message: msg });
      return null;
    } finally {
      ctx.unifiedGenerating = false;
    }
  }

  async function refreshCommits(newCommits: LocalCommit[], newHeadSha: string) {
    const previousShas = new Set(ctx.commits.map((c) => c.sha));
    ctx.commits = newCommits;
    ctx.headSha = newHeadSha;
    // Drop unified — branch moved.
    ctx.unified = null;
    ctx.unifiedKey = null;
    ctx.skeleton = null;
    ctx.skeletonKey = null;
    const newShas = new Set(newCommits.map((c) => c.sha));
    const dropStats: string[] = [];
    for (const sha of commitStats.keys()) {
      if (!newShas.has(sha)) dropStats.push(sha);
    }
    for (const sha of dropStats) commitStats.delete(sha);

    const dropNarratives: string[] = [];
    for (const sha of ctx.narratives.keys()) {
      if (!newShas.has(sha)) dropNarratives.push(sha);
    }
    for (const sha of dropNarratives) ctx.narratives.delete(sha);

    const summaries = await buildCommitSummaries();
    broadcast('watch-update', {
      branch: ctx.branch,
      base: ctx.base,
      baseSha: ctx.baseSha,
      headSha: ctx.headSha,
      commits: summaries,
    });

    // Narrate any new commits in background (oldest first).
    for (const c of newCommits) {
      if (previousShas.has(c.sha)) continue;
      void narrateCommit(c.sha, { broadcastWhenDone: true });
    }
  }

  async function selectionFromQuery(c: { req: { query: (k: string) => string | undefined } }): Promise<{
    selection: WatchPayload['selection'];
    narrative: NarrativeResponse | null;
    files: DiffFile[];
    pr: PRMetadata;
  }> {
    const sha = c.req.query('sha');
    const mode = c.req.query('mode');

    if (mode === 'unified') {
      const files = await loadFilesForRange(ctx.repoRoot, ctx.base, ctx.headSha);
      const pr = syntheticPrForUnified(ctx, files);
      const ready = ctx.unified && ctx.unifiedKey === `${ctx.baseSha}:${ctx.headSha}`;
      return {
        selection: { kind: 'unified' },
        narrative: ready ? ctx.unified : null,
        files,
        pr,
      };
    }

    const targetSha = sha ?? ctx.commits[ctx.commits.length - 1]?.sha;
    if (!targetSha) {
      // No commits yet — return an empty placeholder.
      return {
        selection: { kind: 'pending' },
        narrative: null,
        files: [],
        pr: syntheticPrForUnified(ctx, []),
      };
    }
    const commit = ctx.commits.find((cm) => cm.sha === targetSha) ?? ctx.commits[ctx.commits.length - 1]!;
    const files = await loadFilesForCommit(ctx.repoRoot, commit.sha);
    const pr = syntheticPrForCommit(ctx, commit, files);
    const narrative = ctx.narratives.get(commit.sha) ?? null;
    return {
      selection: { kind: 'commit', sha: commit.sha },
      narrative,
      files,
      pr,
    };
  }

  app.get('/api/narrative', async (c) => {
    const config = await readConfig();
    const summaries = await buildCommitSummaries();
    const skeleton = await getSkeleton();
    const { selection, narrative, files, pr } = await selectionFromQuery(c);
    const unifiedReady = !!(ctx.unified && ctx.unifiedKey === `${ctx.baseSha}:${ctx.headSha}`);

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

    const repoUrl = ctx.remoteSlug
      ? `https://github.com/${ctx.remoteSlug.owner}/${ctx.remoteSlug.repo}`
      : '';

    const body: Record<string, unknown> = {
      mode: 'watch',
      pr,
      files,
      comments: [],
      checkRuns: [],
      reviews: [],
      repoUrl,
      watch,
      config: {
        theme: config.theme ?? 'auto',
        storyStructure: config.storyStructure ?? 'chapters',
        layoutMode: config.layoutMode ?? 'toc',
        displayDensity: config.displayDensity ?? 'comfortable',
        defaultNarrationDensity: config.defaultNarrationDensity ?? 'normal',
        clusterBots: config.clusterBots ?? true,
        accent: config.accent ?? 'classic',
      },
    };

    if (narrative) {
      body.narrative = narrative;
    } else {
      body.generating = true;
    }
    return c.json(body);
  });

  app.post('/api/narrative/unified', async (c) => {
    void narrateUnified();
    return c.json({ ok: true, generating: ctx.unifiedGenerating });
  });

  app.post('/api/narrative/commit', async (c) => {
    let payload: { sha?: string };
    try {
      payload = (await c.req.json()) as { sha?: string };
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (!payload.sha) return c.json({ error: "missing 'sha'" }, 400);
    if (!ctx.commits.some((c) => c.sha === payload.sha)) {
      return c.json({ error: 'unknown commit' }, 404);
    }
    void narrateCommit(payload.sha, { broadcastWhenDone: true });
    return c.json({ ok: true });
  });

  app.get('/api/events', (c) => {
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = (event: string, data: unknown) => {
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            // controller closed
          }
        };

        send('connected', { timestamp: Date.now() });
        sseClients.add(send);

        c.req.raw.signal.addEventListener('abort', () => {
          sseClients.delete(send);
          try {
            controller.close();
          } catch {
            // already closed
          }
        });
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  });

  const candidates = [
    resolve(import.meta.dir, '../../web/dist'),
    resolve(dirname(process.execPath), 'packages', 'web', 'dist'),
    resolve(dirname(process.execPath), 'share', 'diffdad', 'web'),
    resolve(dirname(process.execPath), '..', 'share', 'diffdad', 'web'),
  ];
  const webDist = candidates.find((p) => existsSync(p)) ?? candidates[0]!;

  app.use(
    '/*',
    serveStatic({
      root: webDist,
      rewriteRequestPath: (path) => (path === '/' ? '/index.html' : path),
    }),
  );
  app.get('/*', serveStatic({ root: webDist, path: 'index.html' }));

  return { app, broadcast, narrateCommit, narrateUnified, refreshCommits };
}
