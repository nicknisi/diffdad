import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { generateNarrative } from '../narrative/engine';
import type { DiffDadConfig } from '../config';
import type { DiffFile, PRMetadata } from '../github/types';
import type { NarrativeResponse } from '../narrative/types';

/**
 * Exercises the single-pass validation-retry + repair boundary hermetically. The AI layer points at a
 * local mock speaking the OpenAI chat-completions SSE protocol (same pattern as engine-plan-cache.test.ts).
 * First response anchors a diff section to a nonexistent hunk (validation fails → retry); second response
 * is clean. The shipped narrative must contain no reference to a nonexistent hunk.
 */

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
let requestCount = 0;

function chunk(content: string | undefined, finishReason: string | null = null): string {
  return JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion.chunk',
    created: 1,
    model: 'gpt-4o',
    choices: [{ index: 0, delta: content !== undefined ? { content } : {}, finish_reason: finishReason }],
  });
}

function sse(lines: string[]): Response {
  const body = [...lines.map((line) => `data: ${line}\n\n`), 'data: [DONE]\n\n'].join('');
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' },
  });
}

function mkNarrative(title: string, hunkIndex: number): NarrativeResponse {
  return {
    title,
    tldr: 'does a thing',
    verdict: 'caution',
    readingPlan: [],
    concerns: [],
    chapters: [
      {
        title: 'C',
        summary: 's',
        whyMatters: 'w',
        risk: 'low',
        sections: [{ type: 'diff', file: 'src/a.ts', hunkIndex, startLine: 1, endLine: 1 }],
      },
    ],
  };
}

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch() {
      requestCount++;
      // First call: reference a hunk that does not exist (only hunkIndex 0 is valid) → validation fails.
      // Second call (retry): a clean narrative.
      const narrative = requestCount === 1 ? mkNarrative('bad attempt', 5) : mkNarrative('clean retry', 0);
      return sse([chunk(JSON.stringify(narrative)), chunk(undefined, 'stop')]);
    },
  });
  baseUrl = `http://localhost:${server.port}/v1`;
});

afterAll(() => {
  server.stop(true);
});

function config(): DiffDadConfig {
  return { aiProvider: 'openai-compatible', aiBaseUrl: baseUrl, aiApiKey: 'test', aiModel: 'gpt-4o' };
}

// One file, one hunk → the small-PR short-circuit takes the single-pass path.
const FILES: DiffFile[] = [
  {
    file: 'src/a.ts',
    isNewFile: false,
    isDeleted: false,
    hunks: [
      {
        header: '@@ -1,1 +1,2 @@',
        oldStart: 1,
        oldCount: 1,
        newStart: 1,
        newCount: 2,
        lines: [{ type: 'add', content: 'const b = 2;', lineNumber: { new: 2 } }],
      },
    ],
  },
];

function mkPR(): PRMetadata {
  return {
    number: 7,
    title: 'Single pass retry test',
    body: '',
    state: 'open',
    draft: false,
    author: { login: 'me', avatarUrl: '' },
    branch: 'feat',
    base: 'main',
    labels: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    commits: 1,
    headSha: 'sha-single',
  };
}

describe('generateNarrative single-pass validation retry', () => {
  it('retries once on anchoring failure and ships a repaired narrative', async () => {
    requestCount = 0;
    const { narrative } = await generateNarrative(mkPR(), FILES, [], config());

    expect(requestCount).toBe(2); // first attempt failed validation → one retry
    expect(narrative.title).toBe('clean retry');
    // No shipped diff section references a nonexistent hunk.
    for (const ch of narrative.chapters) {
      for (const s of ch.sections) {
        if (s.type === 'diff') expect(s.hunkIndex).toBeLessThan(FILES[0]!.hunks.length);
      }
    }
  }, 10_000);
});
