import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolveGitHubToken } from '../auth';
import { dataDir } from '../paths';
import { readConfig } from '../config';
import { GitHubClient, type PostCommentOptions } from '../github/client';
import { parseDiff } from '../github/diff-parser';
import type { CheckRun, PRComment, PRReview } from '../github/types';
import { callAi, generateNarrative } from '../narrative/engine';
import { UnitStore } from '../units/store';
import type { ReviewUnit } from '../units/types';
import { createDaemonApp, type ReviewInlineComment, SseHub } from './app';
import { pollOnce } from './poller';

/** Stable default port so launchd (Phase #23) and manual launches agree. Override with `--port=`. */
export const DEFAULT_DAEMON_PORT = 4319;
/** Cadence for the GitHub review-request poller. One search per tick — well within auth'd rate limits. */
const DEFAULT_POLL_MS = 60_000;

/** Single-instance pidfile. Beside the rest of dad's state so a stale file is easy to find/clear. */
const PIDFILE = join(dataDir(), 'daemon.pid');

/** True if a process with this pid is alive (signal 0 probes without delivering a signal). */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = exists but not ours (still alive); ESRCH = no such process.
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The live, foreign pid the pidfile points at, or null (missing / stale / unreadable / ours). */
function readConflictingPid(): number | null {
  try {
    const existing = Number(readFileSync(PIDFILE, 'utf-8').trim());
    if (Number.isInteger(existing) && existing > 0 && existing !== process.pid && isProcessAlive(existing)) {
      return existing;
    }
  } catch {
    // missing / unreadable / corrupt
  }
  return null;
}

/**
 * Single-instance guard. If the pidfile points at a live process, returns that pid so the caller can
 * refuse to start a second daemon. A stale pidfile (no live process / unreadable) is overwritten with
 * ours. Best-effort: an unwritable pidfile never blocks startup.
 *
 * The one retry absorbs the `install()` bootout→bootstrap race: a relaunched launchd copy can start
 * before the prior daemon has finished releasing its pidfile. We give it a brief beat and re-check —
 * only a pid that is *still* live is a real conflict — so a reinstall doesn't false-positive into a
 * (now clean-exit, non-respawning) refusal.
 */
async function claimPidfile(): Promise<{ conflict: number | null }> {
  if (readConflictingPid() !== null) {
    await new Promise((r) => setTimeout(r, 300));
    const still = readConflictingPid();
    if (still !== null) return { conflict: still };
  }
  try {
    mkdirSync(dataDir(), { recursive: true });
    writeFileSync(PIDFILE, String(process.pid));
  } catch {
    // best-effort: can't persist the pidfile, but don't block the daemon on it.
  }
  return { conflict: null };
}

/** Remove our pidfile on exit. Idempotent; only unlinks if it still holds *our* pid. */
function releasePidfile(): void {
  try {
    if (readFileSync(PIDFILE, 'utf-8').trim() === String(process.pid)) {
      rmSync(PIDFILE, { force: true });
    }
  } catch {
    // already gone / unreadable — nothing to do.
  }
}

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

export type DaemonOptions = { port?: number; open?: boolean; pollMs?: number };

/**
 * Start the GitHub review-request poller on an interval. Runs one pass at startup, then every
 * `pollMs`. Each pass is wrapped so a transient GitHub/network failure logs a one-line warning and
 * never crashes the daemon. The authenticated client is resolved once by the caller and shared with
 * the review/hydrate deps, so there is a single source of truth for "is GitHub wired".
 */
async function startPoller(
  client: GitHubClient,
  store: UnitStore,
  broadcast: SseHub['broadcast'],
  pollMs: number,
  fetchPrState: (unit: ReviewUnit) => Promise<{ open: boolean }>,
  missStreaks: Map<string, number>,
): Promise<void> {
  const tick = async () => {
    try {
      await pollOnce({ search: () => client.searchReviewRequested(), store, broadcast, fetchPrState, missStreaks });
    } catch (err) {
      console.warn(`[diffdad] review poll failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  await tick();
  setInterval(tick, pollMs);
}

/**
 * Lazily hydrate a `github` unit on open: fetch the PR's unified diff, parse it, generate the
 * Phase-1 narrative, attach both to the unit (no status transition — it stays `queued`), and return
 * the updated unit. Wired only when a GitHub client exists; otherwise the hydrate route no-ops.
 *
 * `force` powers the per-PR re-read: fetch the PR live first to advance the unit to the current head
 * SHA (+ fresh title/branch), then bypass the narrative cache READ so a same-SHA regeneration yields
 * new prose instead of replaying the cached walkthrough. The non-force path is unchanged.
 */
function makeHydrate(
  client: GitHubClient,
  store: UnitStore,
): (unit: ReviewUnit, force?: boolean) => Promise<ReviewUnit> {
  return async (unit, force = false) => {
    const { owner, name } = splitRepo(unit.repo);
    const prNumber = unit.prNumber;
    if (prNumber === undefined) {
      throw new Error(`unit ${unit.unitId} has no PR number`);
    }
    // Re-read: pull the live PR to advance the head SHA (+ refresh title/branch) so the cache key and
    // diff track the current push, not the SHA frozen at mint.
    let target = unit;
    if (force) {
      const meta = await client.getPR(owner, name, prNumber);
      target = store.advanceHead(unit.unitId, meta.headSha, meta);
    }
    const diff = await client.getPRDiff(owner, name, prNumber);
    const files = parseDiff(diff);
    const { narrative } = await generateNarrative(target.metadata, files, [], await readConfig(), undefined, {
      // contentKey-style cache key: keyed on the head SHA carried in diffContentKey (advanced above on
      // a re-read). `force` skips the cache read but still writes, so the fresh prose replaces it.
      cacheKey: { owner, repo: name, number: prNumber, sha: target.diffContentKey },
      comments: [],
      force,
    });
    store.attachReview(unit.unitId, files, narrative, narrative.concerns?.length ?? 0);
    return store.get(unit.unitId)!;
  };
}

/**
 * Fetch a `github` unit's live comments from GitHub (review + issue comments, already normalized to
 * `PRComment[]` by the client). Wired only when a GitHub client exists; otherwise the comments route
 * returns []. Comments are read live, never persisted on the unit — so dad mirrors the PR exactly.
 */
function makeCommentFetcher(client: GitHubClient): (unit: ReviewUnit) => Promise<PRComment[]> {
  return (unit) => {
    const { owner, name } = splitRepo(unit.repo);
    if (unit.prNumber === undefined) throw new Error(`unit ${unit.unitId} has no PR number`);
    return client.getComments(owner, name, unit.prNumber);
  };
}

/**
 * Post a comment to a `github` unit's PR (inline or top-level). The route supplies a `commitId`
 * (defaulting to the unit's head SHA) so inline comments anchor correctly. Throws on API failure —
 * the route relies on that to 502 and surface nothing locally that isn't really on GitHub.
 */
function makeCommentPoster(
  client: GitHubClient,
): (unit: ReviewUnit, body: string, opts: PostCommentOptions) => Promise<PRComment> {
  return (unit, body, opts) => {
    const { owner, name } = splitRepo(unit.repo);
    if (unit.prNumber === undefined) throw new Error(`unit ${unit.unitId} has no PR number`);
    return client.postComment(owner, name, unit.prNumber, body, opts);
  };
}

/**
 * Submit a full GitHub review for a `github` unit: event + summary body + batched inline comments,
 * in one API call. Throws on failure — the review route relies on that to 502 and record nothing
 * locally, so a verdict never lands in dad that isn't really on GitHub.
 */
function makeReviewSubmitter(
  client: GitHubClient,
): (
  unit: ReviewUnit,
  event: 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES',
  body: string | undefined,
  comments: ReviewInlineComment[],
) => Promise<void> {
  return async (unit, event, body, comments) => {
    const { owner, name } = splitRepo(unit.repo);
    if (unit.prNumber === undefined) throw new Error(`unit ${unit.unitId} has no PR number`);
    await client.submitReview(owner, name, unit.prNumber, event, body, comments);
  };
}

/**
 * Fetch a `github` unit's CI checks + GitHub reviews (its merge-readiness context for the drill-in).
 * Checks key off the head SHA, reviews off the PR number. Read live; never stored on the unit.
 */
function makeStatusFetcher(
  client: GitHubClient,
): (unit: ReviewUnit) => Promise<{ checks: CheckRun[]; reviews: PRReview[] }> {
  return async (unit) => {
    const { owner, name } = splitRepo(unit.repo);
    if (unit.prNumber === undefined) throw new Error(`unit ${unit.unitId} has no PR number`);
    const [checks, reviews] = await Promise.all([
      client.getCheckRuns(owner, name, unit.metadata.headSha),
      client.getReviews(owner, name, unit.prNumber),
    ]);
    return { checks, reviews };
  };
}

/**
 * Fetch a `github` unit's PR open/closed state for the poller's queue reconciliation. A merged PR is
 * closed on GitHub, so `state === 'open'` is the only distinction the reconciler needs. Wired only when
 * a GitHub client exists; throws on API failure so the reconciler treats it as "no evidence" and skips.
 */
function makePrStateFetcher(client: GitHubClient): (unit: ReviewUnit) => Promise<{ open: boolean }> {
  return async (unit) => {
    const { owner, name } = splitRepo(unit.repo);
    if (unit.prNumber === undefined) throw new Error(`unit ${unit.unitId} has no PR number`);
    const pr = await client.getPR(owner, name, unit.prNumber);
    return { open: pr.state === 'open' };
  };
}

/** Split `owner/name` for the narrative cache key; tolerate a bare name. */
function splitRepo(repo: string): { owner: string; name: string } {
  const slash = repo.indexOf('/');
  return slash === -1 ? { owner: 'local', name: repo } : { owner: repo.slice(0, slash), name: repo.slice(slash + 1) };
}

/**
 * Start the per-machine daemon: one long-lived process owning the cross-repo `UnitStore`, serving
 * the command center + units API for GitHub PR review, and polling GitHub for review requests.
 * Unlike `dad review`, it never exits on browser disconnect.
 */
export async function startDaemon(opts: DaemonOptions = {}): Promise<number> {
  const port = opts.port ?? DEFAULT_DAEMON_PORT;
  const pollFlag = Bun.argv.find((f) => f.startsWith('--poll='));
  const pollMs =
    opts.pollMs ?? (pollFlag ? parseInt(pollFlag.split('=')[1] ?? '0', 10) || undefined : undefined) ?? DEFAULT_POLL_MS;

  // Single-instance guard (FailureModes: launchd + a manual `dad daemon` → split queue / port conflict).
  // Refusing is an intentional, *successful* outcome — a daemon is already up — so we exit 0. The plist's
  // KeepAlive is {SuccessfulExit:false}, so exit 0 does NOT trigger a respawn; exiting non-zero here would
  // tight-loop a launchd copy against a manual daemon.
  const claim = await claimPidfile();
  if (claim.conflict !== null) {
    console.log(
      `\n  ${a.purple}${a.bold}Diff Dad${a.reset} ${a.dim}—${a.reset} a daemon is already running ${a.dim}(pid ${claim.conflict})${a.reset}.`,
    );
    console.log(
      `  ${a.dim}Check it with ${a.cyan}dad daemon status${a.reset}${a.dim}, or stop that process first.${a.reset}\n`,
    );
    return 0;
  }
  // Clean up the pidfile on every shutdown path. `exit` fires for normal returns / process.exit;
  // the signal handlers turn Ctrl-C / launchctl-stop into a clean exit (which then runs `exit`).
  process.once('exit', releasePidfile);
  process.once('SIGINT', () => process.exit(130));
  process.once('SIGTERM', () => process.exit(143));

  const store = await UnitStore.load();
  const hub = new SseHub();

  // Resolve GitHub auth once: the same client drives the poller AND the github review/hydrate deps.
  // No token → the deps are undefined and the routes no-op gracefully.
  const githubToken = await resolveGitHubToken();
  const githubClient = githubToken ? new GitHubClient(githubToken) : null;

  // One shared miss-streak map so the interval poller and the manual /api/poll reconcile against the
  // same streak state (a unit missing on one path then the other still removes at two total misses).
  const missStreaks = new Map<string, number>();
  const fetchPrState = githubClient ? makePrStateFetcher(githubClient) : undefined;

  const { app } = createDaemonApp({
    store,
    hub,
    github: Boolean(githubClient),
    hydrate: githubClient ? makeHydrate(githubClient, store) : undefined,
    commentFetcher: githubClient ? makeCommentFetcher(githubClient) : undefined,
    commentPoster: githubClient ? makeCommentPoster(githubClient) : undefined,
    reviewSubmitter: githubClient ? makeReviewSubmitter(githubClient) : undefined,
    statusFetcher: githubClient ? makeStatusFetcher(githubClient) : undefined,
    // Manual refresh runs the identical pass startPoller does — one on-demand `pollOnce` over the same
    // search+store+broadcast. No token → undefined and the /api/poll route 503s.
    pollNow: githubClient
      ? () =>
          pollOnce({
            search: () => githubClient.searchReviewRequested(),
            store,
            broadcast: hub.broadcast,
            fetchPrState,
            missStreaks,
          })
      : undefined,
    // AI works without a GitHub token (the default provider shells out to `claude -p`), so it's
    // always wired — the route reads config per-call, mirroring the PR server's /api/ai.
    ai: async (system, user) => callAi(await readConfig(), system, user),
  });

  let server: ReturnType<typeof Bun.serve>;
  try {
    server = Bun.serve({ fetch: app.fetch, port, idleTimeout: 255 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n  ${a.red}${a.bold}error:${a.reset} could not bind port ${port}: ${msg}`);
    console.error(
      `  ${a.dim}A daemon may already be running. Try ${a.cyan}dad daemon status${a.reset}${a.dim}.${a.reset}\n`,
    );
    return 1;
  }

  const url = `http://localhost:${server.port}`;

  console.log(`\n  ${a.purple}${a.bold}Diff Dad${a.reset}  ${a.dim}—${a.reset}  ${a.white}daemon${a.reset}`);
  console.log(`  ${a.dim}${store.list().length} unit${store.list().length === 1 ? '' : 's'} loaded${a.reset}`);
  console.log(`\n  ${a.purple}${a.bold}${url}${a.reset}`);
  console.log(`\n  ${a.dim}Watching GitHub for review requests.${a.reset}`);

  // Open the GitHub "reviews requested of me" door: poll on an interval, mint/link/resurface units.
  // Awaited only through the initial pass; the interval then runs detached. With no token the whole
  // GitHub door is closed (no poll, no review-post, no lazy-narrate) — local units still flow.
  if (githubClient) {
    await startPoller(githubClient, store, hub.broadcast, pollMs, fetchPrState!, missStreaks);
  } else {
    console.log(
      `  ${a.gray}○${a.reset} ${a.dim}GitHub poller off — no token. Set ${a.reset}${a.cyan}DIFFDAD_GITHUB_TOKEN${a.reset}` +
        `${a.dim}, run ${a.reset}${a.cyan}gh auth login${a.reset}${a.dim}, or ${a.reset}${a.cyan}dad config${a.reset}` +
        `${a.dim} to watch review requests.${a.reset}`,
    );
  }

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
    console.log(
      `  ${a.green}● running${a.reset} ${a.dim}on${a.reset} ${a.cyan}localhost:${port}${a.reset} ${a.dim}— ${n} unit${n === 1 ? '' : 's'}${a.reset}`,
    );
    return 0;
  } catch {
    console.log(`  ${a.gray}○ not running${a.reset} ${a.dim}(nothing listening on localhost:${port})${a.reset}`);
    console.log(`  ${a.dim}Start it with ${a.cyan}dad daemon${a.reset}${a.dim}.${a.reset}`);
    return 0;
  }
}
