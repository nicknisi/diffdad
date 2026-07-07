import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDaemonApp, type GitHubWiring, SseHub } from '../daemon/app';
import { makeConfigChangeHandler } from '../daemon/daemon';
import { readConfig } from '../config';
import type { ConfigResponse } from '../config-api';
import { UnitStore } from '../units/store';
import type { PRMetadata } from '../github/types';
import type { NarrativeResponse } from '../narrative/types';

const NARRATIVE: NarrativeResponse = {
  title: 't',
  tldr: 'td',
  verdict: 'risky',
  readingPlan: [],
  concerns: [],
  chapters: [],
};

function mkMetadata(): PRMetadata {
  return {
    number: 7,
    title: 'feat/x',
    body: '',
    state: 'open',
    draft: false,
    author: { login: 'octocat', avatarUrl: '' },
    branch: 'feat/x',
    base: 'main',
    labels: [],
    createdAt: 'now',
    updatedAt: 'now',
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    commits: 0,
    headSha: 'sha-1',
  };
}

let dir: string;
let prevXdg: string | undefined;
beforeEach(async () => {
  prevXdg = process.env.XDG_CONFIG_HOME;
  dir = await mkdtemp(join(tmpdir(), 'diffdad-rewire-'));
  process.env.XDG_CONFIG_HOME = dir;
});
afterEach(async () => {
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  await rm(dir, { recursive: true, force: true });
});

/**
 * A daemon app that starts GitHub-dark, wired to the real config-change handler with faked
 * collaborators — so we can drive a token PUT and watch the wiring swap + poller lifecycle without
 * network or real timers. `resolveToken` reads the (just-written) config, so clearing the token darks
 * the wiring the same way a real cleared credential would.
 */
function harness() {
  let idSeq = 0;
  const store = new UnitStore([], { dir, genId: () => `unit-${++idSeq}`, now: () => '2026-06-26T00:00:00.000Z' });
  const hub = new SseHub();
  const wiring = { current: { github: false } as GitHubWiring };

  const fakeHydrate = async (unit: { unitId: string }) => store.attachReview(unit.unitId, [], NARRATIVE, 0);
  const liveWiring = (): GitHubWiring => ({
    github: true,
    hydrate: fakeHydrate,
    pollNow: async () => ({ minted: 0, resurfaced: 0, removed: 0 }),
  });

  let poller: { stop(): void } | null = null;
  const stopCalls: number[] = [];
  const restartCalls: number[] = [];
  let handleSeq = 0;

  const onConfigChange = makeConfigChangeHandler({
    wiring,
    getPoller: () => poller,
    setPoller: (p) => {
      poller = p;
    },
    rebuildWiring: (token) => (token ? liveWiring() : { github: false }),
    restartPoller: (pollMs) => {
      if (!wiring.current.github) return null;
      restartCalls.push(pollMs);
      const id = ++handleSeq;
      return { stop: () => stopCalls.push(id) };
    },
    resolveToken: async () => (await readConfig()).githubToken ?? null,
  });

  const { app } = createDaemonApp({ store, hub, wiring, onConfigChange });
  return { store, wiring, app, stopCalls, restartCalls, getPoller: () => poller };
}

function seedUnit(store: UnitStore) {
  return store.addGithubUnit({
    owner: 'octo',
    repo: 'demo',
    number: 7,
    title: 'Add widgets',
    headBranch: 'feat/widgets',
    headSha: 'sha-1',
    author: 'octocat',
    url: 'https://github.com/octo/demo/pull/7',
    metadata: mkMetadata(),
  });
}

const putConfig = (app: Hono, body: unknown) =>
  app.request('/api/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
const hydrate = (app: Hono, id: string) => app.request(`/api/units/${id}/hydrate`, { method: 'POST' });

describe('daemon live re-wire via PUT /api/config', () => {
  it('a token PUT brings a dark daemon online: wiring swaps, hydrate flips 503 → 200, poller starts', async () => {
    const h = harness();
    const gh = seedUnit(h.store);

    // Dark: the hydrate route can't reach a fetcher.
    expect((await hydrate(h.app, gh.unitId)).status).toBe(503);
    expect(h.wiring.current.github).toBe(false);

    const res = await putConfig(h.app, { githubToken: 'ghp_live' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ConfigResponse;
    expect(body.github.active).toBe(true); // the saving tab learns GitHub is live now

    // The SAME app instance — no rebuild — now reaches the freshly-wired hydrate.
    expect(h.wiring.current.github).toBe(true);
    const after = await hydrate(h.app, gh.unitId);
    expect(after.status).toBe(200);
    expect(((await after.json()) as { unit: { narrative: unknown } }).unit.narrative).toEqual(NARRATIVE);

    // The poller came online.
    expect(h.restartCalls).toHaveLength(1);
    expect(h.getPoller()).not.toBeNull();
  });

  it('clearing the token darks the daemon: wiring goes dark, hydrate 503s, poller stops', async () => {
    const h = harness();
    const gh = seedUnit(h.store);
    await putConfig(h.app, { githubToken: 'ghp_live' }); // online first
    expect((await hydrate(h.app, gh.unitId)).status).toBe(200);

    const res = await putConfig(h.app, { githubToken: '' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ConfigResponse).github.active).toBe(false);

    expect(h.wiring.current.github).toBe(false);
    // Re-seed a fresh (un-narrated) unit to prove the dark hydrate route 503s again.
    const fresh = seedUnit(h.store);
    expect((await hydrate(h.app, fresh.unitId)).status).toBe(503);
    expect(h.stopCalls).toHaveLength(1); // the online poller was stopped
    expect(h.getPoller()).toBeNull();
  });

  it('an interval-only change restarts the poller without touching the wiring', async () => {
    const h = harness();
    const gh = seedUnit(h.store);
    await putConfig(h.app, { githubToken: 'ghp_live' }); // online, poller #1 @ 60s default
    expect(h.restartCalls).toEqual([60_000]);

    const res = await putConfig(h.app, { pollIntervalMs: 30_000 });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ConfigResponse).github.active).toBe(true);

    // Wiring untouched — hydrate still works — but the poller was stopped and restarted at 30s.
    expect(h.wiring.current.github).toBe(true);
    expect((await hydrate(h.app, gh.unitId)).status).toBe(200);
    expect(h.stopCalls).toHaveLength(1); // old poller stopped once
    expect(h.restartCalls).toEqual([60_000, 30_000]); // restarted at the new cadence
  });

  it('a display-only change never resolves a token or touches the poller', async () => {
    const h = harness();
    await putConfig(h.app, { githubToken: 'ghp_live' }); // online, poller #1
    const restartsBefore = h.restartCalls.length;
    const stopsBefore = h.stopCalls.length;

    const res = await putConfig(h.app, { theme: 'dark' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ConfigResponse).github.active).toBe(true); // unchanged

    expect(h.restartCalls).toHaveLength(restartsBefore); // no poller churn
    expect(h.stopCalls).toHaveLength(stopsBefore);
  });
});
