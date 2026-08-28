import { describe, expect, test } from 'bun:test';
import { narrativeResponseSchema, prCommentSchema, planSchema, recapResponseSchema, sseEventSchema } from './index';

const chapter = {
  title: 'Auth boundary moves',
  summary: 'The token check relocates into the middleware.',
  whyMatters: 'If this is wrong, unauthenticated requests reach the handler.',
  risk: 'high' as const,
  sections: [
    { type: 'narrative' as const, content: 'The check used to live in the handler.' },
    { type: 'diff' as const, file: 'src/mw.ts', startLine: 10, endLine: 20, hunkIndex: 0 },
  ],
  callouts: [{ file: 'src/mw.ts', line: 12, level: 'warning' as const, message: 'no early return' }],
  reshow: [{ ref: 1, file: 'src/mw.ts', highlight: { from: 10, to: 20 } }],
  themeId: 'theme-0',
};

const narrative = {
  title: 'Move auth into middleware',
  tldr: 'Relocates the auth check.',
  verdict: 'caution' as const,
  readingPlan: [{ step: 'Start at chapter 1', chapterIndex: 0, why: 'boundary moved' }],
  concerns: [
    {
      question: 'Does the guard run before the handler?',
      file: 'src/mw.ts',
      line: 12,
      category: 'security' as const,
      why: 'auth boundary',
    },
  ],
  chapters: [chapter],
  missing: ['tests for the 401 path'],
};

const prMetadata = {
  number: 42,
  title: 'Move auth',
  body: 'body',
  state: 'open' as const,
  draft: false,
  author: { login: 'octocat', avatarUrl: 'https://x/y.png' },
  branch: 'feat/auth',
  base: 'main',
  labels: ['auth'],
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-02T00:00:00Z',
  additions: 10,
  deletions: 2,
  changedFiles: 3,
  commits: 1,
  headSha: 'abc1234',
};

const comment = {
  id: 1,
  author: 'octocat',
  body: 'looks good',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  path: 'src/mw.ts',
  line: 12,
  side: 'RIGHT' as const,
};

const diffFile = {
  file: 'src/mw.ts',
  isNewFile: false,
  isDeleted: false,
  hunks: [
    {
      header: '@@ -1,2 +1,3 @@',
      oldStart: 1,
      oldCount: 2,
      newStart: 1,
      newCount: 3,
      lines: [{ type: 'add' as const, content: 'x', lineNumber: { new: 1 } }],
    },
  ],
};

const checkRun = {
  id: 5,
  name: 'ci',
  status: 'completed' as const,
  conclusion: 'success',
  startedAt: null,
  completedAt: null,
  detailsUrl: null,
  output: { title: 'ok' },
};

const review = {
  id: 7,
  user: 'octocat',
  avatarUrl: 'https://x/y.png',
  state: 'APPROVED' as const,
  submittedAt: '2024-01-01T00:00:00Z',
};

const plan = {
  schemaVersion: 1 as const,
  prTitle: 'Move auth',
  prTldr: 'Relocates the auth check.',
  prVerdict: 'caution' as const,
  themes: [
    {
      id: 'theme-0',
      title: 'Auth',
      riskLevel: 'high' as const,
      rationale: 'boundary',
      hunkRefs: [{ file: 'src/mw.ts', hunkIndex: 0 }],
    },
  ],
  readingPlan: [{ step: 'Start at chapter 1' }],
  concerns: [],
};

const recap = {
  goal: 'Move auth into middleware.',
  stateOfPlay: { done: ['handler'], wip: ['mw'], notStarted: [] },
  decisions: [{ decision: 'Use middleware', reason: 'central', source: { type: 'commit' as const, ref: 'abc' } }],
  blockers: [{ issue: 'no tests', evidence: 'src/mw.ts', type: 'todo' as const }],
  mentalModel: { coreFiles: ['src/mw.ts'], touchpoints: ['src/app.ts'], sketch: 'app -> mw -> handler' },
  howToHelp: [{ suggestion: 'add a 401 test', why: 'covers the boundary' }],
};

const wireUnit = {
  unitId: 'u1',
  repo: 'octo/repo',
  source: 'github' as const,
  worktreePath: '/tmp/u1',
  taskLabel: 'Move auth',
  intent: 'review',
  uncertainties: [],
  baseRef: 'main',
  diffContentKey: 'k',
  status: 'queued' as const,
  toResolve: 1,
  files: [diffFile],
  metadata: prMetadata,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  lane: 'needs-you' as const,
};

const configResponse = {
  config: { model: 'x' },
  github: { active: true, source: 'env' },
};

describe('narrative payload', () => {
  test('parses a representative narrative', () => {
    expect(narrativeResponseSchema.parse(narrative)).toEqual(narrative);
  });

  test('rejects a bad verdict enum', () => {
    expect(() => narrativeResponseSchema.parse({ ...narrative, verdict: 'yolo' })).toThrow();
  });

  test('rejects a diff section missing hunkIndex', () => {
    const bad = {
      ...narrative,
      chapters: [{ ...chapter, sections: [{ type: 'diff', file: 'a', startLine: 1, endLine: 2 }] }],
    };
    expect(() => narrativeResponseSchema.parse(bad)).toThrow();
  });

  test('round-trips a callstack section', () => {
    const withCallstack = {
      ...narrative,
      chapters: [
        {
          ...chapter,
          sections: [
            {
              type: 'callstack' as const,
              title: 'Submit path revalidates',
              frames: [
                { label: 'handleSubmit — src/form.ts', change: 'unchanged' as const, depth: 0 },
                {
                  label: 'validate — src/form.ts',
                  change: 'added' as const,
                  depth: 1,
                  file: 'src/form.ts',
                  hunkIndex: 0,
                },
              ],
            },
          ],
        },
      ],
    };
    expect(narrativeResponseSchema.parse(withCallstack)).toEqual(withCallstack);
  });

  test('rejects a callstack frame with a bad change enum', () => {
    const bad = {
      ...narrative,
      chapters: [
        {
          ...chapter,
          sections: [{ type: 'callstack', title: 't', frames: [{ label: 'f', change: 'nuked', depth: 0 }] }],
        },
      ],
    };
    expect(() => narrativeResponseSchema.parse(bad)).toThrow();
  });

  test('round-trips a sequence section', () => {
    const withSequence = {
      ...narrative,
      chapters: [
        {
          ...chapter,
          sections: [
            {
              type: 'sequence' as const,
              title: 'Client retries through the gateway',
              participants: ['Client', 'Gateway', 'Service'],
              messages: [
                { from: 'Client', to: 'Gateway', label: 'POST /order' },
                {
                  from: 'Gateway',
                  to: 'Service',
                  label: 'forward',
                  note: 'now wrapped in a retry',
                  file: 'src/gateway.ts',
                  hunkIndex: 0,
                },
                { from: 'Service', to: 'Service', label: 'validate' },
              ],
            },
          ],
        },
      ],
    };
    expect(narrativeResponseSchema.parse(withSequence)).toEqual(withSequence);
  });

  test('rejects a sequence message missing its label', () => {
    const bad = {
      ...narrative,
      chapters: [
        {
          ...chapter,
          sections: [{ type: 'sequence', title: 't', participants: ['A'], messages: [{ from: 'A', to: 'A' }] }],
        },
      ],
    };
    expect(() => narrativeResponseSchema.parse(bad)).toThrow();
  });

  test('rejects a sequence message with a non-numeric hunkIndex', () => {
    const bad = {
      ...narrative,
      chapters: [
        {
          ...chapter,
          sections: [
            {
              type: 'sequence',
              title: 't',
              participants: ['A', 'B'],
              messages: [{ from: 'A', to: 'B', label: 'x', file: 'a.ts', hunkIndex: 'nope' }],
            },
          ],
        },
      ],
    };
    expect(() => narrativeResponseSchema.parse(bad)).toThrow();
  });
});

describe('comments', () => {
  test('parses a raw comment (no chapterIndices)', () => {
    expect(prCommentSchema.parse(comment)).toEqual(comment);
  });

  test('accepts the server-added chapterIndices field', () => {
    const mapped = { ...comment, chapterIndices: [0, 2] };
    expect(prCommentSchema.parse(mapped).chapterIndices).toEqual([0, 2]);
  });
});

describe('plan and recap', () => {
  test('parses a plan', () => {
    expect(planSchema.parse(plan)).toEqual(plan);
  });

  test('parses a recap', () => {
    expect(recapResponseSchema.parse(recap)).toEqual(recap);
  });
});

// One representative payload per SSE event kind.
const sseCases: { event: string; data: unknown }[] = [
  { event: 'connected', data: { timestamp: 123 } },
  { event: 'comment', data: comment },
  { event: 'unit-comment', data: { unitId: 'u1', comment } },
  { event: 'comments', data: [comment] },
  { event: 'checks', data: [checkRun] },
  { event: 'reviews', data: [review] },
  {
    event: 'review-round',
    data: {
      round: {
        state: 'changes-requested',
        unresolvedThreads: 2,
        carriedOverThreads: 1,
        lastReviewSubmittedAt: '2024-01-02T00:00:00Z',
      },
    },
  },
  { event: 'config', data: configResponse },
  { event: 'pr', data: prMetadata },
  { event: 'units', data: { units: [wireUnit], dismissed: [], polledAt: 1 } },
  { event: 'regenerating', data: { previousSha: 'aaa', newSha: 'bbb' } },
  { event: 'regenerating', data: { previousSha: 'aaa', newSha: 'bbb', carriedOverThreads: 3 } },
  { event: 'narrative-progress', data: { chars: 100 } },
  { event: 'narrative-error', data: { message: 'boom' } },
  { event: 'narrative.partial', data: { narrative, pr: prMetadata, files: [diffFile], comments: [comment] } },
  {
    event: 'narrative',
    data: {
      narrative,
      pr: prMetadata,
      files: [diffFile],
      comments: [{ ...comment, chapterIndices: [0] }],
      collapse: { available: true, decisions: [], dividerBefore: null },
      callers: [{ chapterIndex: 0, callers: [], total: 0 }],
    },
  },
  { event: 'collapse', data: { collapse: { available: false, reason: 'size-cap' }, callers: [] } },
  { event: 'plan-ready', data: { plan } },
  { event: 'chapter-ready', data: { themeId: 'theme-0', index: 0, chapter } },
  { event: 'recap', data: { recap } },
  { event: 'recap-generating', data: { generating: true } },
  { event: 'recap-error', data: { error: 'nope' } },
];

describe('SseEvent discriminated union', () => {
  for (const c of sseCases) {
    test(`parses ${c.event}`, () => {
      expect<unknown>(sseEventSchema.parse(c)).toEqual(c);
    });
  }

  test('rejects an unknown event name', () => {
    expect(() => sseEventSchema.parse({ event: 'nope', data: {} })).toThrow();
  });

  test('rejects a well-named event with a malformed payload', () => {
    expect(() => sseEventSchema.parse({ event: 'narrative-progress', data: { chars: 'lots' } })).toThrow();
  });
});
