import { existsSync } from 'fs';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { dirname, resolve } from 'path';
import { readConfig } from './config';
import type { GitHubClient } from './github/client';
import { mapCommentsToChapters } from './github/comments';
import type { CheckRun, DiffFile, PRComment, PRMetadata, PRReview } from './github/types';
import { callAi } from './narrative/engine';
import type { NarrativeResponse } from './narrative/types';

export type ServerContext = {
  narrative: NarrativeResponse;
  pr: PRMetadata;
  files: DiffFile[];
  comments: PRComment[];
  checkRuns: CheckRun[];
  reviews: PRReview[];
  github: GitHubClient;
  owner: string;
  repo: string;
  headSha: string;
};

type PostCommentBody = {
  body?: string;
  path?: string;
  line?: number;
  side?: 'LEFT' | 'RIGHT';
  commitId?: string;
};

export function createServer(ctx: ServerContext) {
  const app = new Hono();
  type SseClient = (event: string, data: unknown) => void;
  const sseClients = new Set<SseClient>();

  function broadcast(event: string, data: unknown) {
    for (const send of sseClients) {
      send(event, data);
    }
  }

  app.get('/api/narrative', async (c) => {
    const config = await readConfig();
    const commentPaths = [...new Set(ctx.comments.map((cm) => cm.path).filter((p): p is string => Boolean(p)))];
    const diffFiles = ctx.files.map((f) => f.file);
    const narrativeFiles = [
      ...new Set(
        ctx.narrative.chapters.flatMap((ch) =>
          ch.sections.filter((s): s is Extract<typeof s, { type: 'diff' }> => s.type === 'diff').map((s) => s.file),
        ),
      ),
    ];
    return c.json({
      narrative: ctx.narrative,
      pr: ctx.pr,
      files: ctx.files,
      comments: mapCommentsToChapters(ctx.comments, ctx.narrative),
      checkRuns: ctx.checkRuns,
      reviews: ctx.reviews,
      repoUrl: `https://github.com/${ctx.owner}/${ctx.repo}`,
      config: {
        storyStructure: config.storyStructure ?? 'chapters',
        layoutMode: config.layoutMode ?? 'toc',
        displayDensity: config.displayDensity ?? 'comfortable',
        defaultNarrationDensity: config.defaultNarrationDensity ?? 'normal',
        clusterBots: config.clusterBots ?? true,
      },
      _debug: {
        totalComments: ctx.comments.length,
        commentPaths,
        diffFiles,
        narrativeFiles,
        inlineComments: ctx.comments
          .filter((cm) => cm.path && cm.line !== undefined)
          .map((cm) => ({ path: cm.path, line: cm.line, side: cm.side, author: cm.author })),
        narrativeHunks: ctx.narrative.chapters.flatMap((ch, ci) =>
          ch.sections
            .filter((s): s is Extract<typeof s, { type: 'diff' }> => s.type === 'diff')
            .map((s) => {
              const f = ctx.files.find((df) => df.file === s.file);
              const h = f?.hunks[s.hunkIndex];
              return {
                chapter: ci,
                file: s.file,
                hunkIndex: s.hunkIndex,
                newStart: h?.newStart,
                newEnd: h ? h.newStart + h.newCount - 1 : undefined,
                oldStart: h?.oldStart,
                oldEnd: h ? h.oldStart + h.oldCount - 1 : undefined,
                found: !!h,
              };
            }),
        ),
      },
    });
  });

  app.post('/api/ai', async (c) => {
    let body: {
      action?: string;
      chapterIndex?: number;
      question?: string;
      lens?: string;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }

    const { action, chapterIndex, question, lens } = body;

    if (typeof chapterIndex !== 'number') {
      return c.json({ error: 'missing chapterIndex' }, 400);
    }

    const chapter = ctx.narrative.chapters[chapterIndex];
    if (!chapter) return c.json({ error: 'invalid chapter' }, 400);

    // hunkIndex is per-file (index into DiffFile.hunks), not a flat index
    // across all files. Look up by file + index.
    const filesByPath = new Map(ctx.files.map((f) => [f.file, f]));
    const chapterDiff = chapter.sections
      .filter((s): s is Extract<typeof s, { type: 'diff' }> => s.type === 'diff')
      .map((s) => {
        const diffFile = filesByPath.get(s.file);
        if (!diffFile) return '';
        const hunk = diffFile.hunks[s.hunkIndex];
        if (!hunk) return '';
        return (
          `--- ${diffFile.file} ---\n` +
          hunk.lines
            .map((l) => {
              const prefix = l.type === 'add' ? '+' : l.type === 'remove' ? '-' : ' ';
              return prefix + l.content;
            })
            .join('\n')
        );
      })
      .join('\n\n');

    const config = await readConfig();

    let systemPrompt: string;
    let userPrompt: string;

    if (action === 'ask') {
      if (!question || typeof question !== 'string') {
        return c.json({ error: 'missing question' }, 400);
      }
      systemPrompt =
        'You are a code review assistant. Answer questions about the code changes concisely. Use markdown.';
      userPrompt = `Chapter: ${chapter.title}\n\nNarration: ${chapter.summary}\n\nDiff:\n${chapterDiff}\n\nQuestion: ${question}`;
    } else if (action === 'renarrate') {
      if (!lens || typeof lens !== 'string') {
        return c.json({ error: 'missing lens' }, 400);
      }
      const densityLenses = ['terse', 'normal', 'verbose'];
      const isDensity = densityLenses.includes(lens);
      if (isDensity) {
        const sizing =
          lens === 'terse'
            ? 'One sentence max.'
            : lens === 'verbose'
              ? 'One detailed paragraph.'
              : 'Two to three sentences.';
        systemPrompt = `You are a code review narrator. Rewrite this chapter narration in a ${lens} style. ${sizing} Use markdown.`;
      } else {
        systemPrompt = `You are a code review narrator. Re-narrate through a ${lens} lens. Focus on what matters from that perspective. 2-3 sentences, markdown.`;
      }
      userPrompt = `Chapter: ${chapter.title}\n\nOriginal: ${chapter.summary}\n\nDiff:\n${chapterDiff}`;
    } else {
      return c.json({ error: 'unknown action' }, 400);
    }

    try {
      const result = await callAi(config, systemPrompt, userPrompt);
      return c.json({ text: result.text });
    } catch (err) {
      return c.json({ error: `AI request failed: ${(err as Error).message}` }, 500);
    }
  });

  app.get('/api/checks', async (c) => {
    const fresh = await ctx.github.getCheckRuns(ctx.owner, ctx.repo, ctx.headSha);
    ctx.checkRuns = fresh;
    return c.json(fresh);
  });

  app.get('/api/comments', async (c) => {
    const fresh = await ctx.github.getComments(ctx.owner, ctx.repo, ctx.pr.number);
    ctx.comments = fresh;
    return c.json(mapCommentsToChapters(fresh, ctx.narrative));
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

        const interval = setInterval(async () => {
          try {
            const fresh = await ctx.github.getComments(ctx.owner, ctx.repo, ctx.pr.number);
            const prevIds = new Set(ctx.comments.map((cm) => cm.id));
            const freshIds = new Set(fresh.map((cm) => cm.id));
            const hasNew = fresh.some((cm) => !prevIds.has(cm.id));
            const hasDeleted = ctx.comments.some((cm) => !freshIds.has(cm.id));
            if (hasNew || hasDeleted) {
              send('comments', fresh);
            }
            ctx.comments = fresh;

            const freshChecks = await ctx.github.getCheckRuns(ctx.owner, ctx.repo, ctx.headSha);
            ctx.checkRuns = freshChecks;
            send('checks', freshChecks);

            const freshReviews = await ctx.github.getReviews(ctx.owner, ctx.repo, ctx.pr.number);
            ctx.reviews = freshReviews;
            send('reviews', freshReviews);
          } catch {
            // swallow polling errors
          }
        }, 10000);

        c.req.raw.signal.addEventListener('abort', () => {
          clearInterval(interval);
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

  app.post('/api/comments', async (c) => {
    let payload: PostCommentBody;
    try {
      payload = (await c.req.json()) as PostCommentBody;
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }

    if (!payload.body || typeof payload.body !== 'string') {
      return c.json({ error: "missing 'body'" }, 400);
    }

    const posted = await ctx.github.postComment(
      ctx.owner,
      ctx.repo,
      ctx.pr.number,
      payload.body,
      payload.path && payload.line
        ? {
            path: payload.path,
            line: payload.line,
            side: payload.side ?? 'RIGHT',
            commitId: payload.commitId ?? ctx.headSha,
          }
        : undefined,
    );
    ctx.comments = [...ctx.comments, posted];
    broadcast('comment', posted);
    return c.json(posted, 201);
  });

  app.post('/api/review', async (c) => {
    let payload: { event?: string; body?: string };
    try {
      payload = (await c.req.json()) as { event?: string; body?: string };
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const eventMap: Record<string, 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'> = {
      comment: 'COMMENT',
      approve: 'APPROVE',
      request_changes: 'REQUEST_CHANGES',
    };
    const ghEvent = payload.event ? eventMap[payload.event] : undefined;
    if (!ghEvent) return c.json({ error: 'invalid event' }, 400);

    try {
      await ctx.github.submitReview(ctx.owner, ctx.repo, ctx.pr.number, ghEvent, payload.body);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Can not approve your own')) {
        return c.json({ error: "You can't approve your own pull request" }, 422);
      }
      return c.json({ error: msg }, 500);
    }
    broadcast('review', { event: ghEvent, body: payload.body });
    return c.json({ ok: true });
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

  // SPA fallback: any unmatched route serves index.html
  app.get('/*', serveStatic({ root: webDist, path: 'index.html' }));

  return app;
}
