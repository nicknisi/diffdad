import { existsSync } from 'fs';
import { Hono } from 'hono';
import { serveStatic } from 'hono/bun';
import { dirname, resolve } from 'path';
import { CleanTreeError } from '../local/diff-source';
import type { Concern } from '../narrative/types';
import { mountMcp } from '../mcp/server';
import { type ComputeSlice, registerSubmitTools } from '../mcp/submit';
import type { Broadcast } from '../mcp/tools';
import type { DecisionChannel } from '../units/decision-channel';
import { decisionTarget } from '../units/decision-target';
import type { UnitStore } from '../units/store';
import { type Decision, IllegalTransitionError, type ReviewUnit, UnknownUnitError } from '../units/types';

type SseSend = (event: string, data: unknown) => void;

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

    const unit = await store.add({
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
