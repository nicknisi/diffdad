import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { resolveGitHubToken } from '../auth';
import { readConfig } from '../config';
import { GitHubClient, type PostCommentOptions } from '../github/client';
import { parseDiff } from '../github/diff-parser';
import type { CheckRun, PRComment, PRReview } from '../github/types';
import { buildLocalReview } from '../local/diff-source';
import { callAi, generateNarrative } from '../narrative/engine';
import type { ComputeSlice } from '../mcp/submit';
import { DecisionChannel } from '../units/decision-channel';
import { UnitStore } from '../units/store';
import type { Decision, ReviewUnit } from '../units/types';
import { createDaemonApp, type ReviewInlineComment, SseHub } from './app';
import { pollOnce } from './poller';
import { ReviewWorkerPool, type ReviewResult } from './pool';

/** Stable default port so launchd (Phase #23) and manual launches agree. Override with `--port=`. */
export const DEFAULT_DAEMON_PORT = 4319;
const DEFAULT_CONCURRENCY = 3;
/** Cadence for the GitHub review-request poller. One search per tick — well within auth'd rate limits. */
const DEFAULT_POLL_MS = 60_000;

/** Single-instance pidfile. Beside the rest of dad's state so a stale file is easy to find/clear. */
const PIDFILE = join(homedir(), '.cache', 'diffdad', 'daemon.pid');

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
    mkdirSync(join(homedir(), '.cache', 'diffdad'), { recursive: true });
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

export type DaemonOptions = { port?: number; concurrency?: number; open?: boolean; pollMs?: number };

/**
 * Start the GitHub review-request poller on an interval. Runs one pass at startup, then every
 * `pollMs`. Each pass is wrapped so a transient GitHub/network failure logs a one-line warning and
 * never crashes the daemon. The authenticated client is resolved once by the caller and shared with
 * the decision/hydrate deps, so there is a single source of truth for "is GitHub wired".
 */
async function startPoller(
  client: GitHubClient,
  store: UnitStore,
  broadcast: SseHub['broadcast'],
  pollMs: number,
): Promise<void> {
  const tick = async () => {
    try {
      await pollOnce({ search: () => client.searchReviewRequested(), store, broadcast });
    } catch (err) {
      console.warn(`[diffdad] review poll failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  await tick();
  setInterval(tick, pollMs);
}

/**
 * Post a `github` unit's verdict to GitHub as a real review. APPROVE / REQUEST_CHANGES per the
 * decision kind. The review body prefers the reviewer's free-form note; absent one, it summarizes
 * the curated concerns into a short line so the PR review is never blank. Throws on API failure —
 * the decision route relies on that to 502 and record NOTHING locally (dad ⇄ GitHub never disagree).
 */
function makeReviewPoster(client: GitHubClient): (unit: ReviewUnit, decision: Decision) => Promise<void> {
  return async (unit, decision) => {
    const { owner, name } = splitRepo(unit.repo);
    if (unit.prNumber === undefined) {
      throw new Error(`unit ${unit.unitId} has no PR number`);
    }
    const event = decision.kind === 'approved' ? 'APPROVE' : 'REQUEST_CHANGES';
    let body = (decision.note && decision.note.trim()) || summarizeConcerns(decision);
    // GitHub rejects a REQUEST_CHANGES review with an empty body (422); an empty APPROVE body is fine.
    if (!body && event === 'REQUEST_CHANGES') body = 'Changes requested — see Diff Dad.';
    await client.submitReview(owner, name, unit.prNumber, event, body);
  };
}

/** A short review body built from the curated concerns when the reviewer left no free-form note. */
function summarizeConcerns(decision: Decision): string {
  const questions = (decision.concerns ?? []).map((c) => c.question).filter(Boolean);
  if (questions.length === 0) return '';
  return questions.map((q) => `- ${q}`).join('\n');
}

/**
 * Lazily hydrate a `github` unit on open: fetch the PR's unified diff, parse it, generate the
 * Phase-1 narrative, attach both to the unit (no status transition — it stays `queued`), and return
 * the updated unit. Wired only when a GitHub client exists; otherwise the hydrate route no-ops.
 */
function makeHydrate(client: GitHubClient, store: UnitStore): (unit: ReviewUnit) => Promise<ReviewUnit> {
  return async (unit) => {
    const { owner, name } = splitRepo(unit.repo);
    if (unit.prNumber === undefined) {
      throw new Error(`unit ${unit.unitId} has no PR number`);
    }
    const diff = await client.getPRDiff(owner, name, unit.prNumber);
    const files = parseDiff(diff);
    const { narrative } = await generateNarrative(unit.metadata, files, [], await readConfig(), undefined, {
      // contentKey-style cache key: keyed on the head SHA carried in diffContentKey at mint time.
      cacheKey: { owner, repo: name, number: unit.prNumber, sha: unit.diffContentKey },
      comments: [],
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
  const decision = new DecisionChannel();
  const hub = new SseHub();

  const pool = new ReviewWorkerPool({ store, review: reviewUnit, broadcast: hub.broadcast, concurrency });
  const computeSlice: ComputeSlice = (worktreePath, baseRef) => buildLocalReview(baseRef, { cwd: worktreePath });

  // Resolve GitHub auth once: the same client drives the poller AND the github decision/hydrate deps.
  // No token → all three are skipped/undefined and the routes no-op gracefully (local units still work).
  const githubToken = await resolveGitHubToken();
  const githubClient = githubToken ? new GitHubClient(githubToken) : null;

  const { app } = createDaemonApp({
    store,
    decision,
    hub,
    computeSlice,
    onSubmitted: () => pool.kick(),
    reviewPoster: githubClient ? makeReviewPoster(githubClient) : undefined,
    hydrate: githubClient ? makeHydrate(githubClient, store) : undefined,
    commentFetcher: githubClient ? makeCommentFetcher(githubClient) : undefined,
    commentPoster: githubClient ? makeCommentPoster(githubClient) : undefined,
    reviewSubmitter: githubClient ? makeReviewSubmitter(githubClient) : undefined,
    statusFetcher: githubClient ? makeStatusFetcher(githubClient) : undefined,
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

  // Open the GitHub "reviews requested of me" door: poll on an interval, mint/link/resurface units.
  // Awaited only through the initial pass; the interval then runs detached. With no token the whole
  // GitHub door is closed (no poll, no review-post, no lazy-narrate) — local units still flow.
  if (githubClient) {
    await startPoller(githubClient, store, hub.broadcast, pollMs);
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
