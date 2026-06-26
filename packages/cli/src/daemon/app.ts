import { existsSync } from 'fs';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { dirname, resolve } from 'path';
import type { PostCommentOptions } from '../github/client';
import { mapCommentsToChapters } from '../github/comments';
import type { PRComment } from '../github/types';
import { CleanTreeError } from '../local/diff-source';
import { buildReviewSummaryPrompt } from '../narrative/review-summary';
import type { Concern } from '../narrative/types';
import { mountMcp } from '../mcp/server';
import { type ComputeSlice, registerSubmitTools } from '../mcp/submit';
import type { Broadcast } from '../mcp/tools';
import type { DecisionChannel } from '../units/decision-channel';
import { decisionTarget } from '../units/decision-target';
import type { UnitStore } from '../units/store';
import { type Decision, IllegalTransitionError, type ReviewUnit, UnknownUnitError } from '../units/types';

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
 * SSE fan-out registry shared by the daemon's HTTP routes, MCP tools, and review-worker pool.
 * Owned by the daemon process (not the app) so the pool — constructed before the app — can
 * broadcast through the same hub the `/api/events` route streams from.
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
  decision: DecisionChannel;
  hub: SseHub;
  computeSlice: ComputeSlice;
  /** Fired after a unit is submitted so the daemon can kick the review-worker pool. */
  onSubmitted?: (unit: ReviewUnit) => void;
  /**
   * Posts a `github` unit's verdict to GitHub as a real review. Injected so tests fake it and the
   * daemon wires the authenticated client. Must throw on failure — the route then 502s and records
   * NOTHING locally, so dad and GitHub never disagree.
   */
  reviewPoster?: (unit: ReviewUnit, decision: Decision) => Promise<void>;
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
  /** Long-poll ceiling for `await_decision`; tests shrink it. */
  awaitTimeoutMs?: number;
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
 * one-PR-per-process model). Serves the units API + decision route, the MCP endpoint (submit/await),
 * the live SSE stream, and the command-center SPA. A separate factory from `createServer` on purpose
 * — the scout flagged that retrofitting `ServerContext` (a single PR + narrative) would break its
 * route handlers; the unit-scoped store is a cleaner seam.
 */
export function createDaemonApp(deps: DaemonAppDeps): { app: Hono } {
  const { store, decision, hub, computeSlice, onSubmitted, reviewPoster, hydrate, awaitTimeoutMs } = deps;
  const { commentFetcher, commentPoster, reviewSubmitter, ai } = deps;
  const app = new Hono();
  const broadcast = hub.broadcast;

  // --- Command-center bootstrap ---------------------------------------------
  // The web SPA's single bootstrap is `GET /api/narrative`; it multiplexes on `mode`
  // ('pr' | 'watch' | 'command-center'). The daemon has no single PR/narrative, so it declares
  // 'command-center' and seeds the queue — the same seam watch mode uses. Must precede the static
  // catch-all, or serveStatic answers with index.html and the SPA can't tell it's on a daemon.
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

  // Nick's verdict on a unit → persisted on the unit AND delivered to the parked agent via the
  // decision channel (the same channel `await_decision` waits on, and Phase 4's auto-clear reuses).
  app.post('/api/units/:id/decision', async (c) => {
    const id = c.req.param('id');
    let body: { kind?: string; concerns?: Concern[]; note?: string };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    if (body.kind !== 'approved' && body.kind !== 'changes_requested') {
      return c.json({ error: "decision 'kind' must be 'approved' or 'changes_requested'" }, 400);
    }
    const decisionValue: Decision = { kind: body.kind, concerns: body.concerns, note: body.note };

    const existing = store.get(id);
    if (!existing) return c.json({ error: new UnknownUnitError(id).message }, 404);

    // --- github units: the verdict becomes a real GitHub review --------------
    // Post to GitHub FIRST; only record locally if that succeeds, so dad and GitHub never disagree.
    if (decisionTarget(existing) === 'github') {
      // Validate the transition BEFORE the network call: a github verdict is only valid on a unit
      // awaiting review. A repeat decision (double-click / second tab) must not post a second real
      // review to GitHub and then fail locally — the exact dad⇄GitHub divergence we forbid.
      if (existing.status !== 'queued') {
        return c.json({ error: `unit is ${existing.status}, not awaiting a decision` }, 409);
      }
      if (existing.prNumber === undefined) return c.json({ error: 'unit has no PR' }, 400);
      // A github verdict is meaningless without a way to post it — refuse rather than record a local
      // "approved" that never reaches GitHub.
      if (!reviewPoster) {
        return c.json({ error: 'GitHub is not configured — cannot post a review for this unit' }, 503);
      }
      try {
        await reviewPoster(existing, decisionValue);
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
      }
      let unit: ReviewUnit;
      try {
        await store.setDecision(id, decisionValue);
        unit = store.setReviewedSha(id, existing.metadata.headSha);
      } catch (err) {
        if (err instanceof IllegalTransitionError) return c.json({ error: err.message }, 409);
        throw err;
      }
      broadcast('units', { units: store.list() });
      return c.json({ ok: true, unit });
    }

    // --- agent / cli units: delivered over the decision channel --------------
    let unit: ReviewUnit;
    try {
      unit = await store.setDecision(id, decisionValue);
    } catch (err) {
      if (err instanceof UnknownUnitError) return c.json({ error: err.message }, 404);
      if (err instanceof IllegalTransitionError) return c.json({ error: err.message }, 409);
      throw err;
    }
    decision.deliver(id, decisionValue);
    broadcast('units', { units: store.list() });
    return c.json({ ok: true, unit });
  });

  // `dad add` ingest — the CLI door (source:'cli'). Mirrors the MCP `submit_for_review` path over
  // HTTP: compute the worktree slice, mint a unit, kick the worker pool. The daemon owns the store;
  // `dad add` never writes it directly. A clean tree is a no-op (HTTP 200 { ok:false }), like submit.
  app.post('/api/units', async (c) => {
    let body: { taskLabel?: string; intent?: string; repo?: string; worktreePath?: string; baseRef?: string };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }
    const { taskLabel, intent, repo, worktreePath, baseRef } = body;
    if (!repo || !worktreePath || !taskLabel) {
      return c.json({ error: 'repo, worktreePath, and taskLabel are required' }, 400);
    }

    let review;
    try {
      review = await computeSlice(worktreePath, baseRef);
    } catch (err) {
      if (err instanceof CleanTreeError) {
        return c.json({ ok: false, reason: 'clean-tree', message: err.message }, 200);
      }
      throw err;
    }

    // Dedup: a second `dad add` from the same worktree updates the existing unit in place (fresh slice,
    // back to `submitted`, prior verdict/error cleared) rather than minting a duplicate — which also
    // re-reviews a unit whose first review failed.
    const existing = store.findByWorktree(worktreePath);
    const unit = existing
      ? await store.resubmit(existing.unitId, {
          taskLabel,
          intent,
          baseRef: review.baseRef,
          diffContentKey: review.contentKey,
          files: review.files,
          metadata: review.metadata,
        })
      : await store.add({
          repo,
          worktreePath,
          taskLabel,
          intent: intent ?? '',
          uncertainties: [],
          baseRef: review.baseRef,
          diffContentKey: review.contentKey,
          files: review.files,
          metadata: review.metadata,
          source: 'cli',
        });
    onSubmitted?.(unit);
    broadcast('units', { units: store.list() });
    return c.json({ unitId: unit.unitId });
  });

  // Retry a local unit's review — re-compute the worktree slice and resubmit it to the worker pool.
  // The one way a `queued` unit that failed its review (the forward machine has no edge out of `queued`
  // back to `submitted`) gets re-evaluated from the UI. github units have no worktree → 400 (they
  // re-review via the poller / lazy hydrate instead). A now-clean tree is a friendly no-op.
  app.post('/api/units/:id/retry', async (c) => {
    const id = c.req.param('id');
    const unit = store.get(id);
    if (!unit) return c.json({ error: new UnknownUnitError(id).message }, 404);
    if (unit.source === 'github') {
      return c.json({ error: 'github units cannot be retried — they re-review on a new push' }, 400);
    }
    let review;
    try {
      review = await computeSlice(unit.worktreePath, unit.baseRef);
    } catch (err) {
      if (err instanceof CleanTreeError) {
        return c.json({ ok: false, reason: 'clean-tree', message: err.message }, 200);
      }
      throw err;
    }
    const updated = await store.resubmit(id, {
      baseRef: review.baseRef,
      diffContentKey: review.contentKey,
      files: review.files,
      metadata: review.metadata,
    });
    onSubmitted?.(updated);
    broadcast('units', { units: store.list() });
    return c.json({ ok: true, unit: updated });
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

  // Lazy narrative for `github` units — generated on open, not on poll, so dad never burns tokens
  // narrating PRs you never click. The web drill-in POSTs this once when it opens a github unit with
  // no narrative; the `hydrate` dep fetches the PR diff + generates the walkthrough and stores it
  // (without a status transition). No-op for non-github units, already-hydrated units, or when no
  // hydrate dep is wired. Must precede the static catch-all or serveStatic swallows it.
  app.post('/api/units/:id/hydrate', async (c) => {
    const id = c.req.param('id');
    const unit = store.get(id);
    if (!unit) return c.json({ error: new UnknownUnitError(id).message }, 404);
    if (unit.source !== 'github' || unit.narrative || !hydrate) return c.json({ unit });
    let updated: ReviewUnit;
    try {
      updated = await hydrate(unit);
    } catch (err) {
      // A real PR-fetch / LLM failure is a bad gateway, not an unhandled 500 with a stack trace.
      // Record nothing and don't broadcast — the unit stays as-is for a later retry.
      return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
    }
    broadcast('units', { units: store.list() });
    return c.json({ unit: updated });
  });

  // --- Comments (github units) ----------------------------------------------
  // Two-way with GitHub, mirroring the PR server's /api/comments: a github unit's comments are
  // fetched and posted LIVE from GitHub (never stored on the unit), so dad and the PR can't drift —
  // the same reason the decision route posts to GitHub first. Non-github units (agent/cli) have no PR
  // to comment on, so GET returns [] and POST 400s. Both routes must precede the static catch-all.
  app.get('/api/units/:id/comments', async (c) => {
    const id = c.req.param('id');
    const unit = store.get(id);
    if (!unit) return c.json({ error: new UnknownUnitError(id).message }, 404);
    if (unit.source !== 'github' || !commentFetcher) return c.json([] as PRComment[]);
    const raw = await commentFetcher(unit);
    // Map to chapters once the walkthrough exists (the drill-in hydrates on open); before that, the
    // raw comments are still returned so they're never invisible — they just carry no chapterIndices.
    return c.json(unit.narrative ? mapCommentsToChapters(raw, unit.narrative) : raw);
  });

  app.post('/api/units/:id/comments', async (c) => {
    const id = c.req.param('id');
    const unit = store.get(id);
    if (!unit) return c.json({ error: new UnknownUnitError(id).message }, 404);
    if (unit.source !== 'github') return c.json({ error: 'only github units have a PR to comment on' }, 400);
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
  // one GitHub review (mirrors the PR server's /api/review). Unlike that route, a verdict (approve /
  // request_changes) ALSO records locally so the unit leaves the needs-you queue — so we post to
  // GitHub FIRST and validate `queued` before the network (same divergence guard as the decision
  // route). A COMMENT review carries no verdict: it posts to GitHub but the unit stays queued.
  app.post('/api/units/:id/review', async (c) => {
    const id = c.req.param('id');
    const unit = store.get(id);
    if (!unit) return c.json({ error: new UnknownUnitError(id).message }, 404);
    if (unit.source !== 'github') return c.json({ error: 'only github units submit a GitHub review' }, 400);
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

  // --- AI (review-summary draft; ask/renarrate land in a later slice) -------
  // The drill-in's "Draft with AI" button. Mirrors the PR server's /api/ai 'summarize' action, but
  // scoped to a unit's narrative. 503 (not 500) when the unit isn't hydrated or no provider is wired.
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
    };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: 'invalid JSON body' }, 400);
    }

    if (body.action !== 'summarize') return c.json({ error: `unsupported action: ${body.action}` }, 400);
    if (!unit.narrative) return c.json({ error: 'narrative still generating' }, 503);
    if (!ai) return c.json({ error: 'AI is not configured' }, 503);

    const { systemPrompt, userPrompt } = buildReviewSummaryPrompt(unit.narrative, {
      resolution: body.resolution,
      reviewedChapters: body.reviewedChapters,
      pendingComments: body.pendingComments,
      userDraft: body.userDraft,
    });
    try {
      const result = await ai(systemPrompt, userPrompt);
      return c.json({ text: result.text.trim() });
    } catch (err) {
      return c.json({ error: `AI request failed: ${err instanceof Error ? err.message : String(err)}` }, 500);
    }
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

  // --- MCP endpoint ---------------------------------------------------------
  // submit_for_review + await_decision, sharing the store + decision channel. Must be registered
  // BEFORE the static catch-all or `/mcp` is swallowed by serveStatic.
  // (The three per-concern comment tools land with the per-unit review view in #22 — they need a
  //  per-unit AgentCommentStore + an agent↔unit association that only that view establishes.)
  mountMcp(app, (server) =>
    registerSubmitTools(server, { store, decision, broadcast, computeSlice, onSubmitted, awaitTimeoutMs }),
  );

  // --- Command-center SPA ---------------------------------------------------
  const webDist = resolveWebDist(deps.webDist);
  app.use('/*', serveStatic({ root: webDist, rewriteRequestPath: (path) => (path === '/' ? '/index.html' : path) }));
  app.get('/*', serveStatic({ root: webDist, path: 'index.html' }));

  return { app };
}
