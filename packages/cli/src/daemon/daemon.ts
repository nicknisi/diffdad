import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolveGitHubToken } from '../auth';
import { type OnConfigChange } from '../config-api';
import { dataDir } from '../paths';
import { DEFAULT_POLL_INTERVAL_MS, readConfig } from '../config';
import { GitHubClient, type PostCommentOptions } from '../github/client';
import { parseDiff } from '../github/diff-parser';
import type { CheckRun, PRComment, PRReview } from '../github/types';
import { cacheNarrative, computePromptMetaHash, getCachedNarrative } from '../narrative/cache';
import { callAi, generateNarrative, resolveProviderKey } from '../narrative/engine';
import { UnitStore } from '../units/store';
import type { ReviewUnit } from '../units/types';
import { createDaemonApp, type GitHubWiring, type ReviewInlineComment, SseHub } from './app';
import { pollOnce } from './poller';

/** Stable default port so launchd (Phase #23) and manual launches agree. Override with `--port=`. */
export const DEFAULT_DAEMON_PORT = 4319;

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

/**
 * True if the pidfile points at a live daemon process. Signal-0 probes the pid (as `dad daemon`'s
 * own guard does) rather than trusting mere file existence, so a stale pidfile from a crashed daemon
 * reads as down. Used by `dad config` to decide whether to open the settings URL in the browser.
 */
export function isDaemonAlive(): boolean {
  try {
    const pid = Number(readFileSync(PIDFILE, 'utf-8').trim());
    return Number.isInteger(pid) && pid > 0 && isProcessAlive(pid);
  } catch {
    // missing / unreadable / corrupt — no live daemon.
    return false;
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

/** A running poller's stop handle. `stop()` is idempotent — safe to call twice. */
export interface PollerHandle {
  stop(): void;
}

/**
 * Start the GitHub review-request poller on an interval. Runs one pass immediately, then every
 * `pollMs`. Each pass is wrapped so a transient GitHub/network failure logs a one-line warning and
 * never crashes the daemon.
 *
 * `poll` is the same on-demand pass `POST /api/poll` runs (`wiring.current.pollNow`), so the interval
 * poller and the manual refresh share one code path. Returns a stop handle — required so a live
 * re-wire can stop the old poller before starting a new one (avoiding two overlapping loops). The
 * first tick fires without being awaited so a re-wire's PUT never blocks on a full GitHub search.
 */
export function startPoller(poll: () => Promise<unknown>, pollMs: number): PollerHandle {
  let stopped = false;
  const tick = async () => {
    try {
      await poll();
    } catch (err) {
      console.warn(`[diffdad] review poll failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  void tick();
  const handle = setInterval(() => void tick(), pollMs);
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(handle);
    },
  };
}

/**
 * Assemble the GitHub-bound wiring from an (optional) authenticated client. `null` client → a dark
 * wiring (`github: false`, all deps absent) so the routes 503 / return empties. A live client wires
 * every GitHub-touching dep, including `pollNow` — the single pass the interval poller AND the manual
 * `/api/poll` both run over the shared search+store+broadcast+missStreaks state.
 */
export function buildGitHubWiring(
  client: GitHubClient | null,
  store: UnitStore,
  broadcast: SseHub['broadcast'],
  missStreaks: Map<string, number>,
): GitHubWiring {
  if (!client) return { github: false };
  const fetchPrState = makePrStateFetcher(client);
  return {
    github: true,
    hydrate: makeHydrate(client, store),
    commentFetcher: makeCommentFetcher(client),
    commentPoster: makeCommentPoster(client),
    reviewSubmitter: makeReviewSubmitter(client),
    statusFetcher: makeStatusFetcher(client),
    pollNow: () =>
      pollOnce({ search: () => client.searchReviewRequested(), store, broadcast, fetchPrState, missStreaks }),
  };
}

/**
 * The daemon's `OnConfigChange`: the piece that makes a saved token bring GitHub online without a
 * restart. Re-resolves and re-wires only when a relevant key changed:
 *   - `githubToken` changed → re-resolve (env → gh → config priority, so an env token still wins),
 *     rebuild the wiring, and stop+restart the poller (start-from-nothing when it just came online,
 *     stop when it went dark). Display-pref saves never shell out to `gh`.
 *   - `pollIntervalMs` changed (and GitHub is wired) → stop+restart the poller at the new cadence.
 * Returns `{ githubActive }` so the PUT response tells the saving tab the new effective state.
 * Extracted with injected collaborators so the re-wire is unit-testable without network or timers.
 */
export function makeConfigChangeHandler(deps: {
  wiring: { current: GitHubWiring };
  getPoller: () => PollerHandle | null;
  setPoller: (p: PollerHandle | null) => void;
  rebuildWiring: (token: string | null) => GitHubWiring;
  restartPoller: (pollMs: number) => PollerHandle | null;
  resolveToken: () => Promise<string | null>;
}): OnConfigChange {
  return async (prev, next) => {
    const tokenChanged = (prev.githubToken ?? '') !== (next.githubToken ?? '');
    const pollMs = next.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    if (tokenChanged) {
      const token = await deps.resolveToken();
      deps.wiring.current = deps.rebuildWiring(token);
      // Always restart: a daemon that just came online must start polling; a cleared token stops it.
      deps.getPoller()?.stop();
      deps.setPoller(deps.restartPoller(pollMs));
    } else if (deps.wiring.current.github) {
      const intervalChanged =
        (prev.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS) !== (next.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
      if (intervalChanged) {
        deps.getPoller()?.stop();
        deps.setPoller(deps.restartPoller(pollMs));
      }
    }
    return { githubActive: deps.wiring.current.github };
  };
}

/**
 * Lazily hydrate a `github` unit on open: fetch the PR's unified diff, parse it, generate the
 * Phase-1 narrative, attach both to the unit (no status transition — it stays `queued`), and return
 * the updated unit. Wired only when a GitHub client exists; otherwise the hydrate route no-ops.
 *
 * The narrative round-trips through the shared cache (`~/.cache/diffdad`) under the same key scheme
 * as `dad <pr>` — the unit file is not the only copy, so a reconciled/deleted unit costs a cache read
 * to restore, not a full regeneration, and daemon and CLI reuse each other's walkthroughs.
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
    // Pull the live PR: on force it advances the head SHA (+ refreshes title/branch) so the cache key
    // and diff track the current push; on both paths it supplies the real title/body/labels — the
    // mint-time metadata has an empty body, which would both starve the prompt and hash to a metaHash
    // no `dad <pr>` run ever produces.
    const meta = await client.getPR(owner, name, prNumber);
    let target = unit;
    if (force) {
      target = store.advanceHead(unit.unitId, meta.headSha, meta);
    }
    const config = await readConfig();
    const metaHash = computePromptMetaHash(meta);
    const providerKey = await resolveProviderKey(config);
    const sha = target.diffContentKey;

    const diff = await client.getPRDiff(owner, name, prNumber);
    const files = parseDiff(diff);

    if (!force) {
      const cached = await getCachedNarrative(owner, name, prNumber, sha, metaHash, providerKey);
      if (cached) {
        store.attachReview(unit.unitId, files, cached, cached.concerns?.length ?? 0);
        return store.get(unit.unitId)!;
      }
    }

    const promptMeta = { ...target.metadata, title: meta.title, body: meta.body, labels: meta.labels };
    const { narrative } = await generateNarrative(promptMeta, files, [], config, undefined, {
      // contentKey-style cache key: keyed on the head SHA carried in diffContentKey (advanced above on
      // a re-read). `force` skips the cache read but still writes, so the fresh prose replaces it.
      cacheKey: { owner, repo: name, number: prNumber, sha },
      comments: [],
      force,
    });
    store.attachReview(unit.unitId, files, narrative, narrative.concerns?.length ?? 0);
    try {
      await cacheNarrative(owner, name, prNumber, sha, metaHash, providerKey, narrative);
    } catch {
      // best-effort: the unit carries the narrative; a failed cache write must not fail the hydrate
    }
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

  // Resolve GitHub auth once at startup, then keep it live: the wiring holder lets a config PUT swap
  // in a new client (or a dark set) without a restart. No token → a dark wiring whose routes no-op.
  const config = await readConfig();
  const githubToken = await resolveGitHubToken();
  const githubClient = githubToken ? new GitHubClient(githubToken) : null;

  // Poll cadence: config wins, then the test seam, then the default. Promoted from the old `--poll=`.
  const pollMs = config.pollIntervalMs ?? opts.pollMs ?? DEFAULT_POLL_INTERVAL_MS;

  // One shared miss-streak map so the interval poller and the manual /api/poll reconcile against the
  // same streak state (a unit missing on one path then the other still removes at two total misses).
  const missStreaks = new Map<string, number>();

  // The mutable GitHub wiring + a poller handle the re-wire hook can stop/restart. `poller` is null
  // whenever GitHub is dark, so the handler can both start-from-nothing and restart.
  const wiring = { current: buildGitHubWiring(githubClient, store, hub.broadcast, missStreaks) };
  let poller: PollerHandle | null = null;

  const onConfigChange = makeConfigChangeHandler({
    wiring,
    getPoller: () => poller,
    setPoller: (p) => {
      poller = p;
    },
    rebuildWiring: (token) =>
      buildGitHubWiring(token ? new GitHubClient(token) : null, store, hub.broadcast, missStreaks),
    restartPoller: (ms) => (wiring.current.pollNow ? startPoller(wiring.current.pollNow, ms) : null),
    resolveToken: () => resolveGitHubToken(),
  });

  const { app } = createDaemonApp({
    store,
    hub,
    wiring,
    // AI works without a GitHub token (the default provider shells out to `claude -p`), so it's
    // always wired — the route reads config per-call, mirroring the PR server's /api/ai.
    ai: async (system, user) => callAi(await readConfig(), system, user),
    onConfigChange,
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
  // The first pass runs detached (not awaited); the interval then runs until re-wired or killed. With
  // no token the whole GitHub door is closed (no poll, no review-post, no lazy-narrate) — local units
  // still flow, and a token saved via PUT /api/config brings the poller online through onConfigChange.
  if (wiring.current.pollNow) {
    poller = startPoller(wiring.current.pollNow, pollMs);
  } else {
    console.log(
      `  ${a.gray}○${a.reset} ${a.dim}GitHub poller off — no token. Set ${a.reset}${a.cyan}DIFFDAD_GITHUB_TOKEN${a.reset}` +
        `${a.dim}, run ${a.reset}${a.cyan}gh auth login${a.reset}${a.dim}, or open Settings in the command center` +
        ` (${a.reset}${a.cyan}${url}/settings${a.reset}${a.dim}) to watch review requests.${a.reset}`,
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
