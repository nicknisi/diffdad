import { z } from 'zod';

export const prMetadataSchema = z.object({
  number: z.number(),
  title: z.string(),
  body: z.string(),
  state: z.enum(['open', 'closed', 'merged']),
  draft: z.boolean(),
  author: z.object({ login: z.string(), avatarUrl: z.string() }),
  branch: z.string(),
  base: z.string(),
  labels: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  additions: z.number(),
  deletions: z.number(),
  changedFiles: z.number(),
  commits: z.number(),
  headSha: z.string(),
  archived: z.boolean().optional(),
});
export type PRMetadata = z.infer<typeof prMetadataSchema>;

/**
 * Base comment shape, byte-for-byte the CLI's `PRComment`. Kept separate from
 * {@link prCommentSchema} so the drift guard can assert exact equality against the CLI type,
 * while the exported schema carries the server-added `chapterIndices`.
 */
export const prCommentBaseSchema = z.object({
  id: z.number(),
  author: z.string(),
  avatarUrl: z.string().optional(),
  body: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  path: z.string().optional(),
  line: z.number().optional(),
  side: z.enum(['LEFT', 'RIGHT']).optional(),
  startLine: z.number().optional(),
  startSide: z.enum(['LEFT', 'RIGHT']).optional(),
  inReplyToId: z.number().optional(),
  diffHunk: z.string().optional(),
});
export type PRCommentBase = z.infer<typeof prCommentBaseSchema>;

/**
 * The comment as it actually rides SSE/HTTP payloads: `mapCommentsToChapters` (github/comments.ts)
 * appends `chapterIndices` before broadcast, but the CLI's own `PRComment` type never declared it —
 * the documented type-drift bug this field fixes. Optional because raw (unmapped) broadcasts such as
 * the `comment` and `comments` events send it without.
 */
export const prCommentSchema = prCommentBaseSchema.extend({
  chapterIndices: z.array(z.number()).optional(),
});
export type PRComment = z.infer<typeof prCommentSchema>;

export const diffLineSchema = z.object({
  type: z.enum(['add', 'remove', 'context']),
  content: z.string(),
  lineNumber: z.object({ old: z.number().optional(), new: z.number().optional() }),
});
export type DiffLine = z.infer<typeof diffLineSchema>;

export const diffHunkSchema = z.object({
  header: z.string(),
  oldStart: z.number(),
  oldCount: z.number(),
  newStart: z.number(),
  newCount: z.number(),
  lines: z.array(diffLineSchema),
});
export type DiffHunk = z.infer<typeof diffHunkSchema>;

export const diffFileSchema = z.object({
  file: z.string(),
  isNewFile: z.boolean(),
  isDeleted: z.boolean(),
  hunks: z.array(diffHunkSchema),
  mtime: z.number().optional(),
});
export type DiffFile = z.infer<typeof diffFileSchema>;

export const prReviewSchema = z.object({
  id: z.number(),
  user: z.string(),
  avatarUrl: z.string(),
  state: z.enum(['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED', 'PENDING']),
  submittedAt: z.string(),
});
export type PRReview = z.infer<typeof prReviewSchema>;

export const checkRunSchema = z.object({
  id: z.number(),
  name: z.string(),
  status: z.enum(['queued', 'in_progress', 'completed']),
  conclusion: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  detailsUrl: z.string().nullable(),
  output: z.object({ title: z.string().optional(), summary: z.string().optional() }),
});
export type CheckRun = z.infer<typeof checkRunSchema>;
