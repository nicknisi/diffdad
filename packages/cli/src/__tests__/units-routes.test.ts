import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnitStore } from '../units/store';
import { createDaemonApp, SseHub } from '../daemon/app';
import type { CheckRun, PRComment, PRMetadata, PRReview } from '../github/types';
import type { PostCommentOptions } from '../github/client';
import type { ReviewUnit } from '../units/types';
import type { NarrativeResponse } from '../narrative/types';
import type { CollapseResult } from '../narrative/collapse';
import type { PromptCapStats } from '../narrative/prompt';
import type { DiffFile } from '../github/types';
import type { RepoContext } from '../repo/snapshot';

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
    number: 0,
    title: 'feat/x',
    body: '',
    state: 'open',
    draft: false,
    author: { login: 'local', avatarUrl: '' },
    branch: 'feat/x',
    base: 'main',
    labels: [],
    createdAt: 'now',
    updatedAt: 'now',
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    commits: 0,
    headSha: 'abc',
  };
}

function deterministic() {
  let id = 0;
  return { genId: () => `unit-${++id}`, now: () => '2026-06-26T00:00:00.000Z' };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'diffdad-units-routes-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';
type SubmitInlineComment = { path: string; line: number; body: string; side?: 'LEFT' | 'RIGHT' };

type SetupOpts = {
  hydrate?: (unit: ReviewUnit, force?: boolean) => Promise<ReviewUnit>;
  repoContextFetcher?: (unit: ReviewUnit) => Promise<RepoContext>;
  commentFetcher?: (unit: ReviewUnit) => Promise<PRComment[]>;
  commentPoster?: (unit: ReviewUnit, body: string, opts: PostCommentOptions) => Promise<PRComment>;
  reviewSubmitter?: (
    unit: ReviewUnit,
    event: ReviewEvent,
    body: string | undefined,
    comments: SubmitInlineComment[],
  ) => Promise<void>;
  ai?: (system: string, user: string) => Promise<{ text: string }>;
  statusFetcher?: (unit: ReviewUnit) => Promise<{ checks: CheckRun[]; reviews: PRReview[] }>;
  pollNow?: () => Promise<{ minted: number; resurfaced: number; removed: number }>;
  prFetcher?: (owner: string, repo: string, number: number) => Promise<PRMetadata>;
  fileSummaryFetcher?: (
    owner: string,
    repo: string,
    number: number,
  ) => Promise<{ files: { path: string; status: string; additions: number; deletions: number }[]; truncated: boolean }>;
  github?: boolean;
};

function setup(opts: SetupOpts = {}) {
  const { hydrate, commentFetcher, commentPoster, reviewSubmitter, ai } = opts;
  const { statusFetcher, pollNow, repoContextFetcher, prFetcher, fileSummaryFetcher } = opts;
  const store = new UnitStore([], { dir, ...deterministic() });
  const hub = new SseHub();
  const events: string[] = [];
  const messages: Array<{ event: string; data: unknown }> = [];
  hub.add((event, data) => {
    events.push(event);
    messages.push({ event, data });
  });
  const { app } = createDaemonApp({
    store,
    hub,
    // GitHub-bound deps now live behind a mutable holder read at request time (was flat deps).
    wiring: {
      current: {
        github: opts.github ?? false,
        hydrate,
        commentFetcher,
        commentPoster,
        reviewSubmitter,
        statusFetcher,
        repoContextFetcher,
        pollNow,
        prFetcher,
        fileSummaryFetcher,
      },
    },
    ai,
  });
  return { store, hub, events, messages, app };
}

function seedGithubUnit(store: UnitStore, over: { number?: number; headSha?: string } = {}) {
  return store.addGithubUnit({
    owner: 'octo',
    repo: 'demo',
    number: over.number ?? 7,
    title: 'Add widgets',
    headBranch: 'feat/widgets',
    headSha: over.headSha ?? 'sha-1',
    author: 'octocat',
    url: 'https://github.com/octo/demo/pull/7',
    metadata: { ...mkMetadata(), headSha: over.headSha ?? 'sha-1' },
  });
}

async function addUnit(store: UnitStore, repo = 'owner/a') {
  const [owner, name] = repo.split('/');
  return store.addGithubUnit({
    owner: owner!,
    repo: name!,
    number: 1,
    title: 't',
    headBranch: 'feat/x',
    headSha: 'abc',
    author: 'octocat',
    url: `https://github.com/${repo}/pull/1`,
    metadata: mkMetadata(),
  });
}

describe('GET /api/narrative (command-center bootstrap)', () => {
  it('declares command-center mode and seeds the current queue', async () => {
    const { store, app } = setup();
    await addUnit(store, 'owner/a');
    await addUnit(store, 'owner/b');
    const res = await app.request('/api/narrative');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string; units: { repo: string }[] };
    expect(body.mode).toBe('command-center');
    expect(body.units.map((u) => u.repo).sort()).toEqual(['owner/a', 'owner/b']);
  });
});

describe('GET /api/units', () => {
  it('lists all units', async () => {
    const { store, app } = setup();
    await addUnit(store);
    await addUnit(store);
    const res = await app.request('/api/units');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { units: { unitId: string }[] };
    expect(body.units.map((u) => u.unitId)).toEqual(['unit-1', 'unit-2']);
  });

  it('filters by status and repo', async () => {
    const { store, app } = setup();
    await addUnit(store, 'owner/a'); // unit-1, queued
    const u2 = await addUnit(store, 'owner/b'); // unit-2, queued
    await store.setDecision(u2.unitId, { kind: 'approved' }); // unit-2 → approved

    const byStatus = (await (await app.request('/api/units?status=approved')).json()) as {
      units: { unitId: string }[];
    };
    expect(byStatus.units.map((u) => u.unitId)).toEqual(['unit-2']);

    const byRepo = (await (await app.request('/api/units?repo=owner/a')).json()) as { units: { unitId: string }[] };
    expect(byRepo.units.map((u) => u.unitId)).toEqual(['unit-1']);
  });

  it('emits the daemon GitHub-credential flag so the command center can flag the degraded state', async () => {
    const off = (await (await setup({ github: false }).app.request('/api/units')).json()) as { github: boolean };
    expect(off.github).toBe(false);
    const on = (await (await setup({ github: true }).app.request('/api/units')).json()) as { github: boolean };
    expect(on.github).toBe(true);
  });
});

describe('POST /api/units (add any PR)', () => {
  /** A `prFetcher` that records what it was asked for and answers with that PR's metadata. */
  function prFetcherSpy(over: Partial<PRMetadata> = {}) {
    const calls: Array<{ owner: string; repo: string; number: number }> = [];
    const fetcher = async (owner: string, repo: string, number: number): Promise<PRMetadata> => {
      calls.push({ owner, repo, number });
      return { ...mkMetadata(), number, title: 'Ship the thing', branch: 'feat/thing', headSha: 'sha-live', ...over };
    };
    return { calls, fetcher };
  }

  const post = (app: ReturnType<typeof setup>['app'], body: unknown) =>
    app.request('/api/units', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('mints a pinned, queued unit from a PR URL and broadcasts the new queue', async () => {
    const { calls, fetcher } = prFetcherSpy();
    const { app, store, messages } = setup({ github: true, prFetcher: fetcher });

    const res = await post(app, { pr: 'https://github.com/octo/demo/pull/42' });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { unit: ReviewUnit; existing: boolean };
    expect(body.existing).toBe(false);
    expect(calls).toEqual([{ owner: 'octo', repo: 'demo', number: 42 }]);
    expect(body.unit).toMatchObject({
      repo: 'octo/demo',
      prNumber: 42,
      status: 'queued',
      pinned: true, // the whole point: the poller's reconciliation must leave it alone
      taskLabel: 'Ship the thing',
      prUrl: 'https://github.com/octo/demo/pull/42',
    });
    // Minting must not fetch a diff or narrate — the drill-in hydrates lazily on open.
    expect(body.unit.narrative).toBeUndefined();
    expect(body.unit.files).toEqual([]);
    // The cache key tracks the LIVE head, not whatever a search happened to report.
    expect(body.unit.diffContentKey).toBe('sha-live');
    expect(store.list()).toHaveLength(1);
    const units = messages.filter((m) => m.event === 'units');
    expect(units).toHaveLength(1); // every open tab repaints with the new PR
  });

  it('accepts the owner/repo#123 shorthand, same as `dad <pr>`', async () => {
    const { calls, fetcher } = prFetcherSpy();
    const { app } = setup({ github: true, prFetcher: fetcher });
    const res = await post(app, { pr: '  octo/demo#7  ' });
    expect(res.status).toBe(201);
    expect(calls).toEqual([{ owner: 'octo', repo: 'demo', number: 7 }]);
  });

  it('returns the existing unit (200, existing:true) for a PR already in the queue — without a fetch', async () => {
    const { calls, fetcher } = prFetcherSpy();
    const { app, store, messages } = setup({ github: true, prFetcher: fetcher });
    const seeded = seedGithubUnit(store); // octo/demo#7

    const res = await post(app, { pr: 'https://github.com/octo/demo/pull/7' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { unit: ReviewUnit; existing: boolean };
    expect(body.existing).toBe(true);
    expect(body.unit.unitId).toBe(seeded.unitId); // navigate to the review already in progress
    expect(store.list()).toHaveLength(1); // never a second unit for one PR
    expect(calls).toHaveLength(0); // dedupe happens before the network
    expect(messages.filter((m) => m.event === 'units')).toHaveLength(0); // nothing changed, nothing broadcast
  });

  it('400s on an unparseable reference, naming the forms that work', async () => {
    const { calls, fetcher } = prFetcherSpy();
    const { app } = setup({ github: true, prFetcher: fetcher });
    const res = await post(app, { pr: 'not-a-pr' });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/owner\/repo#123/);
    expect(calls).toHaveLength(0);
  });

  it('400s on a bare PR number with the repo-qualified form to use instead', async () => {
    const { app } = setup({ github: true, prFetcher: prFetcherSpy().fetcher });
    const res = await post(app, { pr: '139' });
    expect(res.status).toBe(400);
    // The daemon has no cwd to infer a repo from, unlike `dad 139` — say what to type instead.
    expect(((await res.json()) as { error: string }).error).toMatch(/owner\/repo#139/);
  });

  it('400s on an empty reference and on a non-JSON body', async () => {
    const { app } = setup({ github: true, prFetcher: prFetcherSpy().fetcher });
    expect((await post(app, { pr: '   ' })).status).toBe(400);
    const raw = await app.request('/api/units', { method: 'POST', body: 'nonsense' });
    expect(raw.status).toBe(400);
  });

  it('503s with a credential hint when GitHub is not wired', async () => {
    const { app, store } = setup(); // no prFetcher
    const res = await post(app, { pr: 'octo/demo#42' });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toMatch(/credentials/i);
    expect(store.list()).toHaveLength(0); // nothing minted on a dark daemon
  });

  it('502s with a readable message when the PR fetch 404s, and mints nothing', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { app, store } = setup({
        github: true,
        prFetcher: async () => {
          throw new Error('GitHub API 404 Not Found for https://api.github.com/repos/octo/demo/pulls/9999: {}');
        },
      });
      const res = await post(app, { pr: 'octo/demo#9999' });
      expect(res.status).toBe(502);
      const { error } = (await res.json()) as { error: string };
      expect(error).toContain('octo/demo#9999');
      expect(error).not.toContain('api.github.com'); // the raw client string never reaches the field
      expect(store.list()).toHaveLength(0);
      expect(errSpy).toHaveBeenCalledTimes(1); // one daemon log line for the real failure
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe('GET /api/units/:id', () => {
  it('returns one unit with its narrative', async () => {
    const { store, app } = setup();
    const u = await addUnit(store);
    store.attachReview(u.unitId, [], NARRATIVE, 2);
    const res = await app.request(`/api/units/${u.unitId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { unit: { unitId: string; narrative: { verdict: string } } };
    expect(body.unit.unitId).toBe('unit-1');
    expect(body.unit.narrative.verdict).toBe('risky');
  });

  it('404s for an unknown unit', async () => {
    const { app } = setup();
    const res = await app.request('/api/units/nope');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/units/:id — blast radius', () => {
  /** One chapter over one file, so an index that knows no callers produces exactly one decision. */
  const COLLAPSIBLE: NarrativeResponse = {
    ...NARRATIVE,
    chapters: [
      {
        title: 'Rename the legacy helper',
        summary: 's',
        whyMatters: 'w',
        risk: 'low',
        sections: [{ type: 'diff', file: 'src/legacy.ts', startLine: 1, endLine: 40, hunkIndex: 0 }],
      },
    ],
  };

  const FILES: DiffFile[] = [
    {
      file: 'src/legacy.ts',
      isNewFile: false,
      isDeleted: false,
      hunks: [
        {
          header: '@@ -1,2 +1,2 @@',
          oldStart: 1,
          oldCount: 2,
          newStart: 1,
          newCount: 2,
          lines: [{ type: 'add', content: 'x', lineNumber: { new: 1 } }],
        },
      ],
    },
  ];

  const warmContext: RepoContext = {
    available: true,
    root: '/tmp/not-read',
    ref: 'main',
    fetchedAt: Date.now(),
    index: { callers: new Map<string, string[]>(), filesScanned: 9 },
  };

  it('computes collapse per request from a freshly resolved snapshot', async () => {
    const { store, app } = setup({ repoContextFetcher: async () => warmContext });
    const u = await addUnit(store);
    store.attachReview(u.unitId, FILES, COLLAPSIBLE, 0);
    const body = (await (await app.request(`/api/units/${u.unitId}`)).json()) as { collapse?: CollapseResult };
    expect(body.collapse?.available).toBe(true);
    if (body.collapse?.available) {
      expect(body.collapse.dividerBefore).toBe(0);
      expect(body.collapse.decisions[0]?.reason).toContain('0 known callers outside this PR');
    }
  });

  it('surfaces the unavailable reason so the drill-in can name the cause', async () => {
    const { store, app } = setup({ repoContextFetcher: async () => ({ available: false, reason: 'empty-tree' }) });
    const u = await addUnit(store);
    store.attachReview(u.unitId, FILES, COLLAPSIBLE, 0);
    const body = (await (await app.request(`/api/units/${u.unitId}`)).json()) as { collapse?: CollapseResult };
    expect(body.collapse).toEqual({ available: false, reason: 'empty-tree' });
  });

  it('omits collapse when the daemon has no way to resolve a snapshot', async () => {
    // A credential-less daemon cannot fetch a tarball. "Not checked" must not render as a reason.
    const { store, app } = setup();
    const u = await addUnit(store);
    store.attachReview(u.unitId, FILES, COLLAPSIBLE, 0);
    const body = (await (await app.request(`/api/units/${u.unitId}`)).json()) as { collapse?: CollapseResult };
    expect(body.collapse).toBeUndefined();
  });

  it('serves the stored promptCapStats and omits them for a cache-hit narrative', async () => {
    const { store, app } = setup({ repoContextFetcher: async () => warmContext });
    const u = await addUnit(store);
    const capStats: PromptCapStats = {
      perFileCap: 500,
      globalCap: 12000,
      inputFileCount: 40,
      inputLineCount: 30000,
      narratedFileCount: 30,
      narratedLineCount: 12000,
      truncatedFiles: [{ file: 'src/big.ts', hunksDropped: 1, linesDropped: 90 }],
      droppedFiles: ['src/gen.ts'],
    };
    store.attachReview(u.unitId, FILES, COLLAPSIBLE, 0, capStats);
    const first = (await (await app.request(`/api/units/${u.unitId}`)).json()) as { capStats?: PromptCapStats };
    expect(first.capStats?.droppedFiles).toEqual(['src/gen.ts']);

    // Re-attaching from the narrative cache measures no diff, so the stats must not linger.
    store.attachReview(u.unitId, FILES, COLLAPSIBLE, 0);
    const second = (await (await app.request(`/api/units/${u.unitId}`)).json()) as { capStats?: PromptCapStats };
    expect(second.capStats).toBeUndefined();
  });
});

describe('POST /api/units — pinned triage (the second mint door)', () => {
  /** Local copy: the add-PR describe block's spy is scoped to it, and these tests are a sibling. */
  const prFetcherSpy = () => ({
    fetcher: async (_o: string, _r: string, number: number): Promise<PRMetadata> => ({
      ...mkMetadata(),
      number,
      title: 'Ship the thing',
      branch: 'feat/thing',
      headSha: 'sha-live',
    }),
  });

  const files = (paths: string[]) => ({
    files: paths.map((path) => ({ path, status: 'modified', additions: 1, deletions: 0 })),
    truncated: false,
  });

  it('mints a hand-added PR with a triage summary, exactly as a polled one gets', async () => {
    // POST /api/units fetches only metadata by design, so without an explicit triage fetch here a PR
    // the reviewer typed in would be the one unit in the queue with no lane — the opposite of intent.
    const { fetcher } = prFetcherSpy();
    const { store, app } = setup({
      prFetcher: fetcher,
      fileSummaryFetcher: async () => files(['README.md', 'docs/guide.md']),
    });

    const res = await app.request('/api/units', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pr: 'octo/demo#7' }),
    });
    expect(res.status).toBe(201);

    const unit = store.list()[0]!;
    expect(unit.pinned).toBe(true);
    expect(unit.triage).toBeDefined();
    expect(unit.triage!.files.map((f) => f.kind)).toEqual(['docs', 'docs']);
  });

  it('still mints when the triage fetch fails — the backfill heals it later', async () => {
    // Refusing to add a PR because one auxiliary fetch was flaky would be a worse trade than a row
    // that is briefly laneless; laneOf reads a missing summary as needs-you, which is the safe side.
    const { fetcher } = prFetcherSpy();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { store, app } = setup({
        prFetcher: fetcher,
        fileSummaryFetcher: async () => {
          throw new Error('502 bad gateway');
        },
      });
      const res = await app.request('/api/units', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pr: 'octo/demo#7' }),
      });
      expect(res.status).toBe(201);
      expect(store.list()[0]!.triage).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('units payload — dismissed rows leave the queue', () => {
  it('omits a dismissed unit from GET /api/units and lists it under dismissed', async () => {
    // Without this the ✕ repaints the row it just hid: the DELETE keeps the unit (so the poller cannot
    // re-mint it), and every payload returned store.list() raw.
    const { store, app } = setup();
    const u = await addUnit(store);
    await app.request(`/api/units/${u.unitId}`, { method: 'DELETE' });

    const body = (await (await app.request('/api/units')).json()) as {
      units: { unitId: string }[];
      dismissed: { unitId: string }[];
    };
    expect(body.units.map((x) => x.unitId)).not.toContain(u.unitId);
    expect(body.dismissed.map((x) => x.unitId)).toContain(u.unitId);
  });

  it('stamps every payload unit with its lane, on the wire', async () => {
    // The browser cannot import laneOf across the package boundary, so an un-stamped payload means the
    // queue silently falls back to status-only grouping and the low-attention lane never appears at all
    // — a failure that looks exactly like "no PR qualified today".
    const { store, app } = setup();
    const visible = await addUnit(store);
    const hidden = await addUnit(store, 'owner/b');
    await app.request(`/api/units/${hidden.unitId}`, { method: 'DELETE' });

    const body = (await (await app.request('/api/units')).json()) as {
      units: { unitId: string; lane?: string }[];
      dismissed: { unitId: string; lane?: string }[];
    };
    expect(body.units.find((x) => x.unitId === visible.unitId)!.lane).toBe('needs-you');
    // The dismissed list is stamped too — the reveal renders real rows, not a bare count.
    expect(body.dismissed.find((x) => x.unitId === hidden.unitId)!.lane).toBe('needs-you');
  });

  it('un-hides a dismissed PR when the reviewer adds it back by hand', async () => {
    const { fetcher } = prFetcherSpy2();
    const { store, app } = setup({ prFetcher: fetcher });
    const u = await addUnit(store);
    await app.request(`/api/units/${u.unitId}`, { method: 'DELETE' });
    expect(store.get(u.unitId)!.dismissedAtSha).toBeDefined();

    const res = await app.request('/api/units', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pr: `${u.repo}#${u.prNumber}` }),
    });

    expect(res.status).toBe(200);
    expect((await res.json()).existing).toBe(true);
    expect(store.get(u.unitId)!.dismissedAtSha).toBeUndefined(); // typing it in is an explicit request
  });
});

/** Shared minimal prFetcher for the blocks below (the add-PR describe scopes its own). */
const prFetcherSpy2 = () => ({
  fetcher: async (_o: string, _r: string, number: number): Promise<PRMetadata> => ({
    ...mkMetadata(),
    number,
    title: 'Ship the thing',
    branch: 'feat/thing',
    headSha: 'sha-live',
  }),
});

describe('POST /api/units/:id/hydrate (lazy narrative on open)', () => {
  const post = (app: ReturnType<typeof setup>['app'], id: string) =>
    app.request(`/api/units/${id}/hydrate`, { method: 'POST' });

  it('calls the injected hydrate on a github unit with no narrative, returns the updated unit, broadcasts', async () => {
    const calls: ReviewUnit[] = [];
    let store!: UnitStore;
    const ctx = setup({
      hydrate: async (unit) => {
        calls.push(unit);
        // mimic the real hydrate: attach a narrative without a status transition
        return store.attachReview(unit.unitId, [], NARRATIVE, 0);
      },
    });
    store = ctx.store;
    const gh = seedGithubUnit(store);
    expect(store.get(gh.unitId)!.narrative).toBeUndefined();

    const res = await post(ctx.app, gh.unitId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { unit: ReviewUnit };
    expect(calls).toHaveLength(1);
    expect(calls[0]!.unitId).toBe(gh.unitId);
    expect(body.unit.narrative).toEqual(NARRATIVE);
    expect(body.unit.status).toBe('queued'); // no status transition
    expect(ctx.events).toContain('units');
  });

  it('is a no-op (no hydrate call) on a github unit that already has a narrative', async () => {
    let called = false;
    const { store, app, events } = setup({
      hydrate: async (unit) => {
        called = true;
        return unit;
      },
    });
    const gh = seedGithubUnit(store);
    store.attachReview(gh.unitId, [], NARRATIVE, 1); // already hydrated

    const res = await post(app, gh.unitId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { unit: ReviewUnit };
    expect(called).toBe(false);
    expect(body.unit.unitId).toBe(gh.unitId);
    expect(events).not.toContain('units'); // no broadcast for a no-op
  });

  it('503s with the credential hint when no hydrate dep is wired and the unit has no narrative', async () => {
    const { store, app } = setup(); // credential-less daemon: no hydrate injected (github: false)
    const gh = seedGithubUnit(store);
    const res = await post(app, gh.unitId);
    expect(res.status).toBe(503); // honest failure, not a silent 200 no-op the UI reads as "no narrative"
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('no GitHub credentials');
    expect(store.get(gh.unitId)!.narrative).toBeUndefined(); // unchanged
  });

  it('no-ops (200) an already-narrated unit even when no hydrate dep is wired', async () => {
    const { store, app } = setup(); // no hydrate injected
    const gh = seedGithubUnit(store);
    store.attachReview(gh.unitId, [], NARRATIVE, 1); // a legitimate prior narrative — a no-op regardless of wiring
    const res = await post(app, gh.unitId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { unit: ReviewUnit };
    expect(body.unit.unitId).toBe(gh.unitId);
    expect(body.unit.narrative).toEqual(NARRATIVE);
  });

  it('404s for an unknown unit', async () => {
    const { app } = setup({ hydrate: async (unit) => unit });
    const res = await post(app, 'nope');
    expect(res.status).toBe(404);
  });

  it('502s (not 500), leaves the unit unchanged, and logs the failure when hydrate throws', async () => {
    const { store, events, app } = setup({
      hydrate: async () => {
        throw new Error('PR fetch failed');
      },
    });
    const gh = seedGithubUnit(store);
    // The drill-in spinner never exits on failure, so the daemon must surface the cause in its output.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await post(app, gh.unitId);
      expect(res.status).toBe(502); // a real fetch/LLM failure is a bad-gateway, not an unhandled 500
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('PR fetch failed'); // the error message still reaches the client

      const after = store.get(gh.unitId)!;
      expect(after.narrative).toBeUndefined(); // unchanged
      expect(after.status).toBe('queued');
      expect(events).not.toContain('units'); // no broadcast on failure

      // logged server-side with enough context to find the PR (repo / number / unit id / message).
      expect(errSpy).toHaveBeenCalledTimes(1);
      const line = String(errSpy.mock.calls[0]![0]);
      expect(line).toContain('hydrate failed');
      expect(line).toContain(gh.repo);
      expect(line).toContain(String(gh.prNumber));
      expect(line).toContain(gh.unitId);
      expect(line).toContain('PR fetch failed');
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe('POST /api/units/:id/hydrate (force re-read + single-flight)', () => {
  // Sends an optional JSON body; `body === undefined` posts nothing (the legacy lazy-open shape).
  const post = (app: ReturnType<typeof setup>['app'], id: string, body?: unknown) =>
    app.request(`/api/units/${id}/hydrate`, {
      method: 'POST',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    });

  it('force advances the head SHA + regenerates, bypassing the already-narrated no-op guard', async () => {
    const forceSeen: (boolean | undefined)[] = [];
    let store!: UnitStore;
    const FRESH: NarrativeResponse = { ...NARRATIVE, tldr: 'fresh take' };
    const ctx = setup({
      hydrate: async (unit, force) => {
        forceSeen.push(force);
        // Mimic the real force hydrate: advance to the live head (+ fresh title), then attach new prose.
        if (force) {
          store.advanceHead(unit.unitId, 'sha-live', { ...mkMetadata(), headSha: 'sha-live', title: 'Renamed PR' });
        }
        return store.attachReview(unit.unitId, [], FRESH, 0);
      },
    });
    store = ctx.store;
    const gh = seedGithubUnit(store, { headSha: 'sha-1' });
    store.attachReview(gh.unitId, [], NARRATIVE, 0); // already narrated → a non-force hydrate would no-op

    const res = await post(ctx.app, gh.unitId, { force: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { unit: ReviewUnit };
    expect(forceSeen).toEqual([true]); // the force flag reached hydrate → the engine bypasses the cache read
    expect(body.unit.narrative).toEqual(FRESH); // regenerated despite an existing narrative

    const after = store.get(gh.unitId)!;
    expect(after.diffContentKey).toBe('sha-live'); // cache key advanced to the live SHA
    expect(after.metadata.headSha).toBe('sha-live');
    expect(after.taskLabel).toBe('Renamed PR'); // title refreshed from the live PR
    expect(ctx.events).toContain('units'); // broadcast repaints open tabs
  });

  it('a non-force hydrate ({ force: false }) still no-ops an already-narrated unit', async () => {
    let called = false;
    const { store, app, events } = setup({
      hydrate: async (unit) => {
        called = true;
        return unit;
      },
    });
    const gh = seedGithubUnit(store);
    store.attachReview(gh.unitId, [], NARRATIVE, 1); // already hydrated

    const res = await post(app, gh.unitId, { force: false });
    expect(res.status).toBe(200);
    expect(called).toBe(false); // force:false is the plain path — the existing narrative short-circuits it
    expect(events).not.toContain('units');
  });

  it('ignores an invalid JSON body — a plain hydrate, not a 400', async () => {
    const forceSeen: (boolean | undefined)[] = [];
    let store!: UnitStore;
    const ctx = setup({
      hydrate: async (unit, force) => {
        forceSeen.push(force);
        return store.attachReview(unit.unitId, [], NARRATIVE, 0);
      },
    });
    store = ctx.store;
    const gh = seedGithubUnit(store);

    const res = await ctx.app.request(`/api/units/${gh.unitId}/hydrate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not json',
    });
    expect(res.status).toBe(200); // the legacy no-body callers must keep working — never a 400
    expect(forceSeen).toEqual([false]); // an unparseable body is treated as a non-force hydrate
  });

  it('coalesces concurrent hydrates for one unit into a single hydrate call', async () => {
    let store!: UnitStore;
    const calls: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = () => r();
    });
    const ctx = setup({
      hydrate: async (unit) => {
        calls.push(unit.unitId);
        await gate; // hold the run so a second concurrent POST rides the same in-flight promise
        return store.attachReview(unit.unitId, [], NARRATIVE, 0);
      },
    });
    store = ctx.store;
    const gh = seedGithubUnit(store);

    const first = post(ctx.app, gh.unitId, { force: true });
    const second = post(ctx.app, gh.unitId, { force: true });
    await new Promise((r) => setTimeout(r, 0)); // let both handlers reach the shared single-flight
    release();
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(calls).toEqual([gh.unitId]); // ONE hydrate for two concurrent POSTs

    // Cleared once it settled → a later re-read runs a fresh hydrate.
    const r3 = await post(ctx.app, gh.unitId, { force: true });
    expect(r3.status).toBe(200);
    expect(calls).toEqual([gh.unitId, gh.unitId]);
  });

  it('does not coalesce across different units — they hydrate in parallel', async () => {
    let store!: UnitStore;
    const calls: string[] = [];
    const ctx = setup({
      hydrate: async (unit) => {
        calls.push(unit.unitId);
        return store.attachReview(unit.unitId, [], NARRATIVE, 0);
      },
    });
    store = ctx.store;
    const a = seedGithubUnit(store, { number: 1 });
    const b = seedGithubUnit(store, { number: 2 });

    await Promise.all([post(ctx.app, a.unitId, { force: true }), post(ctx.app, b.unitId, { force: true })]);
    expect(calls.slice().sort()).toEqual([a.unitId, b.unitId].sort()); // one hydrate per distinct unit
  });
});

describe('POST /api/poll (manual refresh)', () => {
  const poll = (app: ReturnType<typeof setup>['app']) => app.request('/api/poll', { method: 'POST' });

  it('503s when no pollNow dep is wired (GitHub not configured)', async () => {
    const { app } = setup(); // no pollNow
    const res = await poll(app);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toContain('GitHub is not configured');
  });

  it('passes the mint/resurface/removed counts through on success', async () => {
    const { app } = setup({ pollNow: async () => ({ minted: 2, resurfaced: 1, removed: 3 }) });
    const res = await poll(app);
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toEqual({ ok: true, minted: 2, resurfaced: 1, removed: 3 });
  });

  it('502s and logs one line when pollNow throws', async () => {
    const { app } = setup({
      pollNow: async () => {
        throw new Error('github search failed');
      },
    });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await poll(app);
      expect(res.status).toBe(502);
      expect(((await res.json()) as { error: string }).error).toBe('github search failed'); // reaches the client
      expect(errSpy).toHaveBeenCalledTimes(1);
      const line = String(errSpy.mock.calls[0]![0]);
      expect(line).toContain('manual poll failed');
      expect(line).toContain('github search failed');
    } finally {
      errSpy.mockRestore();
    }
  });

  it('single-flights concurrent POSTs into one pollNow, then polls again after it settles', async () => {
    let invocations = 0;
    let resolve!: (v: { minted: number; resurfaced: number; removed: number }) => void;
    let deferred = new Promise<{ minted: number; resurfaced: number; removed: number }>((r) => {
      resolve = r;
    });
    const { app } = setup({
      pollNow: () => {
        invocations++;
        return deferred;
      },
    });

    // Two concurrent POSTs (button mashing) share one in-flight poll.
    const first = poll(app);
    const second = poll(app);
    // Let both handlers reach the shared `await inflight` before the poll settles.
    await new Promise((r) => setTimeout(r, 0));
    resolve({ minted: 3, resurfaced: 0, removed: 0 });
    const [r1, r2] = await Promise.all([first, second]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect((await r1.json()) as unknown).toEqual({ ok: true, minted: 3, resurfaced: 0, removed: 0 });
    expect((await r2.json()) as unknown).toEqual({ ok: true, minted: 3, resurfaced: 0, removed: 0 });
    expect(invocations).toBe(1); // coalesced into a single GitHub search

    // In-flight cleared once it settled → a later request runs a fresh poll.
    deferred = Promise.resolve({ minted: 0, resurfaced: 0, removed: 0 });
    const r3 = await poll(app);
    expect(r3.status).toBe(200);
    expect(invocations).toBe(2);
  });

  it('logs one line when concurrent POSTs coalesce onto a single failing poll', async () => {
    let reject!: (e: Error) => void;
    const deferred = new Promise<{ minted: number; resurfaced: number; removed: number }>((_, r) => {
      reject = r;
    });
    const { app } = setup({ pollNow: () => deferred });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      // Two concurrent POSTs share one in-flight poll; when it fails, both must 502 but only one
      // failure line should be logged (the log lives on the shared promise, not per-request).
      const first = poll(app);
      const second = poll(app);
      await new Promise((r) => setTimeout(r, 0));
      reject(new Error('github search failed'));
      const [r1, r2] = await Promise.all([first, second]);
      expect(r1.status).toBe(502);
      expect(r2.status).toBe(502);
      expect(errSpy).toHaveBeenCalledTimes(1);
    } finally {
      errSpy.mockRestore();
    }
  });
});

describe('DELETE /api/units/:id', () => {
  it('dismisses the unit rather than deleting it, and broadcasts', async () => {
    // Deliberately NOT a hard delete. `classify` routes any PR whose unit exists to existing-github, so
    // keeping the unit is the only thing stopping the next poll from re-minting a still-requested PR —
    // which is what made the old hard delete undo itself within about sixty seconds.
    const { store, events, app } = setup();
    const u = await addUnit(store);
    const res = await app.request(`/api/units/${u.unitId}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const after = store.get(u.unitId);
    expect(after).toBeDefined();
    expect(after!.dismissedAtSha).toBe(u.metadata.headSha);
    expect(events).toContain('units');
  });

  it('404s for an unknown unit', async () => {
    const { app } = setup();
    expect((await app.request('/api/units/nope', { method: 'DELETE' })).status).toBe(404);
  });
});

/** A narrative whose only chapter references `file` via a diff section — so an inline comment on
 * that path maps to chapter 0 (mirrors PR mode's `mapCommentsToChapters`). */
function narrativeWithFile(file: string): NarrativeResponse {
  return {
    ...NARRATIVE,
    chapters: [{ title: 'c', sections: [{ type: 'diff', file, hunkIndex: 0 }] }] as NarrativeResponse['chapters'],
  };
}

function mkComment(over: Partial<PRComment> = {}): PRComment {
  return {
    id: over.id ?? 1,
    author: over.author ?? 'octocat',
    body: over.body ?? 'a comment',
    createdAt: over.createdAt ?? 'now',
    updatedAt: over.updatedAt ?? 'now',
    ...over,
  };
}

describe('GET /api/units/:id/comments', () => {
  it('fetches a github unit’s comments and maps them to its narrative chapters', async () => {
    const fetched: ReviewUnit[] = [];
    const { store, app } = setup({
      commentFetcher: async (unit) => {
        fetched.push(unit);
        return [mkComment({ id: 9, path: 'src/a.ts', line: 3 })];
      },
    });
    const gh = seedGithubUnit(store);
    store.attachReview(gh.unitId, [], narrativeWithFile('src/a.ts'), 0);

    const res = await app.request(`/api/units/${gh.unitId}/comments`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<PRComment & { chapterIndices: number[] }>;
    expect(fetched).toHaveLength(1);
    expect(fetched[0]!.unitId).toBe(gh.unitId);
    expect(body).toHaveLength(1);
    expect(body[0]!.id).toBe(9);
    expect(body[0]!.chapterIndices).toEqual([0]); // inline comment on src/a.ts → chapter 0
  });

  it('returns the raw comments unmapped when the github unit has no narrative yet', async () => {
    const { store, app } = setup({
      commentFetcher: async () => [mkComment({ id: 5, path: 'x.ts', line: 1 })],
    });
    const gh = seedGithubUnit(store); // not hydrated — no narrative
    const res = await app.request(`/api/units/${gh.unitId}/comments`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as PRComment[];
    expect(body.map((c) => c.id)).toEqual([5]);
  });

  it('returns [] for a github unit when no fetcher is wired', async () => {
    const { store, app } = setup(); // no commentFetcher
    const gh = seedGithubUnit(store);
    const res = await app.request(`/api/units/${gh.unitId}/comments`);
    expect(res.status).toBe(200);
    expect((await res.json()) as PRComment[]).toEqual([]);
  });

  it('404s for an unknown unit', async () => {
    const { app } = setup({ commentFetcher: async () => [] });
    expect((await app.request('/api/units/nope/comments')).status).toBe(404);
  });
});

describe('POST /api/units/:id/comments', () => {
  const post = (app: ReturnType<typeof setup>['app'], id: string, body: unknown) =>
    app.request(`/api/units/${id}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('posts an inline comment to GitHub (commitId defaulting to the head SHA) and broadcasts unit-scoped', async () => {
    const calls: Array<[ReviewUnit, string, PostCommentOptions]> = [];
    const { store, messages, app } = setup({
      commentPoster: async (unit, body, opts) => {
        calls.push([unit, body, opts]);
        return mkComment({ id: 42, body, path: opts.path, line: opts.line });
      },
    });
    const gh = seedGithubUnit(store, { headSha: 'sha-1' });

    const res = await post(app, gh.unitId, { body: 'nit: rename this', path: 'src/a.ts', line: 3, side: 'RIGHT' });
    expect(res.status).toBe(201);
    const created = (await res.json()) as PRComment;
    expect(created.id).toBe(42);

    expect(calls).toHaveLength(1);
    expect(calls[0]![0].unitId).toBe(gh.unitId);
    expect(calls[0]![1]).toBe('nit: rename this');
    expect(calls[0]![2]).toMatchObject({ path: 'src/a.ts', line: 3, side: 'RIGHT', commitId: 'sha-1' });
    // Scoped to the unit so it can't leak into another open unit's thread (see useLiveStream).
    const broadcast = messages.find((m) => m.event === 'unit-comment');
    expect(broadcast?.data).toMatchObject({ unitId: gh.unitId, comment: { id: 42 } });
  });

  it('honors an explicit commitId over the unit head SHA', async () => {
    const calls: PostCommentOptions[] = [];
    const { store, app } = setup({
      commentPoster: async (_u, _b, opts) => {
        calls.push(opts);
        return mkComment();
      },
    });
    const gh = seedGithubUnit(store, { headSha: 'sha-1' });
    await post(app, gh.unitId, { body: 'x', path: 'a.ts', line: 1, commitId: 'sha-override' });
    expect(calls[0]!.commitId).toBe('sha-override');
  });

  it('503s a github unit when GitHub is not configured (no poster)', async () => {
    const { store, app } = setup(); // no commentPoster
    const gh = seedGithubUnit(store);
    expect((await post(app, gh.unitId, { body: 'hi' })).status).toBe(503);
  });

  it('400s when the body is missing or empty', async () => {
    let called = false;
    const { store, app } = setup({
      commentPoster: async () => {
        called = true;
        return mkComment();
      },
    });
    const gh = seedGithubUnit(store);
    expect((await post(app, gh.unitId, { path: 'a.ts', line: 1 })).status).toBe(400);
    expect((await post(app, gh.unitId, { body: '   ' })).status).toBe(400);
    expect(called).toBe(false);
  });

  it('502s when the poster throws (GitHub rejected the comment)', async () => {
    const { store, app } = setup({
      commentPoster: async () => {
        throw new Error('github 422');
      },
    });
    const gh = seedGithubUnit(store);
    expect((await post(app, gh.unitId, { body: 'hi' })).status).toBe(502);
  });

  it('404s for an unknown unit', async () => {
    const { app } = setup({ commentPoster: async () => mkComment() });
    expect((await post(app, 'nope', { body: 'hi' })).status).toBe(404);
  });
});

describe('POST /api/units/:id/review (submit a GitHub review)', () => {
  type Call = [ReviewUnit, ReviewEvent, string | undefined, SubmitInlineComment[]];
  const post = (app: ReturnType<typeof setup>['app'], id: string, body: unknown) =>
    app.request(`/api/units/${id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const recorder = () => {
    const calls: Call[] = [];
    return { calls, fn: async (...c: Call) => void calls.push(c) };
  };

  it('approves: posts APPROVE + batched comments to GitHub, records the verdict + SHA, broadcasts', async () => {
    const rec = recorder();
    const { store, events, app } = setup({ reviewSubmitter: rec.fn });
    const gh = seedGithubUnit(store, { headSha: 'sha-1' });

    const res = await post(app, gh.unitId, {
      event: 'approve',
      body: 'lgtm',
      comments: [{ path: 'src/a.ts', line: 3, body: 'nit' }],
    });
    expect(res.status).toBe(200);

    expect(rec.calls).toHaveLength(1);
    expect(rec.calls[0]![1]).toBe('APPROVE');
    expect(rec.calls[0]![2]).toBe('lgtm');
    expect(rec.calls[0]![3]).toEqual([{ path: 'src/a.ts', line: 3, body: 'nit' }]);

    const after = store.get(gh.unitId)!;
    expect(after.status).toBe('approved');
    expect(after.decision).toMatchObject({ kind: 'approved' });
    expect(after.lastReviewedSha).toBe('sha-1');
    expect(events).toContain('units');
    expect(events).toContain('review');
  });

  it('requests changes: records changes_requested and the reviewed SHA', async () => {
    const rec = recorder();
    const { store, app } = setup({ reviewSubmitter: rec.fn });
    const gh = seedGithubUnit(store, { headSha: 'sha-1' });
    const res = await post(app, gh.unitId, { event: 'request_changes', body: 'please fix' });
    expect(res.status).toBe(200);
    expect(rec.calls[0]![1]).toBe('REQUEST_CHANGES');
    expect(store.get(gh.unitId)!.status).toBe('changes_requested');
    expect(store.get(gh.unitId)!.lastReviewedSha).toBe('sha-1');
  });

  it('comments: posts a COMMENT review WITHOUT changing the verdict (stays queued)', async () => {
    const rec = recorder();
    const { store, events, app } = setup({ reviewSubmitter: rec.fn });
    const gh = seedGithubUnit(store, { headSha: 'sha-1' });
    const res = await post(app, gh.unitId, { event: 'comment', body: 'some thoughts' });
    expect(res.status).toBe(200);
    expect(rec.calls[0]![1]).toBe('COMMENT');
    const after = store.get(gh.unitId)!;
    expect(after.status).toBe('queued'); // no verdict
    expect(after.decision).toBeUndefined();
    expect(events).toContain('review');
    expect(events).not.toContain('units'); // nothing changed locally
  });

  it('drops malformed inline comments before submitting', async () => {
    const rec = recorder();
    const { store, app } = setup({ reviewSubmitter: rec.fn });
    const gh = seedGithubUnit(store);
    await post(app, gh.unitId, {
      event: 'comment',
      comments: [
        { path: 'a.ts', line: 1, body: 'ok' },
        { path: 'b.ts', body: 'no line' }, // dropped
        { line: 2, body: 'no path' }, // dropped
      ],
    });
    expect(rec.calls[0]![3]).toEqual([{ path: 'a.ts', line: 1, body: 'ok' }]);
  });

  it('400s an invalid event', async () => {
    const rec = recorder();
    const { store, app } = setup({ reviewSubmitter: rec.fn });
    const gh = seedGithubUnit(store);
    expect((await post(app, gh.unitId, { event: 'merge' })).status).toBe(400);
    expect(rec.calls).toHaveLength(0);
  });

  it('503s when no review submitter is wired', async () => {
    const { store, app } = setup();
    const gh = seedGithubUnit(store);
    expect((await post(app, gh.unitId, { event: 'approve' })).status).toBe(503);
  });

  it('502s and records nothing when the submitter throws', async () => {
    const { store, app } = setup({
      reviewSubmitter: async () => {
        throw new Error('github 422');
      },
    });
    const gh = seedGithubUnit(store, { headSha: 'sha-1' });
    expect((await post(app, gh.unitId, { event: 'approve', body: 'x' })).status).toBe(502);
    const after = store.get(gh.unitId)!;
    expect(after.status).toBe('queued'); // divergence guard: nothing recorded
    expect(after.decision).toBeUndefined();
    expect(after.lastReviewedSha).toBeUndefined();
  });

  it('409s an approve/request_changes when the unit is not awaiting a verdict (without posting)', async () => {
    const rec = recorder();
    const { store, app } = setup({ reviewSubmitter: rec.fn });
    const gh = seedGithubUnit(store, { headSha: 'sha-1' });
    (store.get(gh.unitId) as { status: string }).status = 'approved'; // already decided
    expect((await post(app, gh.unitId, { event: 'approve' })).status).toBe(409);
    expect(rec.calls).toHaveLength(0); // never posted a second review
  });

  it('404s for an unknown unit', async () => {
    const { app } = setup({ reviewSubmitter: async () => {} });
    expect((await post(app, 'nope', { event: 'approve' })).status).toBe(404);
  });
});

describe('POST /api/units/:id/ai (review-summary draft)', () => {
  const post = (app: ReturnType<typeof setup>['app'], id: string, body: unknown) =>
    app.request(`/api/units/${id}/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('summarizes: calls the AI with prompts built from the unit narrative, returns the text', async () => {
    const calls: Array<[string, string]> = [];
    const { store, app } = setup({
      ai: async (system, user) => {
        calls.push([system, user]);
        return { text: '  I reviewed this and it looks solid.  ' };
      },
    });
    const gh = seedGithubUnit(store);
    store.attachReview(gh.unitId, [], { ...NARRATIVE, tldr: 'adds widgets' }, 0);

    const res = await post(app, gh.unitId, { action: 'summarize', resolution: 'approve' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { text: string };
    expect(body.text).toBe('I reviewed this and it looks solid.'); // trimmed
    expect(calls).toHaveLength(1);
    expect(calls[0]![0]).toContain('approving'); // approve stance is in the system prompt
    expect(calls[0]![1]).toContain('adds widgets'); // the narrative tldr feeds the user prompt
  });

  it('503s when the unit has no narrative yet', async () => {
    const { store, app } = setup({ ai: async () => ({ text: 'x' }) });
    const gh = seedGithubUnit(store); // not hydrated
    expect((await post(app, gh.unitId, { action: 'summarize' })).status).toBe(503);
  });

  it('503s when no AI is configured', async () => {
    const { store, app } = setup(); // no ai dep
    const gh = seedGithubUnit(store);
    store.attachReview(gh.unitId, [], NARRATIVE, 0);
    expect((await post(app, gh.unitId, { action: 'summarize' })).status).toBe(503);
  });

  it('400s an unknown action', async () => {
    const { store, app } = setup({ ai: async () => ({ text: 'x' }) });
    const gh = seedGithubUnit(store);
    store.attachReview(gh.unitId, [], NARRATIVE, 0);
    expect((await post(app, gh.unitId, { action: 'frobnicate' })).status).toBe(400);
  });

  it('asks: answers a question about a chapter using its diff', async () => {
    const calls: Array<[string, string]> = [];
    const { store, app } = setup({
      ai: async (system, user) => {
        calls.push([system, user]);
        return { text: 'Because the API changed.' };
      },
    });
    const gh = seedGithubUnit(store);
    store.attachReview(gh.unitId, [], narrativeWithFile('src/a.ts'), 0);

    const res = await post(app, gh.unitId, { action: 'ask', chapterIndex: 0, question: 'why this change?' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { text: string }).text).toBe('Because the API changed.');
    expect(calls[0]![1]).toContain('why this change?'); // the question is in the user prompt
  });

  it('400s an ask with no question', async () => {
    const { store, app } = setup({ ai: async () => ({ text: 'x' }) });
    const gh = seedGithubUnit(store);
    store.attachReview(gh.unitId, [], narrativeWithFile('src/a.ts'), 0);
    expect((await post(app, gh.unitId, { action: 'ask', chapterIndex: 0 })).status).toBe(400);
  });

  it('400s an ask for a chapter that does not exist', async () => {
    const { store, app } = setup({ ai: async () => ({ text: 'x' }) });
    const gh = seedGithubUnit(store);
    store.attachReview(gh.unitId, [], NARRATIVE, 0); // no chapters
    expect((await post(app, gh.unitId, { action: 'ask', chapterIndex: 5, question: 'q' })).status).toBe(400);
  });

  it('404s for an unknown unit', async () => {
    const { app } = setup({ ai: async () => ({ text: 'x' }) });
    expect((await post(app, 'nope', { action: 'summarize' })).status).toBe(404);
  });
});

describe('GET /api/units/:id/status (checks + reviews)', () => {
  const mkCheck = (over: Partial<CheckRun> = {}): CheckRun => ({
    id: over.id ?? 1,
    name: over.name ?? 'ci',
    status: over.status ?? 'completed',
    conclusion: over.conclusion ?? 'success',
    startedAt: null,
    completedAt: null,
    detailsUrl: null,
    output: {},
  });
  const mkReview = (over: Partial<PRReview> = {}): PRReview => ({
    id: over.id ?? 1,
    user: over.user ?? 'octocat',
    avatarUrl: '',
    state: over.state ?? 'APPROVED',
    submittedAt: 'now',
  });

  it('returns a github unit’s checks + reviews from the fetcher', async () => {
    const seen: ReviewUnit[] = [];
    const { store, app } = setup({
      statusFetcher: async (unit) => {
        seen.push(unit);
        return { checks: [mkCheck({ conclusion: 'failure' })], reviews: [mkReview()] };
      },
    });
    const gh = seedGithubUnit(store);
    const res = await app.request(`/api/units/${gh.unitId}/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { checks: CheckRun[]; reviews: PRReview[] };
    expect(seen[0]!.unitId).toBe(gh.unitId);
    expect(body.checks[0]!.conclusion).toBe('failure');
    expect(body.reviews[0]!.state).toBe('APPROVED');
  });

  it('returns empty when no fetcher is wired', async () => {
    const { store, app } = setup();
    const gh = seedGithubUnit(store);
    const res = await app.request(`/api/units/${gh.unitId}/status`);
    expect(res.status).toBe(200);
    expect((await res.json()) as unknown).toEqual({ checks: [], reviews: [] });
  });

  it('404s for an unknown unit', async () => {
    const { app } = setup({ statusFetcher: async () => ({ checks: [], reviews: [] }) });
    expect((await app.request('/api/units/nope/status')).status).toBe(404);
  });
});
