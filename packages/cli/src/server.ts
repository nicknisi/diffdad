import { sseDataSchemaFor, type ReviewRound, type SseDataFor, type SseEventName } from '@diffdad/contracts';
import type { PRComment as WirePRComment } from '@diffdad/contracts';
import { existsSync } from 'fs';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { dirname, resolve } from 'path';
import { registerConfigRoutes } from './config-api';
import { readConfig } from './config';
import type { GitHubClient } from './github/client';
import { mapCommentsToChapters } from './github/comments';
import type { CheckRun, DiffFile, PRComment, PRMetadata, PRReview } from './github/types';
import { cacheNarrative, computePromptMetaHash, getCachedNarrative, getLastGoodNarrative } from './narrative/cache';
import { reanchorNarrative } from './narrative/validator';
import { chapterCallers, resolveCollapse } from './narrative/collapse';
import { callAi, generateNarrative, resolveAiPath, resolveProviderKey } from './narrative/engine';
import { buildChapterAiPrompt } from './narrative/chapter-ai';
import type { PromptCapStats } from './narrative/prompt';
import { buildReviewSummaryPrompt } from './narrative/review-summary';
import type { NarrativeResponse } from './narrative/types';
import { deriveReviewRound } from './review-round';
import type { RepoContext } from './repo/snapshot';
import { cacheRecap } from './recap/cache';
import { generateRecap } from './recap/engine';
import { gatherRecapSources } from './recap/sources';
import type { RecapResponse } from './recap/types';
import { findMatchingSessions } from './trace/local-sessions';
import type { TraceSessionSummary } from '@diffdad/contracts';
import { describeRepoContext, resolveRepoContext } from './repo/snapshot';

export type ServerContext = {
  narrative: NarrativeResponse | null;
  pr: PRMetadata;
  files: DiffFile[];
  comments: PRComment[];
  checkRuns: CheckRun[];
  reviews: PRReview[];
  /** GitHub client for the PR under review; nullable only so the few routes that call it can guard defensively. */
  github: GitHubClient | null;
  owner: string;
  repo: string;
  headSha: string;
  /**
   * The base-branch snapshot the narrative was generated against, carried from `cli.ts` (which already
   * resolves it) so collapse selection never resolves inside a request — a cold snapshot is a whole
   * tarball download, and `/api/narrative` is the page's bootstrap. Absent means "not resolved yet":
   * the response then omits `collapse` entirely rather than claiming a reason it never checked.
   */
  repoContext?: RepoContext | null;
  /**
   * Prompt budget stats from the generation that produced `ctx.narrative`. Absent on a cache hit, and
   * absent is load-bearing: the truncation banner renders nothing rather than claim a completeness that
   * was never measured.
   */
  capStats?: PromptCapStats | null;
  /** Populated lazily when the user opens the Recap tab (or hydrated from cache at startup). */
  recap?: RecapResponse | null;
  /** Set while a recap is being generated; cleared on success or failure. */
  recapGenerating?: boolean;
  /** Set if the last recap generation attempt failed; cleared on retry. */
  recapError?: string | null;
  /**
   * The SHA the on-screen narrative was last generated against. Feeds `deriveReviewRound`'s carry-over
   * count: when `headSha` advances past this, unresolved threads that predate the push carry over. Null
   * until the first narrative is narrated.
   */
  narratedSha?: string | null;
  /** Last derived review-round status, cached so the poll only broadcasts `review-round` when it changes. */
  reviewRound?: ReviewRound | null;
  /**
   * Local authoring-session intent, mined once per server process from ~/.claude/projects. `undefined`
   * means not looked yet; an empty array means looked and found nothing (feature stays invisible).
   */
  traceIntent?: TraceSessionSummary[];
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

/**
 * Dev-only SSE payload validation. Off unless `DIFFDAD_DEBUG` is set, so production pays nothing:
 * the `SSE_VALIDATE` guard short-circuits before any schema work. Logs mismatches, never throws — a
 * malformed payload must still reach the wire so the bug is observable in the browser, not swallowed.
 */
const SSE_VALIDATE = Boolean(process.env.DIFFDAD_DEBUG);
function validateSseData(event: SseEventName, data: unknown): void {
  const schema = sseDataSchemaFor(event);
  if (!schema) {
    console.error(`[sse] no schema for event "${event}"`);
    return;
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error(`[sse] "${event}" payload failed schema validation:`, result.error.issues);
  }
}

export function createServer(ctx: ServerContext) {
  const app = new Hono();
  type SseClient = <E extends SseEventName>(event: E, data: SseDataFor<E>) => void;
  const sseClients = new Set<SseClient>();
  let hadClients = false;
  let exitTimer: ReturnType<typeof setTimeout> | null = null;

  let narrativeProgressChars = 0;

  /**
   * Derive the review round from the data currently in `ctx` (plus freshly polled `commits`) and
   * broadcast `review-round` only when it changes (JSON compare). Purely additive — never blocks.
   */
  function recomputeReviewRound(commits?: { sha: string; committedAt?: string }[]): ReviewRound {
    const round = deriveReviewRound({
      headSha: ctx.headSha,
      lastNarratedSha: ctx.narratedSha ?? null,
      comments: ctx.comments,
      reviews: ctx.reviews,
      commits,
      prAuthor: ctx.pr.author.login,
    });
    const changed = JSON.stringify(round) !== JSON.stringify(ctx.reviewRound ?? null);
    ctx.reviewRound = round;
    if (changed) broadcast('review-round', { round });
    return round;
  }

  // Seed the round from the data already in `ctx` so the bootstrap `GET /api/narrative` can carry it.
  // No commits yet (the poll fetches those); this establishes review/thread state at once.
  recomputeReviewRound();

  function broadcast<E extends SseEventName>(event: E, data: SseDataFor<E>) {
    if (event === 'narrative-progress') {
      narrativeProgressChars = (data as unknown as { chars?: number }).chars ?? 0;
    } else if (event === 'regenerating' || event === 'narrative') {
      narrativeProgressChars = 0;
    }
    for (const send of sseClients) {
      send(event, data);
    }
  }

  /**
   * The blast-radius half of the narrative payload: which chapters are safe to hide by default, and
   * which unchanged files import each chapter's code.
   *
   * Computed per request and never persisted — a narrative cached while the snapshot was cold would
   * otherwise keep collapsing nothing at that SHA forever. Returns an empty object (no `collapse` key
   * at all) when there is no snapshot answer yet, which is different from `{available: false}`: that
   * one means we looked and could not tell, this one means we have not looked.
   */
  function blastRadius(): {
    collapse?: ReturnType<typeof resolveCollapse>;
    callers?: ReturnType<typeof chapterCallers>;
  } {
    const repoContext = ctx.repoContext;
    if (!repoContext || !ctx.narrative) return {};
    return {
      collapse: resolveCollapse(ctx.narrative.chapters, ctx.files, repoContext),
      callers: chapterCallers(ctx.narrative.chapters, ctx.files, repoContext),
    };
  }

  let repoContextRefresh: Promise<void> | null = null;

  /**
   * Resolve the base-branch snapshot in the background, once, for the path that never needed it:
   * a cached narrative means `cli.ts` skipped generation, so nothing resolved a snapshot, and the
   * 24-hour staleness bound means re-opening a PR two days later refetches the tarball. Awaiting that
   * inside `GET /api/narrative` would stall the page's bootstrap on a multi-hundred-megabyte download,
   * so the request answers without collapse and this pushes it over SSE when it lands.
   */
  async function refreshRepoContext(): Promise<void> {
    if (ctx.repoContext || !ctx.github) return;
    repoContextRefresh ??= (async () => {
      const gh = ctx.github;
      if (!gh) return;
      try {
        ctx.repoContext = await resolveRepoContext(gh, ctx.owner, ctx.repo, ctx.pr.base);
        if (ctx.narrative) broadcast('collapse', blastRadius());
      } catch {
        // `resolveRepoContext` is documented never to throw, and this call is fire-and-forget from
        // `cli.ts` — a rejection here would surface as an unhandled rejection rather than as a missing
        // collapse boundary, which is the wrong trade for a purely additive surface.
      }
    })();
    return repoContextRefresh;
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
        mode: 'pr',
        aiPath,
        round: ctx.reviewRound ?? undefined,
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
    // The shared narrative payload is typed against the contracts `narrative` SSE payload so its shape
    // can't drift from what the browser (and the `broadcast('narrative', ...)` sites) expect. The HTTP
    // response then adds the GET-only fields (checkRuns/reviews/repoUrl/mode/aiPath/_debug) on top.
    const narrativePayload = {
      narrative: ctx.narrative,
      pr: ctx.pr,
      files: ctx.files,
      comments: mapCommentsToChapters(ctx.comments, ctx.narrative),
      ...blastRadius(),
      // Absent on a cache hit, and deliberately so — see `ServerContext.capStats`.
      capStats: ctx.capStats ?? undefined,
    } satisfies SseDataFor<'narrative'>;
    return c.json({
      ...narrativePayload,
      checkRuns: ctx.checkRuns,
      reviews: ctx.reviews,
      repoUrl: `https://github.com/${ctx.owner}/${ctx.repo}`,
      mode: 'pr',
      aiPath,
      round: ctx.reviewRound ?? undefined,
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
    if (!ctx.github) return; // recap requires GitHub data
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

  // Local-only, read-only intent from the coding session that authored this branch. Filesystem work,
  // no LLM, no upload: prompts live only in this response. Cached in-memory per server process.
  app.get('/api/trace/intent', async (c) => {
    if (ctx.traceIntent === undefined) {
      try {
        ctx.traceIntent = await findMatchingSessions({
          repoDirHints: [ctx.repo],
          branch: ctx.pr.branch,
          changedFiles: ctx.files.map((f) => f.file),
          since: ctx.pr.createdAt ? new Date(ctx.pr.createdAt) : undefined,
        });
      } catch {
        ctx.traceIntent = []; // best-effort: any failure means the feature stays invisible
      }
    }
    return c.json({ sessions: ctx.traceIntent });
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
      const { systemPrompt, userPrompt } = buildReviewSummaryPrompt(ctx.narrative, {
        resolution: body.resolution,
        reviewedChapters: body.reviewedChapters,
        pendingComments: body.pendingComments,
        userDraft: body.userDraft,
      });
      try {
        const result = await callAi(config, systemPrompt, userPrompt);
        return c.json({ text: result.text.trim() });
      } catch (err) {
        return c.json({ error: `AI request failed: ${(err as Error).message}` }, 500);
      }
    }

    if (!ctx.narrative) return c.json({ error: 'narrative still generating' }, 503);
    const built = buildChapterAiPrompt(ctx.narrative, ctx.files, {
      action,
      chapterIndex: body.chapterIndex,
      question: body.question,
      lens: body.lens,
    });
    if (!built.ok) return c.json({ error: built.error }, 400);

    try {
      const result = await callAi(config, built.systemPrompt, built.userPrompt);
      return c.json({ text: result.text });
    } catch (err) {
      return c.json({ error: `AI request failed: ${(err as Error).message}` }, 500);
    }
  });

  app.get('/api/checks', async (c) => {
    if (!ctx.github) return c.json([]);
    const fresh = await ctx.github.getCheckRuns(ctx.owner, ctx.repo, ctx.headSha);
    ctx.checkRuns = fresh;
    return c.json(fresh);
  });

  app.get('/api/comments', async (c) => {
    if (!ctx.github) return c.json([]);
    const fresh = await ctx.github.getComments(ctx.owner, ctx.repo, ctx.pr.number);
    ctx.comments = fresh;
    const body = (ctx.narrative ? mapCommentsToChapters(fresh, ctx.narrative) : fresh) satisfies WirePRComment[];
    return c.json(body);
  });

  app.get('/api/events', (c) => {
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send = <E extends SseEventName>(event: E, data: SseDataFor<E>) => {
          if (SSE_VALIDATE) validateSseData(event, data);
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            // controller closed
          }
        };

        send('connected', { timestamp: Date.now() });
        if (narrativeProgressChars > 0) send('narrative-progress', { chars: narrativeProgressChars });
        // Replay the boundary for the same reason progress is replayed: `refreshRepoContext` broadcasts
        // `collapse` exactly once, and a snapshot that resolves in the gap between the bootstrap
        // `GET /api/narrative` and this connect would otherwise be dropped with no second chance short of
        // a reload. Empty when nothing has resolved yet, which sends nothing.
        if (ctx.repoContext && ctx.narrative) send('collapse', blastRadius());
        sseClients.add(send);
        hadClients = true;
        if (exitTimer) {
          clearTimeout(exitTimer);
          exitTimer = null;
        }

        let regenerating = false;
        const interval = setInterval(async () => {
          try {
            const gh = ctx.github;
            if (!gh) return;
            const freshPr = await gh.getPR(ctx.owner, ctx.repo, ctx.pr.number);
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

            const fresh = await gh.getComments(ctx.owner, ctx.repo, ctx.pr.number);
            const prevIds = new Set(ctx.comments.map((cm) => cm.id));
            const freshIds = new Set(fresh.map((cm) => cm.id));
            const hasNew = fresh.some((cm) => !prevIds.has(cm.id));
            const hasDeleted = ctx.comments.some((cm) => !freshIds.has(cm.id));
            if (hasNew || hasDeleted) {
              send('comments', fresh);
            }
            ctx.comments = fresh;

            const freshChecks = await gh.getCheckRuns(ctx.owner, ctx.repo, ctx.headSha);
            ctx.checkRuns = freshChecks;
            send('checks', freshChecks);

            const freshReviews = await gh.getReviews(ctx.owner, ctx.repo, ctx.pr.number);
            ctx.reviews = freshReviews;
            send('reviews', freshReviews);

            // Commit timestamps place the "latest push" boundary that `updated-since-review` and the
            // carry-over count depend on. Mapped from author date (the only date `getPRCommits` returns).
            // Isolated so a commits fetch failure degrades the round (no push boundary) rather than
            // aborting the whole poll and its regeneration.
            let freshCommits: { sha: string; committedAt?: string }[] = [];
            try {
              const cs = await gh.getPRCommits(ctx.owner, ctx.repo, ctx.pr.number);
              freshCommits = cs.map((cm) => ({ sha: cm.sha, committedAt: cm.authoredAt }));
            } catch {
              // degrade the round (no push boundary) rather than aborting the poll
            }
            const round = recomputeReviewRound(freshCommits);

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
              // Carry the surviving unresolved-thread count so the UI can say "regenerating — N threads
              // carry over" instead of blurring a force-push into the reviewer's open threads.
              broadcast('regenerating', {
                previousSha: prevSha,
                newSha,
                ...(round.carriedOverThreads > 0 ? { carriedOverThreads: round.carriedOverThreads } : {}),
              });

              try {
                const prevTldr = ctx.narrative?.tldr;
                const prevChapterTitles = ctx.narrative?.chapters.map((ch) => ch.title) ?? [];

                ctx.pr = freshPr;
                let freshFiles = ctx.files;
                if (shaChanged) {
                  ctx.headSha = freshPr.headSha;
                  freshFiles = await gh.getDiff(ctx.owner, ctx.repo, ctx.pr.number);
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
                  // The cached narrative was anchored against a prior diff; the SHA just changed and
                  // `freshFiles` may have shifted hunk indices. Re-resolve via content anchors so refs
                  // survive the reshape instead of dropping.
                  ctx.narrative = reanchorNarrative(cached, freshFiles);
                  // A cached narrative carries no budget stats, and inventing them would tell the
                  // reviewer a story built from a truncated diff was complete.
                  ctx.capStats = null;
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
                  // Same resolution the CLI does before its first generation: the prompt builders call
                  // `computeRisk` synchronously, so the snapshot has to be in hand first. Warm on the
                  // regenerate path (the CLI fetched it at startup), so this is normally a cache read.
                  const repoContext = await resolveRepoContext(gh, ctx.owner, ctx.repo, ctx.pr.base);
                  // Same snapshot the prompt was built from now backs collapse selection, so the
                  // boundary the reviewer sees describes the narrative they are reading.
                  ctx.repoContext = repoContext;
                  if (!repoContext.available) console.log(`  \x1b[2m${describeRepoContext(repoContext)}\x1b[0m`);
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
                        repoContext,
                        cacheKey: {
                          owner: ctx.owner,
                          repo: ctx.repo,
                          number: ctx.pr.number,
                          sha: ctx.headSha,
                          metaHash,
                          providerKey,
                        },
                        comments: ctx.comments,
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
                    ctx.capStats = result.capStats ?? null;
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

                // The narrative now describes the new head, so that head is the narrated SHA. Recompute
                // the round against it (carry-over collapses to 0 once head == narrated) and ship it with
                // the narrative payload.
                ctx.narratedSha = ctx.headSha;
                const postRegenRound = recomputeReviewRound(freshCommits);

                broadcast('narrative', {
                  narrative: ctx.narrative,
                  pr: ctx.pr,
                  files: ctx.files,
                  comments: mapCommentsToChapters(ctx.comments, ctx.narrative),
                  round: postRegenRound,
                  // Recomputed for the new chapter array: `CollapseDecision.chapterIndex` indexes the
                  // chapters it was computed against, so shipping the narrative without it would leave
                  // the browser holding a boundary that describes the previous plan.
                  ...blastRadius(),
                  capStats: ctx.capStats ?? undefined,
                });
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                // generateNarrative threw before assigning ctx.narrative, so ctx still holds the prior
                // (last successfully served) narrative. If a sealed last-good revision exists for this
                // PR, keep serving what the reviewer already has instead of surfacing a fatal error to
                // the UI — a failed regen must not blank the tab.
                const lastGood = await getLastGoodNarrative(ctx.owner, ctx.repo, ctx.pr.number);
                if (lastGood) {
                  console.warn(`  \x1b[38;5;221m⚠\x1b[0m Regeneration failed (${msg}); keeping last-good narrative.`);
                } else {
                  console.error(`  \x1b[38;5;204m✗\x1b[0m Regeneration failed: ${msg}`);
                  // The terminal log is invisible to the browser tab, which otherwise keeps showing stale
                  // content with no hint that the refresh failed. Push the error so the UI can surface it.
                  broadcast('narrative-error', { message: msg });
                }
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
    if (!ctx.github) return c.json({ error: 'GitHub is unavailable' }, 409);
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
    return c.json(posted satisfies WirePRComment, 201);
  });

  app.post('/api/review', async (c) => {
    if (!ctx.github) return c.json({ error: 'GitHub is unavailable' }, 409);
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

  // Shared GET/PUT /api/config + POST /api/config/test. No re-wire hook — the PR server persists only
  // (a single-PR process has nothing to re-wire); the daemon passes `onConfigChange`. Must precede the
  // static catch-all below or serveStatic swallows it.
  registerConfigRoutes(app, { broadcast });

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

  return { app, broadcast, refreshRepoContext, blastRadius };
}
