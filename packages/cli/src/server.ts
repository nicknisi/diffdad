import { existsSync } from 'fs';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { dirname, resolve } from 'path';
import { readConfig } from './config';
import type { GitHubClient } from './github/client';
import { mapCommentsToChapters } from './github/comments';
import type { CheckRun, DiffFile, PRComment, PRMetadata, PRReview } from './github/types';
import { cacheNarrative, computePromptMetaHash, getCachedNarrative } from './narrative/cache';
import { callAi, generateNarrative, resolveAiPath, resolveProviderKey } from './narrative/engine';
import type { NarrativeResponse } from './narrative/types';
import { cacheRecap } from './recap/cache';
import { generateRecap } from './recap/engine';
import { gatherRecapSources } from './recap/sources';
import type { RecapResponse } from './recap/types';

export type ServerContext = {
  narrative: NarrativeResponse | null;
  pr: PRMetadata;
  files: DiffFile[];
  comments: PRComment[];
  checkRuns: CheckRun[];
  reviews: PRReview[];
  github: GitHubClient;
  owner: string;
  repo: string;
  headSha: string;
  /** Populated lazily when the user opens the Recap tab (or hydrated from cache at startup). */
  recap?: RecapResponse | null;
  /** Set while a recap is being generated; cleared on success or failure. */
  recapGenerating?: boolean;
  /** Set if the last recap generation attempt failed; cleared on retry. */
  recapError?: string | null;
};

type PostCommentBody = {
  body?: string;
  path?: string;
  line?: number;
  side?: 'LEFT' | 'RIGHT';
  startLine?: number;
  startSide?: 'LEFT' | 'RIGHT';
  commitId?: string;
  inReplyToId?: number;
};

export function createServer(ctx: ServerContext) {
  const app = new Hono();
  type SseClient = (event: string, data: unknown) => void;
  const sseClients = new Set<SseClient>();
  let hadClients = false;
  let exitTimer: ReturnType<typeof setTimeout> | null = null;

  let narrativeProgressChars = 0;

  function broadcast(event: string, data: unknown) {
    if (event === 'narrative-progress') {
      narrativeProgressChars = (data as { chars?: number }).chars ?? 0;
    } else if (event === 'regenerating' || event === 'narrative') {
      narrativeProgressChars = 0;
    }
    for (const send of sseClients) {
      send(event, data);
    }
  }

  app.get('/api/narrative', async (c) => {
    const config = await readConfig();
    const { path: aiPath } = resolveAiPath(config);
    if (!ctx.narrative) {
      return c.json({
        generating: true,
        pr: ctx.pr,
        files: ctx.files,
        comments: ctx.comments,
        checkRuns: ctx.checkRuns,
        reviews: ctx.reviews,
        repoUrl: `https://github.com/${ctx.owner}/${ctx.repo}`,
        aiPath,
        config: {
          theme: config.theme ?? 'auto',
          storyStructure: config.storyStructure ?? 'chapters',
          layoutMode: config.layoutMode ?? 'toc',
          displayDensity: config.displayDensity ?? 'comfortable',
          defaultNarrationDensity: config.defaultNarrationDensity ?? 'normal',
          clusterBots: config.clusterBots ?? true,
          accent: config.accent ?? 'classic',
        },
      });
    }
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
      aiPath,
      config: {
        theme: config.theme ?? 'auto',
        storyStructure: config.storyStructure ?? 'chapters',
        layoutMode: config.layoutMode ?? 'toc',
        displayDensity: config.displayDensity ?? 'comfortable',
        defaultNarrationDensity: config.defaultNarrationDensity ?? 'normal',
        clusterBots: config.clusterBots ?? true,
        accent: config.accent ?? 'classic',
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

  // Kick off a recap generation in the background. Idempotent: subsequent calls
  // while one is in flight or already completed are no-ops.
  async function startRecapGeneration() {
    if (ctx.recap || ctx.recapGenerating) return;
    ctx.recapGenerating = true;
    ctx.recapError = null;
    broadcast('recap-generating', { generating: true });
    try {
      const config = await readConfig();
      const sources = await gatherRecapSources(ctx.github, ctx.owner, ctx.repo, ctx.pr.number);
      const { recap } = await generateRecap(sources, config);
      ctx.recap = recap;
      await cacheRecap(ctx.owner, ctx.repo, ctx.pr.number, ctx.headSha, recap);
      broadcast('recap', { recap });
    } catch (err) {
      ctx.recapError = err instanceof Error ? err.message : String(err);
      broadcast('recap-error', { error: ctx.recapError });
    } finally {
      ctx.recapGenerating = false;
    }
  }

  app.get('/api/recap', async (c) => {
    if (ctx.recap) return c.json({ status: 'ready', recap: ctx.recap });
    if (ctx.recapError) return c.json({ status: 'error', error: ctx.recapError });
    if (ctx.recapGenerating) return c.json({ status: 'generating' });
    return c.json({ status: 'idle' });
  });

  app.post('/api/recap', async (c) => {
    if (!ctx.recap && !ctx.recapGenerating) {
      // fire-and-forget; the client polls GET /api/recap (or listens via SSE)
      void startRecapGeneration();
    }
    if (ctx.recap) return c.json({ status: 'ready', recap: ctx.recap });
    return c.json({ status: 'generating' });
  });

  app.post('/api/ai', async (c) => {
    let body: {
      action?: string;
      chapterIndex?: number;
      question?: string;
      lens?: string;
      resolution?: 'comment' | 'approve' | 'request_changes';
      reviewedChapters?: number[];
      pendingComments?: { path?: string; line?: number; body?: string }[];
      userDraft?: string;
    };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }

    const { action } = body;
    const config = await readConfig();

    if (action === 'summarize') {
      if (!ctx.narrative) return c.json({ error: 'narrative still generating' }, 503);
      const resolution = body.resolution ?? 'comment';
      const reviewed = Array.isArray(body.reviewedChapters)
        ? body.reviewedChapters.filter((i): i is number => typeof i === 'number')
        : [];
      const drafts = Array.isArray(body.pendingComments) ? body.pendingComments : [];

      const reviewedSection =
        reviewed.length > 0
          ? reviewed
              .map((idx) => {
                const ch = ctx.narrative!.chapters[idx];
                if (!ch) return '';
                return `- Chapter ${idx + 1} — ${ch.title}: ${ch.summary}`;
              })
              .filter(Boolean)
              .join('\n')
          : '(no chapters explicitly marked reviewed)';

      const draftSection =
        drafts.length > 0
          ? drafts
              .filter((d) => d.body)
              .map((d) => `- ${d.path ?? 'general'}${d.line ? `:L${d.line}` : ''} — ${(d.body ?? '').slice(0, 240)}`)
              .join('\n')
          : '(no inline comments drafted)';

      const tldr = ctx.narrative.tldr ?? '';
      const concerns = (ctx.narrative.concerns ?? [])
        .map((cn) => `- ${cn.category}: ${cn.question} (${cn.file}:${cn.line})`)
        .join('\n');

      const stance =
        resolution === 'approve'
          ? 'You are approving this PR. Open with confident endorsement, then briefly highlight the strengths the reviewer noted. If there are any minor comments, frame them as nits, not blockers.'
          : resolution === 'request_changes'
            ? 'You are requesting changes. Lead with the specific blockers the reviewer raised (drawn from inline comments). Be direct but constructive.'
            : 'You are leaving general feedback without a verdict. Summarize what was reviewed and the open questions the reviewer raised.';

      const userDraft = typeof body.userDraft === 'string' ? body.userDraft.trim() : '';
      const polishing = userDraft.length > 0;

      // When the reviewer has already typed something, preserve their voice
      // and points; we polish their draft. Otherwise, generate from scratch.
      const systemPrompt = polishing
        ? `You are polishing a reviewer's draft of a GitHub PR review summary. ${stance} Keep the reviewer's voice, structure, and any specific points they made. Tighten prose, fix grammar, and fold in 1–2 supporting details from the review context only if they directly reinforce what the reviewer wrote — do not introduce unrelated topics. Return only the polished text. 2–4 sentences. First-person ("I"). Plain markdown. No headings. No bullet lists. No greetings or sign-offs.`
        : `You are drafting the summary comment for a GitHub PR review. ${stance} Write 2–4 sentences. First-person ("I"). Plain markdown. No headings. No bullet lists. No greetings or sign-offs.`;
      const userPrompt = polishing
        ? `Reviewer's draft (polish this — preserve their voice and points):\n"""\n${userDraft}\n"""\n\nReview context (use only for grammar/wording cues; do not introduce new topics):\n\nPR TLDR:\n${tldr}\n\nReviewed chapters:\n${reviewedSection}\n\nDrafted inline comments:\n${draftSection}\n\nConcerns the narrative raised:\n${concerns || '(none)'}`
        : `PR TLDR:\n${tldr}\n\nReviewed chapters:\n${reviewedSection}\n\nDrafted inline comments:\n${draftSection}\n\nConcerns the narrative raised:\n${concerns || '(none)'}`;

      try {
        const result = await callAi(config, systemPrompt, userPrompt);
        return c.json({ text: result.text.trim() });
      } catch (err) {
        return c.json({ error: `AI request failed: ${(err as Error).message}` }, 500);
      }
    }

    const { chapterIndex, question, lens } = body;

    if (typeof chapterIndex !== 'number') {
      return c.json({ error: 'missing chapterIndex' }, 400);
    }

    if (!ctx.narrative) return c.json({ error: 'narrative still generating' }, 503);
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
    return c.json(ctx.narrative ? mapCommentsToChapters(fresh, ctx.narrative) : fresh);
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
        if (narrativeProgressChars > 0) send('narrative-progress', { chars: narrativeProgressChars });
        sseClients.add(send);
        hadClients = true;
        if (exitTimer) {
          clearTimeout(exitTimer);
          exitTimer = null;
        }

        let regenerating = false;
        const interval = setInterval(async () => {
          try {
            const freshPr = await ctx.github.getPR(ctx.owner, ctx.repo, ctx.pr.number);
            const shaChanged = freshPr.headSha !== ctx.headSha;

            // These fields feed into the narrative prompt — changes here mean
            // the cached narrative is stale and we need to regenerate.
            const promptMetaChanged =
              freshPr.title !== ctx.pr.title ||
              freshPr.body !== ctx.pr.body ||
              freshPr.labels.join(',') !== ctx.pr.labels.join(',');
            const otherMetaChanged = freshPr.draft !== ctx.pr.draft || freshPr.state !== ctx.pr.state;
            // If the regen branch below will fire, it'll broadcast the fresh PR
            // alongside the new narrative — skip the standalone 'pr' event then.
            const willRegenerate = (shaChanged || promptMetaChanged) && !regenerating;
            if ((promptMetaChanged || otherMetaChanged) && !shaChanged && !willRegenerate) {
              ctx.pr = freshPr;
              send('pr', ctx.pr);
            }

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

            if ((shaChanged || promptMetaChanged) && !regenerating) {
              regenerating = true;
              const prevSha = ctx.headSha.slice(0, 7);
              const newSha = freshPr.headSha.slice(0, 7);
              if (shaChanged) {
                console.log(`\n  \x1b[38;5;221m↻\x1b[0m New commits detected \x1b[2m(${prevSha} → ${newSha})\x1b[0m`);
              } else {
                console.log(`\n  \x1b[38;5;221m↻\x1b[0m PR title/description/labels changed`);
              }
              console.log(`  \x1b[2mRegenerating narrative...\x1b[0m`);
              broadcast('regenerating', { previousSha: prevSha, newSha });

              try {
                const prevTldr = ctx.narrative?.tldr;
                const prevChapterTitles = ctx.narrative?.chapters.map((ch) => ch.title) ?? [];

                ctx.pr = freshPr;
                let freshFiles = ctx.files;
                if (shaChanged) {
                  ctx.headSha = freshPr.headSha;
                  freshFiles = await ctx.github.getDiff(ctx.owner, ctx.repo, ctx.pr.number);
                  ctx.files = freshFiles;
                }

                const config = await readConfig();
                const metaHash = computePromptMetaHash(ctx.pr);
                const providerKey = await resolveProviderKey(config);
                const cached = await getCachedNarrative(
                  ctx.owner,
                  ctx.repo,
                  ctx.pr.number,
                  ctx.headSha,
                  metaHash,
                  providerKey,
                );
                if (cached) {
                  ctx.narrative = cached;
                  console.log(`  \x1b[38;5;78m✓\x1b[0m Using cached narrative \x1b[2m(${newSha})\x1b[0m`);
                } else {
                  const regenStartedAt = Date.now();
                  const isTty = Boolean(process.stdout.isTTY);
                  const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
                  let spinnerFrame = 0;
                  let totalChars = 0;
                  const fmtRegenElapsed = () => {
                    const s = Math.floor((Date.now() - regenStartedAt) / 1000);
                    const m = Math.floor(s / 60);
                    return m > 0 ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${s}s`;
                  };
                  const renderRegen = () => {
                    if (!isTty) return;
                    const frame = spinnerFrames[spinnerFrame++ % spinnerFrames.length];
                    const chars = totalChars > 0 ? `\x1b[2m — ${totalChars.toLocaleString()} chars\x1b[0m` : '';
                    process.stdout.write(`\r  \x1b[2m${frame} ${fmtRegenElapsed()} elapsed\x1b[0m${chars}`);
                  };
                  renderRegen();
                  const heartbeat = setInterval(renderRegen, 250);
                  let generated;
                  let provider: string;
                  try {
                    const result = await generateNarrative(
                      ctx.pr,
                      freshFiles,
                      [],
                      config,
                      {
                        previousTldr: prevTldr,
                        previousChapterTitles: prevChapterTitles,
                      },
                      {
                        cacheKey: { owner: ctx.owner, repo: ctx.repo, number: ctx.pr.number, sha: ctx.headSha },
                        onProgress: ({ chars }) => {
                          totalChars = chars;
                          broadcast('narrative-progress', { chars });
                        },
                        onPartial: (partial) => {
                          broadcast('narrative.partial', {
                            narrative: partial,
                            pr: ctx.pr,
                            files: freshFiles,
                            comments: ctx.comments,
                          });
                        },
                        onPlan: (plan) => {
                          broadcast('plan-ready', { plan });
                        },
                        onChapter: ({ themeId, index, chapter }) => {
                          broadcast('chapter-ready', { themeId, index, chapter });
                        },
                      },
                    );
                    generated = result.narrative;
                    provider = result.provider;
                  } finally {
                    clearInterval(heartbeat);
                    if (isTty) process.stdout.write('\r\x1b[2K');
                  }
                  ctx.narrative = generated;
                  await cacheNarrative(
                    ctx.owner,
                    ctx.repo,
                    ctx.pr.number,
                    ctx.headSha,
                    metaHash,
                    providerKey,
                    generated,
                  );
                  console.log(
                    `  \x1b[38;5;78m✓\x1b[0m ${generated.chapters.length} chapters regenerated \x1b[2mvia ${provider} in ${fmtRegenElapsed()}\x1b[0m`,
                  );
                }

                broadcast('narrative', {
                  narrative: ctx.narrative,
                  pr: ctx.pr,
                  files: ctx.files,
                  comments: mapCommentsToChapters(ctx.comments, ctx.narrative),
                });
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                console.error(`  \x1b[38;5;204m✗\x1b[0m Regeneration failed: ${msg}`);
              } finally {
                regenerating = false;
              }
            }
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
          if (hadClients && sseClients.size === 0 && ctx.narrative) {
            exitTimer = setTimeout(() => {
              if (sseClients.size > 0 || !ctx.narrative) return;
              const jokes = [
                "I'm not angry, just diff-appointed.",
                "That's a wrap — like my git commits.",
                'Time to checkout. Get it? ...checkout?',
                "I'd tell you a UDP joke, but you might not get it.",
                "Don't worry, I'll be back. I always rebase.",
                'Remember: a clean diff is a happy diff.',
                "I'm going to sleep now. Unlike my PRs, I don't stay open forever.",
              ];
              const joke = jokes[Math.floor(Math.random() * jokes.length)];
              console.log(`\n  \x1b[2mBrowser disconnected — shutting down.\x1b[0m`);
              console.log(`  \x1b[38;5;141m${joke}\x1b[0m\n`);
              setTimeout(() => process.exit(0), 500);
            }, 30_000);
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

    const opts =
      payload.path && payload.line
        ? {
            path: payload.path,
            line: payload.line,
            side: payload.side ?? ('RIGHT' as const),
            startLine: payload.startLine,
            startSide: payload.startSide,
            commitId: payload.commitId ?? ctx.headSha,
            inReplyToId: payload.inReplyToId,
          }
        : payload.inReplyToId
          ? { inReplyToId: payload.inReplyToId }
          : undefined;

    const posted = await ctx.github.postComment(ctx.owner, ctx.repo, ctx.pr.number, payload.body, opts);
    ctx.comments = [...ctx.comments, posted];
    broadcast('comment', posted);
    return c.json(posted, 201);
  });

  app.post('/api/review', async (c) => {
    let payload: {
      event?: string;
      body?: string;
      comments?: {
        path: string;
        line: number;
        body: string;
        side?: 'LEFT' | 'RIGHT';
        startLine?: number;
        startSide?: 'LEFT' | 'RIGHT';
      }[];
    };
    try {
      payload = (await c.req.json()) as typeof payload;
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

    const comments = payload.comments?.filter(
      (cm) => typeof cm.path === 'string' && typeof cm.line === 'number' && typeof cm.body === 'string',
    );

    try {
      await ctx.github.submitReview(ctx.owner, ctx.repo, ctx.pr.number, ghEvent, payload.body, comments);
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

  return { app, broadcast };
}
