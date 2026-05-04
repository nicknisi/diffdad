import type { EvalFixture } from '../types';

/**
 * Adds a NOT NULL column with no default to a heavily-used table, in a single
 * forward-only migration. Production has 50M rows. The migration will lock
 * the table for the entire backfill, and there's no down() — irreversible.
 */
export const fixture: EvalFixture = {
  id: 'migration-without-rollback',
  description: 'Schema migration that locks production table and is non-reversible',
  pr: {
    number: 256,
    title: 'Add account_id to events table',
    body: 'Adds an account_id FK to the events table so we can do per-account analytics queries without joining through users.',
    state: 'open',
    draft: false,
    author: { login: 'sam', avatarUrl: '' },
    branch: 'events-account-id',
    base: 'main',
    labels: ['migration'],
    createdAt: '2026-04-22T16:00:00Z',
    updatedAt: '2026-04-22T16:00:00Z',
    additions: 38,
    deletions: 2,
    changedFiles: 2,
    commits: 1,
    headSha: '0000000000000000000000000000000000000256',
  },
  files: [
    {
      file: 'db/migrations/0042_events_account_id.sql',
      isNewFile: true,
      isDeleted: false,
      hunks: [
        {
          header: '@@ -0,0 +1,9 @@',
          oldStart: 0,
          oldCount: 0,
          newStart: 1,
          newCount: 9,
          lines: [
            { type: 'add', content: '-- Add account_id to events for per-account analytics.', lineNumber: { new: 1 } },
            { type: 'add', content: 'ALTER TABLE events', lineNumber: { new: 2 } },
            {
              type: 'add',
              content: '  ADD COLUMN account_id BIGINT NOT NULL REFERENCES accounts(id);',
              lineNumber: { new: 3 },
            },
            { type: 'add', content: '', lineNumber: { new: 4 } },
            { type: 'add', content: 'UPDATE events e', lineNumber: { new: 5 } },
            { type: 'add', content: '  SET account_id = u.account_id', lineNumber: { new: 6 } },
            { type: 'add', content: '  FROM users u', lineNumber: { new: 7 } },
            { type: 'add', content: '  WHERE u.id = e.user_id;', lineNumber: { new: 8 } },
            {
              type: 'add',
              content: 'CREATE INDEX events_account_id_idx ON events(account_id);',
              lineNumber: { new: 9 },
            },
          ],
        },
      ],
    },
    {
      file: 'src/analytics/events.ts',
      isNewFile: false,
      isDeleted: false,
      hunks: [
        {
          header: '@@ -10,7 +10,8 @@',
          oldStart: 10,
          oldCount: 7,
          newStart: 10,
          newCount: 8,
          lines: [
            {
              type: 'context',
              content: 'export async function eventsForAccount(accountId: string) {',
              lineNumber: { old: 10, new: 10 },
            },
            {
              type: 'remove',
              content:
                '  const sql = `SELECT e.* FROM events e JOIN users u ON u.id = e.user_id WHERE u.account_id = $1`;',
              lineNumber: { old: 11 },
            },
            {
              type: 'add',
              content: '  const sql = `SELECT * FROM events WHERE account_id = $1`;',
              lineNumber: { new: 11 },
            },
            { type: 'context', content: '  return db.query(sql, [accountId]);', lineNumber: { old: 12, new: 12 } },
            { type: 'context', content: '}', lineNumber: { old: 13, new: 13 } },
          ],
        },
      ],
    },
  ],
  groundTruth: {
    expectedConcerns: [
      'ADD COLUMN ... NOT NULL with no default will rewrite the entire events table; on a 50M-row table this locks the table for the duration of the migration and the application will see writes fail',
      'There is no down() / rollback migration — this change is irreversible without manual intervention',
      'The backfill UPDATE inside the same migration runs in a single transaction holding the ACCESS EXCLUSIVE lock acquired by ALTER TABLE; it should be split into batches',
      'No test or staging-runbook entry checks how the new column behaves for existing rows where the user has been deleted (orphan events)',
    ],
    expectedHotspots: ['db/migrations/0042_events_account_id.sql'],
    expectedMissing: [
      'rollback migration',
      'batched backfill strategy',
      'orphan-row handling for events without a corresponding user',
    ],
    shouldNotBeSafe: true,
  },
};
