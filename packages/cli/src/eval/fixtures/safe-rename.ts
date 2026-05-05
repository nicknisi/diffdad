import type { EvalFixture } from '../types';

/**
 * Negative case: a pure rename + import-path update. Should be classified as
 * safe with no concerns. Tests that the harness penalizes "false positive
 * concerns" — the canonical Greptile-style failure mode.
 */
export const fixture: EvalFixture = {
  id: 'safe-rename',
  description: 'Pure rename refactor — should be flagged safe with no concerns',
  pr: {
    number: 17,
    title: 'Rename utils/format.ts to utils/dateFormat.ts',
    body: 'Renames a utility module to better reflect its actual contents (date formatting only). All call sites updated.',
    state: 'open',
    draft: false,
    author: { login: 'pat', avatarUrl: '' },
    branch: 'rename-format-util',
    base: 'main',
    labels: ['refactor'],
    createdAt: '2026-04-15T11:00:00Z',
    updatedAt: '2026-04-15T11:00:00Z',
    additions: 6,
    deletions: 6,
    changedFiles: 3,
    commits: 1,
    headSha: '0000000000000000000000000000000000000017',
  },
  files: [
    {
      file: 'src/utils/dateFormat.ts',
      isNewFile: true,
      isDeleted: false,
      hunks: [
        {
          header: '@@ -0,0 +1,6 @@',
          oldStart: 0,
          oldCount: 0,
          newStart: 1,
          newCount: 6,
          lines: [
            { type: 'add', content: 'export function formatShortDate(d: Date): string {', lineNumber: { new: 1 } },
            {
              type: 'add',
              content: "  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });",
              lineNumber: { new: 2 },
            },
            { type: 'add', content: '}', lineNumber: { new: 3 } },
            { type: 'add', content: '', lineNumber: { new: 4 } },
            { type: 'add', content: 'export function formatLongDate(d: Date): string {', lineNumber: { new: 5 } },
            { type: 'add', content: '  return d.toLocaleDateString();', lineNumber: { new: 6 } },
            { type: 'add', content: '}', lineNumber: { new: 7 } },
          ],
        },
      ],
    },
    {
      file: 'src/utils/format.ts',
      isNewFile: false,
      isDeleted: true,
      hunks: [
        {
          header: '@@ -1,6 +0,0 @@',
          oldStart: 1,
          oldCount: 6,
          newStart: 0,
          newCount: 0,
          lines: [
            { type: 'remove', content: 'export function formatShortDate(d: Date): string {', lineNumber: { old: 1 } },
            {
              type: 'remove',
              content: "  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });",
              lineNumber: { old: 2 },
            },
            { type: 'remove', content: '}', lineNumber: { old: 3 } },
            { type: 'remove', content: '', lineNumber: { old: 4 } },
            { type: 'remove', content: 'export function formatLongDate(d: Date): string {', lineNumber: { old: 5 } },
            { type: 'remove', content: '  return d.toLocaleDateString();', lineNumber: { old: 6 } },
            { type: 'remove', content: '}', lineNumber: { old: 7 } },
          ],
        },
      ],
    },
    {
      file: 'src/components/Header.tsx',
      isNewFile: false,
      isDeleted: false,
      hunks: [
        {
          header: '@@ -1,5 +1,5 @@',
          oldStart: 1,
          oldCount: 5,
          newStart: 1,
          newCount: 5,
          lines: [
            { type: 'remove', content: "import { formatShortDate } from '../utils/format';", lineNumber: { old: 1 } },
            { type: 'add', content: "import { formatShortDate } from '../utils/dateFormat';", lineNumber: { new: 1 } },
            { type: 'context', content: '', lineNumber: { old: 2, new: 2 } },
            {
              type: 'context',
              content: 'export function Header({ date }: { date: Date }) {',
              lineNumber: { old: 3, new: 3 },
            },
            { type: 'context', content: '  return <h1>{formatShortDate(date)}</h1>;', lineNumber: { old: 4, new: 4 } },
            { type: 'context', content: '}', lineNumber: { old: 5, new: 5 } },
          ],
        },
      ],
    },
  ],
  groundTruth: {
    expectedConcerns: [],
    expectedHotspots: [],
    expectedMissing: [],
    shouldNotBeSafe: false,
  },
};
