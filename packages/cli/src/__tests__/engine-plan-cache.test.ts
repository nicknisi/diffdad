import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test';
import { homedir } from 'os';
import { join } from 'path';
import { readdir, rm } from 'fs/promises';
import { generateNarrative } from '../narrative/engine';
import { cachePlan, computePromptMetaHash, getCachedPlan } from '../narrative/cache';
import type { Plan } from '../narrative/plan-types';
import type { DiffDadConfig } from '../config';
import type { DiffFile, PRMetadata } from '../github/types';

/**
 * Exercises generateNarrative's plan-cache read/write behavior hermetically: the AI layer is
 * pointed at a local mock speaking the OpenAI chat-completions SSE protocol (same pattern as
 * ai-runtime.test.ts), so a cache hit means zero requests and a forced regeneration is
 * observable as a planner request against the mock.
 */

const CACHE_DIR = join(homedir(), '.cache', 'diffdad');
const FIXTURE_OWNER = '__diffdad_engine_test__';
const FIXTURE_REPO = 'plan-cache';
const PROVIDER_KEY = 'mock-provider';

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
let requestCount = 0;

function chunk(content: string | undefined, finishReason: string | null = null): string {
  return JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'gpt-4o',
    choices: [
      {
        index: 0,
        delta: content !== undefined ? { content } : {},
        finish_reason: finishReason,
      },
    ],
  });
}

function sse(lines: string[]): Response {
  const body = [...lines.map((line) => `data: ${line}\n\n`), 'data: [DONE]\n\n'].join('');
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' },
  });
}

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch() {
      requestCount++;
      return sse([chunk(JSON.stringify(mkPlan('fresh plan'))), chunk(undefined, 'stop')]);
    },
  });
  baseUrl = `http://localhost:${server.port}/v1`;
});

afterAll(() => {
  server.stop(true);
});

afterEach(async () => {
  const entries = await readdir(CACHE_DIR).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((e) => e.startsWith(`${FIXTURE_OWNER}-`))
      .map((e) => rm(join(CACHE_DIR, e), { force: true }).catch(() => {})),
  );
});

function config(): DiffDadConfig {
  return {
    aiProvider: 'openai-compatible',
    aiBaseUrl: baseUrl,
    aiApiKey: 'test',
    aiModel: 'gpt-4o',
  };
}

function mkHunk(newStart: number) {
  return {
    header: `@@ -${newStart},1 +${newStart},2 @@`,
    oldStart: newStart,
    oldCount: 1,
    newStart,
    newCount: 2,
    lines: [
      { type: 'context' as const, content: 'const a = 1;', lineNumber: { old: newStart, new: newStart } },
      { type: 'add' as const, content: 'const b = 2;', lineNumber: { new: newStart + 1 } },
    ],
  };
}

// Two non-mechanical files so generateNarrative takes the two-pass (planner) path
// instead of the small-PR single-pass short-circuit.
const FILES: DiffFile[] = [
  { file: 'src/a.ts', isNewFile: false, isDeleted: false, hunks: [mkHunk(1)] },
  { file: 'src/b.ts', isNewFile: false, isDeleted: false, hunks: [mkHunk(10)] },
];

// One suppressed theme covering every hunk: a valid plan (validatePlan allows exactly one
// suppressed theme) whose chapters are synthesized without writer LLM calls — so the mock
// only ever sees planner traffic.
function mkPlan(prTitle: string): Plan {
  return {
    schemaVersion: 1,
    prTitle,
    prTldr: 'Mechanical only.',
    prVerdict: 'safe',
    themes: [
      {
        id: 'theme-0',
        title: 'Mechanical changes',
        riskLevel: 'low',
        rationale: 'Import shuffles.',
        suppress: true,
        hunkRefs: [
          { file: 'src/a.ts', hunkIndex: 0 },
          { file: 'src/b.ts', hunkIndex: 0 },
        ],
      },
    ],
    readingPlan: [],
    concerns: [],
  };
}

function mkPR(): PRMetadata {
  return {
    number: 5,
    title: 'Engine cache test',
    body: '',
    state: 'open',
    draft: false,
    author: { login: 'me', avatarUrl: '' },
    branch: 'feat',
    base: 'main',
    labels: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    additions: 2,
    deletions: 0,
    changedFiles: 2,
    commits: 1,
    headSha: 'sha-engine',
  };
}

function cacheKey(sha: string) {
  const pr = mkPR();
  return {
    owner: FIXTURE_OWNER,
    repo: FIXTURE_REPO,
    number: pr.number,
    sha,
    metaHash: computePromptMetaHash(pr),
    providerKey: PROVIDER_KEY,
  };
}

describe('generateNarrative plan caching', () => {
  it('reuses a cached plan without calling the planner', async () => {
    const key = cacheKey('sha-reuse');
    await cachePlan(key.owner, key.repo, key.number, key.sha, key.metaHash, key.providerKey, mkPlan('cached plan'));

    requestCount = 0;
    const { narrative } = await generateNarrative(mkPR(), FILES, [], config(), undefined, { cacheKey: key });

    expect(narrative.title).toBe('cached plan');
    expect(requestCount).toBe(0);
  }, 10_000);

  it('force bypasses the cached plan, regenerates, and overwrites the cache entry', async () => {
    const key = cacheKey('sha-force');
    await cachePlan(key.owner, key.repo, key.number, key.sha, key.metaHash, key.providerKey, mkPlan('cached plan'));

    requestCount = 0;
    const { narrative } = await generateNarrative(mkPR(), FILES, [], config(), undefined, {
      cacheKey: key,
      force: true,
    });

    expect(narrative.title).toBe('fresh plan');
    expect(requestCount).toBeGreaterThanOrEqual(1);
    // force skips the read but still writes: the fresh plan replaces the stale entry.
    const stored = await getCachedPlan(key.owner, key.repo, key.number, key.sha, key.metaHash, key.providerKey);
    expect(stored?.prTitle).toBe('fresh plan');
  }, 10_000);

  it('a plan cached under a different provider key is not reused', async () => {
    const key = cacheKey('sha-provider-miss');
    await cachePlan(key.owner, key.repo, key.number, key.sha, key.metaHash, 'other-provider', mkPlan('cached plan'));

    requestCount = 0;
    const { narrative } = await generateNarrative(mkPR(), FILES, [], config(), undefined, { cacheKey: key });

    expect(narrative.title).toBe('fresh plan');
    expect(requestCount).toBeGreaterThanOrEqual(1);
  }, 10_000);
});
