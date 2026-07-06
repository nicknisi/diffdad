import { existsSync } from 'fs';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { dirname, resolve } from 'path';
import type { PostCommentOptions } from '../github/client';
import { mapCommentsToChapters } from '../github/comments';
import type { PRComment } from '../github/types';
import { buildChapterAiPrompt } from '../narrative/chapter-ai';
import { buildReviewSummaryPrompt } from '../narrative/review-summary';
import type { CheckRun, PRReview } from '../github/types';
import type { Broadcast } from '../mcp/broadcast';
import type { UnitStore } from '../units/store';
import { IllegalTransitionError, type ReviewUnit, UnknownUnitError } from '../units/types';

type SseSend = (event: string, data: unknown) => void;

/** One batched inline comment in a review submission (matches `GitHubClient.submitReview`). */
export type ReviewInlineComment = {
  path: string;
  line: number;
  body: string;
  side?: 'LEFT' | 'RIGHT';
  startLine?: number;
  startSide?: 'LEFT' | 'RIGHT';
};

/**
 * SSE fan-out registry shared by the daemon's HTTP routes. Owned by the daemon process (not the
 * app) so a single hub backs both the routes that broadcast and the `/api/events` route that
 * streams from it.
 */
export class SseHub {
  private clients = new Set<SseSend>();

  /** Register a client; returns an unsubscribe fn. */
  add(send: SseSend): () => void {
    this.clients.add(send);
    return () => this.clients.delete(send);
  }

  broadcast: Broadcast = (event, data) => {
    for (const send of this.clients) send(event, data);
  };

  get size(): number {
    return this.clients.size;
  }
}

export type DaemonAppDeps = {
  store: UnitStore;
  hub: SseHub;
  /**
   * Lazily hydrates a `github` unit on open: fetch the PR diff, generate the narrative, store it, and
   * return the updated unit. Injected so tests fake it and the daemon wires the real fetch+generate
   * path. Absent → the hydrate route is a graceful no-op (the unit is returned unchanged).
   */
  hydrate?: (unit: ReviewUnit) => Promise<ReviewUnit>;
  /**
   * Fetches a `github` unit's live comments from GitHub (review + issue comments). Injected so tests
   * fake it and the daemon wires the authenticated client. Absent → the comments route returns []
   * (no GitHub, no comments). Comments are never stored on the unit — fetched live, like PR mode.
   */
  commentFetcher?: (unit: ReviewUnit) => Promise<PRComment[]>;
  /**
   * Posts a comment to a `github` unit's PR (inline or top-level). Injected like `commentFetcher`.
   * Must throw on failure — the route then 502s so a comment never appears locally but not on GitHub.
   */
  commentPoster?: (unit: ReviewUnit, body: string, opts: PostCommentOptions) => Promise<PRComment>;
  /**
   * Submits a full GitHub review for a `github` unit — event (COMMENT/APPROVE/REQUEST_CHANGES) + body
   * + batched inline comments, in one call. Injected like the other GitHub deps. Must throw on failure
   * so the review route 502s and records nothing locally (dad ⇄ GitHub never disagree).
   */
  reviewSubmitter?: (
    unit: ReviewUnit,
    event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES',
    body: string | undefined,
    comments: ReviewInlineComment[],
  ) => Promise<void>;
  /**
   * The unified AI entry point (`callAi`), for the review-summary draft (and, later, ask/renarrate).
   * Injected so tests fake it and the daemon wires the configured provider. Absent → the AI route 503s.
   */
  ai?: (systemPrompt: string, userPrompt: string) => Promise<{ text: string }>;
  /**
   * Fetches a `github` unit's CI checks + GitHub reviews (the PR's merge-readiness context). Injected
   * like the other GitHub deps; absent → the status route returns empties. Read live, not stored.
   */
  statusFetcher?: (unit: ReviewUnit) => Promise<{ checks: CheckRun[]; reviews: PRReview[] }>;
  /**
   * Runs one GitHub review-request poll on demand — the same `pollOnce` pass the interval poller runs
   * (search GitHub, mint/resurface units, broadcast a `units` snapshot), returning the counts. Injected
   * so tests fake it and the daemon wires the authenticated search+store+broadcast. Absent → the manual
   * poll route 503s (no GitHub token, nothing to poll).
   */
  pollNow?: () => Promise<{ minted: number; resurfaced: number }>;
  /** Override the command-center static root (defaults to the same fallbacks as `server.ts`). */
  webDist?: string;
};

function resolveWebDist(override?: string): string {
  if (override) return override;
  const candidates = [
    resolve(import.meta.dir, '../../../web/dist'),
    resolve(dirname(process.execPath), 'packages', 'web', 'dist'),
    resolve(dirname(process.execPath), 'share', 'diffdad', 'web'),
    resolve(dirname(process.execPath), '..', 'share', 'diffdad', 'web'),
  ];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

/**
 * The daemon's Hono app: one multiplexed process hosting many review units (rather than `server.ts`'s
 * one-PR-per-process model). Serves the units API + review submission, the live SSE stream, and the
 * command-center SPA. A separate factory from `createServer` on purpose — the scout flagged that
 * retrofitting `ServerContext` (a single PR + narrative) would break its route handlers; the
 * unit-scoped store is a cleaner seam.
 */
export function createDaemonApp(deps: DaemonAppDeps): { app: Hono } {
  const { store, hub, hydrate } = deps;
  const { commentFetcher, commentPoster, reviewSubmitter, ai, statusFetcher, pollNow } = deps;
  const app = new Hono();
  const broadcast = hub.broadcast;
  // Single-flight state for POST /api/poll: concurrent manual refreshes share one in-flight poll.
  let inflight: Promise<{ minted: number; resurfaced: number }> | null = null;

  // --- Command-center bootstrap ---------------------------------------------
  // The web SPA's single bootstrap is `GET /api/narrative`; it multiplexes on `mode`
  // ('pr' | 'command-center'). The daemon has no single PR/narrative, so it declares
  // 'command-center' and seeds the queue. Must precede the static catch-all, or serveStatic
  // answers with index.html and the SPA can't tell it's on a daemon.
  app.get('/api/narrative', (c) => c.json({ mode: 'command-center', units: store.list() }));

  // --- Units API ------------------------------------------------------------
  app.get('/api/units', (c) => {
    const status = c.req.query('status') as ReviewUnit['status'] | undefined;
    const repo = c.req.query('repo');
    return c.json({ units: store.list({ status, repo }) });
  });

  app.get('/api/units/:id', (c) => {
    const unit = store.get(c.req.param('id'));
    if (!unit) return c.json({ error: 'unknown unit' }, 404);
    return c.json({ unit });
  });

  // Remove a unit from the queue (the reviewer's manual cleanup of failed / stale / abandoned units).
  // Hard delete: drops it from memory + disk. For github units the poller may re-mint it next cycle if
  // the review is still requested — that's intended (it's still on your plate); local units stay gone.
  app.delete('/api/units/:id', async (c) => {
    const id = c.req.param('id');
    const removed = await store.remove(id);
    if (!removed) return c.json({ error: new UnknownUnitError(id).message }, 404);
    broadcast('units', { units: store.list() });
    return c.json({ ok: true });
  });

  // Manual "check GitHub now" — the same review-request poll the interval runs (`pollOnce`), on demand.
  // The poll broadcasts a `units` snapshot that repaints every open tab; the returned counts feed only
  // the command center's result toast. Single-flight in the route closure: concurrent POSTs (button
  // mashing) coalesce onto one in-flight `pollNow()` so we don't fan out a GitHub search per click —
  // overlap with the interval poller is benign since classify dedupes. Route-level (not wiring-level) so
  // this file's tests can cover it. Must precede the static catch-all.
  app.post('/api/poll', async (c) => {
    // A poll we can't run is meaningless — refuse rather than pretend the list is fresh.
    if (!pollNow) {
      return c.json({ error: 'GitHub is not configured — cannot poll for review requests' }, 503);
    }
    const poll = (inflight ??= pollNow()
      .catch((err) => {
        // Log on the shared in-flight promise, not per-awaiter: the single-flight coalesces concurrent
        // POSTs onto this one poll, so logging here emits exactly one line per real failure instead of
        // one per request (matches the poller's + hydrate route's plain failure line). Re-throw so each
        // awaiting request still 502s below.
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[diffdad] manual poll failed: ${message}`);
        throw err;
      })
      .finally(() => {
        inflight = null;
      }));
    try {
      const { minted, resurfaced } = await poll;
      return c.json({ ok: true, minted, resurfaced });
    } catch (err) {
      // A real GitHub/network failure is a bad gateway, not an unhandled 500 (logged once above).
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
  });

  // Lazy narrative — generated on open, not on poll, so dad never burns tokens narrating PRs you
  // never click. The web drill-in POSTs this once when it opens a unit with no narrative; the
  // `hydrate` dep fetches the PR diff + generates the walkthrough and stores it (without a status
  // transition). No-op for already-hydrated units or when no hydrate dep is wired. Must precede the
  // static catch-all or serveStatic swallows it.
  app.post('/api/units/:id/hydrate', async (c) => {
    const id = c.req.param('id');
    const unit = store.get(id);
    if (!unit) return c.json({ error: new UnknownUnitError(id).message }, 404);
    if (unit.narrative || !hydrate) return c.json({ unit });
    let updated: ReviewUnit;
    try {
      updated = await hydrate(unit);
    } catch (err) {
      // A real PR-fetch / LLM failure is a bad gateway, not an unhandled 500 with a stack trace.
      // Record nothing and don't broadcast — the unit stays as-is for a later retry. Log it, though:
      // the drill-in shows an eternal spinner on failure, so without this line the cause is invisible
      // in the daemon's output (matches the poller's plain `[diffdad] ...` failure line).
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[diffdad] hydrate failed for ${unit.repo}#${unit.prNumber} (unit ${id}): ${message}`);
      return c.json({ error: message }, 502);
    }
    broadcast('units', { units: store.list() });
    return c.json({ unit: updated });
  });

  // --- Comments -------------------------------------------------------------
  // Two-way with GitHub, mirroring the PR server's /api/comments: a unit's comments are fetched and
  // posted LIVE from GitHub (never stored on the unit), so dad and the PR can't drift — the same
  // reason the review route posts to GitHub first. Both routes must precede the static catch-all.
  app.get('/api/units/:id/comments', async (c) => {
    const id = c.req.param('id');
    const unit = store.get(id);
    if (!unit) return c.json({ error: new UnknownUnitError(id).message }, 404);
    if (!commentFetcher) return c.json([] as PRComment[]);
    const raw = await commentFetcher(unit);
    // Map to chapters once the walkthrough exists (the drill-in hydrates on open); before that, the
    // raw comments are still returned so they're never invisible — they just carry no chapterIndices.
    return c.json(unit.narrative ? mapCommentsToChapters(raw, unit.narrative) : raw);
  });

  app.post('/api/units/:id/comments', async (c) => {
    const id = c.req.param('id');
    const unit = store.get(id);
    if (!unit) return c.json({ error: new UnknownUnitError(id).message }, 404);
    // A comment we can't post is worse than no comment — refuse rather than show a local ghost.
    if (!commentPoster) return c.json({ error: 'GitHub is not configured — cannot post a comment' }, 503);

    let body: {
      body?: string;
      path?: string;
      line?: number;
      side?: 'LEFT' | 'RIGHT';
      startLine?: number;
      startSide?: 'LEFT' | 'RIGHT';
      commitId?: string;
      inReplyToId?: number;
    };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (!body.body || !body.body.trim()) return c.json({ error: 'comment body is required' }, 400);

    const opts: PostCommentOptions = {
      path: body.path,
      line: body.line,
      side: body.side,
      startLine: body.startLine,
      startSide: body.startSide,
      inReplyToId: body.inReplyToId,
      // Inline comments anchor to a commit; default to the unit's head SHA (what the diff shows).
      commitId: body.commitId ?? unit.metadata.headSha,
    };

    let created: PRComment;
    try {
      created = await commentPoster(unit, body.body, opts);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
    // Scoped to the unit: the daemon is multi-unit, so a machine-wide 'comment' would leak into any
    // tab open on a *different* unit. `useLiveStream` applies it only when this unit is the open one.
    broadcast('unit-comment', { unitId: id, comment: created });
    return c.json(created, 201);
  });

  // --- Review submission (github units) -------------------------------------
  // The drill-in's full submit: COMMENT/APPROVE/REQUEST_CHANGES + batched inline draft comments, in
  // one GitHub review (mirrors the PR server's /api/review). This is the ONLY path that submits a
  // verdict. Unlike the PR server's route, a verdict (approve / request_changes) ALSO records locally
  // so the unit leaves the needs-you queue — so we post to GitHub FIRST and validate `queued` before
  // the network (a repeat decision must not post a second real review then fail locally, the exact
  // dad⇄GitHub divergence we forbid). A COMMENT review carries no verdict: it posts but stays queued.
  app.post('/api/units/:id/review', async (c) => {
    const id = c.req.param('id');
    const unit = store.get(id);
    if (!unit) return c.json({ error: new UnknownUnitError(id).message }, 404);
    if (!reviewSubmitter) return c.json({ error: 'GitHub is not configured — cannot submit a review' }, 503);

    let body: { event?: string; body?: string; comments?: ReviewInlineComment[] };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const eventMap: Record<string, 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES'> = {
      comment: 'COMMENT',
      approve: 'APPROVE',
      request_changes: 'REQUEST_CHANGES',
    };
    const ghEvent = body.event ? eventMap[body.event] : undefined;
    if (!ghEvent) return c.json({ error: 'invalid event' }, 400);
    if (unit.prNumber === undefined) return c.json({ error: 'unit has no PR' }, 400);

    // A verdict transitions the unit; guard it BEFORE the network so a repeat decision can't post a
    // second real review then fail locally. A bare COMMENT changes no local state, so it's unguarded.
    const isVerdict = ghEvent === 'APPROVE' || ghEvent === 'REQUEST_CHANGES';
    if (isVerdict && unit.status !== 'queued') {
      return c.json({ error: `unit is ${unit.status}, not awaiting a decision` }, 409);
    }

    const comments = (body.comments ?? []).filter(
      (cm): cm is ReviewInlineComment =>
        typeof cm?.path === 'string' && typeof cm?.line === 'number' && typeof cm?.body === 'string',
    );

    try {
      await reviewSubmitter(unit, ghEvent, body.body, comments);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }

    let updated = unit;
    if (isVerdict) {
      const kind = ghEvent === 'APPROVE' ? 'approved' : 'changes_requested';
      try {
        await store.setDecision(id, { kind, note: body.body });
        updated = store.setReviewedSha(id, unit.metadata.headSha);
      } catch (err) {
        if (err instanceof IllegalTransitionError) return c.json({ error: err.message }, 409);
        throw err;
      }
      broadcast('units', { units: store.list() });
    }
    broadcast('review', { event: ghEvent, body: body.body });
    return c.json({ ok: true, unit: updated });
  });

  // --- AI (review-summary draft + per-chapter ask / re-narrate) -------------
  // The drill-in's "Draft with AI" summary and the per-chapter "Ask Dad" / re-narrate. Mirrors the
  // PR server's /api/ai, scoped to a unit's narrative (+ diff for ask/renarrate). 503 (not 500) when
  // the unit isn't hydrated or no provider is wired; a bad chapter/question/lens is a 400.
  app.post('/api/units/:id/ai', async (c) => {
    const id = c.req.param('id');
    const unit = store.get(id);
    if (!unit) return c.json({ error: new UnknownUnitError(id).message }, 404);

    let body: {
      action?: string;
      resolution?: 'comment' | 'approve' | 'request_changes';
      reviewedChapters?: number[];
      pendingComments?: { path?: string; line?: number; body?: string }[];
      userDraft?: string;
      chapterIndex?: number;
      question?: string;
      lens?: string;
    };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }

    const { action } = body;
    if (action !== 'summarize' && action !== 'ask' && action !== 'renarrate') {
      return c.json({ error: `unsupported action: ${action}` }, 400);
    }
    if (!unit.narrative) return c.json({ error: 'narrative still generating' }, 503);
    if (!ai) return c.json({ error: 'AI is not configured' }, 503);

    let systemPrompt: string;
    let userPrompt: string;
    if (action === 'summarize') {
      ({ systemPrompt, userPrompt } = buildReviewSummaryPrompt(unit.narrative, {
        resolution: body.resolution,
        reviewedChapters: body.reviewedChapters,
        pendingComments: body.pendingComments,
        userDraft: body.userDraft,
      }));
    } else {
      const built = buildChapterAiPrompt(unit.narrative, unit.files, {
        action,
        chapterIndex: body.chapterIndex,
        question: body.question,
        lens: body.lens,
      });
      if (!built.ok) return c.json({ error: built.error }, 400);
      ({ systemPrompt, userPrompt } = built);
    }

    try {
      const result = await ai(systemPrompt, userPrompt);
      return c.json({ text: result.text.trim() });
    } catch (err) {
      return c.json({ error: `AI request failed: ${err instanceof Error ? err.message : String(err)}` }, 500);
    }
  });

  // --- Status: CI checks + reviews ------------------------------------------
  // The PR's merge-readiness context for the drill-in (is CI green, who's approved). Read live from
  // GitHub, never stored. No fetcher → empties.
  app.get('/api/units/:id/status', async (c) => {
    const id = c.req.param('id');
    const unit = store.get(id);
    if (!unit) return c.json({ error: new UnknownUnitError(id).message }, 404);
    if (!statusFetcher) {
      return c.json({ checks: [] as CheckRun[], reviews: [] as PRReview[] });
    }
    return c.json(await statusFetcher(unit));
  });

  // --- Live updates ---------------------------------------------------------
  // The daemon is long-lived: unlike `server.ts`, a disconnecting browser never triggers shutdown.
  app.get('/api/events', (c) => {
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        const send: SseSend = (event, data) => {
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            // controller already closed
          }
        };
        send('connected', { timestamp: Date.now() });
        send('units', { units: store.list() }); // initial snapshot so a fresh tab paints immediately
        const remove = hub.add(send);
        c.req.raw.signal.addEventListener('abort', () => {
          remove();
          try {
            controller.close();
          } catch {
            // already closed
          }
        });
      },
    });
    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
    });
  });

  // --- Command-center SPA ---------------------------------------------------
  const webDist = resolveWebDist(deps.webDist);
  app.use('/*', serveStatic({ root: webDist, rewriteRequestPath: (path) => (path === '/' ? '/index.html' : path) }));
  app.get('/*', serveStatic({ root: webDist, path: 'index.html' }));

  return { app };
}
