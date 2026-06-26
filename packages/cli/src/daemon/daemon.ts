import { readConfig } from '../config';
import { buildLocalReview } from '../local/diff-source';
import { generateNarrative } from '../narrative/engine';
import type { ComputeSlice } from '../mcp/submit';
import { DecisionChannel } from '../units/decision-channel';
import { UnitStore } from '../units/store';
import type { ReviewUnit } from '../units/types';
import { createDaemonApp, SseHub } from './app';
import { ReviewWorkerPool, type ReviewResult } from './pool';

/** Stable default port so launchd (Phase #23) and manual launches agree. Override with `--port=`. */
export const DEFAULT_DAEMON_PORT = 4319;
const DEFAULT_CONCURRENCY = 3;

const a = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  purple: '\x1b[38;5;99m',
  green: '\x1b[38;5;78m',
  red: '\x1b[38;5;204m',
  cyan: '\x1b[38;5;117m',
  gray: '\x1b[38;5;243m',
  white: '\x1b[97m',
};

export type DaemonOptions = { port?: number; concurrency?: number; open?: boolean };

/** Split `owner/name` for the narrative cache key; tolerate a bare name. */
function splitRepo(repo: string): { owner: string; name: string } {
  const slash = repo.indexOf('/');
  return slash === -1 ? { owner: 'local', name: repo } : { owner: repo.slice(0, slash), name: repo.slice(slash + 1) };
}

/** Run Phase 1's narrative pipeline for one unit. `toResolve` = the count of concerns to address. */
async function reviewUnit(unit: ReviewUnit): Promise<ReviewResult> {
  const config = await readConfig();
  const { owner, name } = splitRepo(unit.repo);
  const { narrative } = await generateNarrative(unit.metadata, unit.files, [], config, undefined, {
    // contentKey (not headSha) keys the cache — it moves with uncommitted edits, headSha doesn't.
    cacheKey: { owner, repo: name, number: 0, sha: unit.diffContentKey },
    comments: [],
  });
  return { narrative, toResolve: narrative.concerns?.length ?? 0 };
}

/**
 * Start the per-machine daemon: one long-lived process owning the cross-repo `UnitStore`, serving
 * the command center + units API + MCP endpoint, and draining the review queue through a bounded
 * worker pool. Unlike `dad review`/`dad watch`, it never exits on browser disconnect.
 */
export async function startDaemon(opts: DaemonOptions = {}): Promise<number> {
  const port = opts.port ?? DEFAULT_DAEMON_PORT;
  const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;

  const store = await UnitStore.load();
  const decision = new DecisionChannel();
  const hub = new SseHub();

  const pool = new ReviewWorkerPool({ store, review: reviewUnit, broadcast: hub.broadcast, concurrency });
  const computeSlice: ComputeSlice = (worktreePath, baseRef) => buildLocalReview(baseRef, { cwd: worktreePath });

  const { app } = createDaemonApp({
    store,
    decision,
    hub,
    computeSlice,
    onSubmitted: () => pool.kick(),
  });

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({ fetch: app.fetch, port, idleTimeout: 255 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n  ${a.red}${a.bold}error:${a.reset} could not bind port ${port}: ${msg}`);
    console.error(`  ${a.dim}A daemon may already be running. Try ${a.cyan}dad daemon status${a.reset}${a.dim}.${a.reset}\n`);
    return 1;
  }

  const url = `http://localhost:${server.port}`;
  const pending = store.list({ status: 'submitted' }).length + store.list({ status: 'reviewing' }).length;

  console.log(`\n  ${a.purple}${a.bold}Diff Dad${a.reset}  ${a.dim}—${a.reset}  ${a.white}daemon${a.reset}`);
  console.log(
    `  ${a.dim}${store.list().length} unit${store.list().length === 1 ? '' : 's'} loaded` +
      `${pending > 0 ? `, ${pending} resuming review` : ''}${a.reset}`,
  );
  console.log(`\n  ${a.purple}${a.bold}${url}${a.reset}`);
  console.log(`\n  ${a.dim}Point an agent at the review loop:${a.reset}`);
  console.log(`  ${a.cyan}claude mcp add --transport http diffdad ${url}/mcp${a.reset}`);
  console.log(
    `  ${a.dim}Then have it call ${a.reset}${a.cyan}submit_for_review${a.reset}${a.dim} and park on ${a.reset}${a.cyan}await_decision${a.reset}${a.dim}.${a.reset}\n`,
  );

  // Resume any work persisted across a restart (submitted never started; reviewing crashed mid-flight).
  pool.kick();

  if (opts.open) {
    const { default: open } = await import('open');
    await open(url);
  }

  await new Promise<never>(() => {}); // run until killed — the daemon is the long-lived process
  return 0;
}

/** Probe a running daemon for `dad daemon status`. Reports unit count or that nothing is listening. */
export async function daemonStatus(port = DEFAULT_DAEMON_PORT): Promise<number> {
  const url = `http://localhost:${port}/api/units`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) {
      console.log(`  ${a.red}daemon responded ${res.status}${a.reset} at ${a.cyan}localhost:${port}${a.reset}`);
      return 1;
    }
    const body = (await res.json()) as { units?: unknown[] };
    const n = body.units?.length ?? 0;
    console.log(`  ${a.green}● running${a.reset} ${a.dim}on${a.reset} ${a.cyan}localhost:${port}${a.reset} ${a.dim}— ${n} unit${n === 1 ? '' : 's'}${a.reset}`);
    return 0;
  } catch {
    console.log(`  ${a.gray}○ not running${a.reset} ${a.dim}(nothing listening on localhost:${port})${a.reset}`);
    console.log(`  ${a.dim}Start it with ${a.cyan}dad daemon${a.reset}${a.dim}.${a.reset}`);
    return 0;
  }
}
