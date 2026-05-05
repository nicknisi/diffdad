import type { EvalFixture } from '../types';

/**
 * Subtle bug: a write-through cache wrapper has a check-then-act race —
 * concurrent calls can read the same stale value, both compute new values,
 * and both write, and the last writer wins (which is the older one).
 */
export const fixture: EvalFixture = {
  id: 'cache-race-condition',
  description: 'Cache wrapper with check-then-act race condition between concurrent loaders',
  pr: {
    number: 88,
    title: 'Add memoizing cache to userProfile lookup',
    body: 'Wraps the userProfile fetch in a small cache so we stop hammering the auth service for repeated lookups during a request burst.',
    state: 'open',
    draft: false,
    author: { login: 'jamie', avatarUrl: '' },
    branch: 'cache-user-profile',
    base: 'main',
    labels: ['performance'],
    createdAt: '2026-04-19T08:00:00Z',
    updatedAt: '2026-04-19T08:00:00Z',
    additions: 51,
    deletions: 6,
    changedFiles: 2,
    commits: 1,
    headSha: '0000000000000000000000000000000000000088',
  },
  files: [
    {
      file: 'src/cache/profile-cache.ts',
      isNewFile: true,
      isDeleted: false,
      hunks: [
        {
          header: '@@ -0,0 +1,32 @@',
          oldStart: 0,
          oldCount: 0,
          newStart: 1,
          newCount: 32,
          lines: [
            { type: 'add', content: "import type { UserProfile } from '../types';", lineNumber: { new: 1 } },
            { type: 'add', content: "import { fetchUserProfile } from '../auth/client';", lineNumber: { new: 2 } },
            { type: 'add', content: '', lineNumber: { new: 3 } },
            { type: 'add', content: 'const TTL_MS = 30_000;', lineNumber: { new: 4 } },
            { type: 'add', content: '', lineNumber: { new: 5 } },
            { type: 'add', content: 'type Entry = { value: UserProfile; expiresAt: number };', lineNumber: { new: 6 } },
            { type: 'add', content: '', lineNumber: { new: 7 } },
            { type: 'add', content: 'const cache = new Map<string, Entry>();', lineNumber: { new: 8 } },
            { type: 'add', content: '', lineNumber: { new: 9 } },
            {
              type: 'add',
              content: 'export async function getUserProfile(userId: string): Promise<UserProfile> {',
              lineNumber: { new: 10 },
            },
            { type: 'add', content: '  const cached = cache.get(userId);', lineNumber: { new: 11 } },
            { type: 'add', content: '  if (cached && cached.expiresAt > Date.now()) {', lineNumber: { new: 12 } },
            { type: 'add', content: '    return cached.value;', lineNumber: { new: 13 } },
            { type: 'add', content: '  }', lineNumber: { new: 14 } },
            { type: 'add', content: '', lineNumber: { new: 15 } },
            { type: 'add', content: '  const fresh = await fetchUserProfile(userId);', lineNumber: { new: 16 } },
            {
              type: 'add',
              content: '  cache.set(userId, { value: fresh, expiresAt: Date.now() + TTL_MS });',
              lineNumber: { new: 17 },
            },
            { type: 'add', content: '  return fresh;', lineNumber: { new: 18 } },
            { type: 'add', content: '}', lineNumber: { new: 19 } },
            { type: 'add', content: '', lineNumber: { new: 20 } },
            { type: 'add', content: 'export function invalidateProfile(userId: string) {', lineNumber: { new: 21 } },
            { type: 'add', content: '  cache.delete(userId);', lineNumber: { new: 22 } },
            { type: 'add', content: '}', lineNumber: { new: 23 } },
          ],
        },
      ],
    },
    {
      file: 'src/handlers/me.ts',
      isNewFile: false,
      isDeleted: false,
      hunks: [
        {
          header: '@@ -1,9 +1,9 @@',
          oldStart: 1,
          oldCount: 9,
          newStart: 1,
          newCount: 9,
          lines: [
            { type: 'remove', content: "import { fetchUserProfile } from '../auth/client';", lineNumber: { old: 1 } },
            {
              type: 'add',
              content: "import { getUserProfile } from '../cache/profile-cache';",
              lineNumber: { new: 1 },
            },
            { type: 'context', content: '', lineNumber: { old: 2, new: 2 } },
            { type: 'context', content: 'export async function meHandler(req, res) {', lineNumber: { old: 3, new: 3 } },
            { type: 'context', content: '  const userId = req.user.sub;', lineNumber: { old: 4, new: 4 } },
            { type: 'remove', content: '  const profile = await fetchUserProfile(userId);', lineNumber: { old: 5 } },
            { type: 'add', content: '  const profile = await getUserProfile(userId);', lineNumber: { new: 5 } },
            { type: 'context', content: '  res.json(profile);', lineNumber: { old: 6, new: 6 } },
            { type: 'context', content: '}', lineNumber: { old: 7, new: 7 } },
          ],
        },
      ],
    },
  ],
  groundTruth: {
    expectedConcerns: [
      'Concurrent calls for the same userId on a cold cache will both miss, both fetch from the auth service, and both write — losing the deduplication benefit and racing on the cache.set',
      'No request coalescing / single-flight pattern — burst of 100 concurrent requests for the same userId all hit the auth service',
      'No tests added for cache hit/miss/expiry behavior',
      'Cache is module-level and never cleared — long-running processes will grow it unbounded if many distinct user IDs are seen',
    ],
    expectedHotspots: ['src/cache/profile-cache.ts'],
    expectedMissing: ['tests for profile-cache.ts', 'request coalescing for concurrent misses'],
    shouldNotBeSafe: true,
  },
};
