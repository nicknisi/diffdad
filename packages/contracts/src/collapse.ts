import { z } from 'zod';

/**
 * Blast-radius half of the narrative payload (packages/cli/src/narrative/collapse.ts). Not drift-guarded
 * against the CLI here: `CollapseUnavailableReason` is derived from a `RepoContext` variant in the CLI,
 * a shape outside this task's read set. The reasons are enumerated from the web-side mirror instead.
 */
export const collapseEvidenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('no-external-callers'), files: z.array(z.string()), knownCallers: z.literal(0) }),
  z.object({ kind: z.literal('test-only'), files: z.array(z.string()) }),
  z.object({ kind: z.literal('generated'), files: z.array(z.string()) }),
]);
export type CollapseEvidence = z.infer<typeof collapseEvidenceSchema>;

export const collapseDecisionSchema = z.object({
  chapterIndex: z.number(),
  reason: z.string(),
  evidence: collapseEvidenceSchema,
});
export type CollapseDecision = z.infer<typeof collapseDecisionSchema>;

export const collapseUnavailableReasonSchema = z.enum(['size-cap', 'fetch-failed', 'extract-failed', 'empty-tree']);
export type CollapseUnavailableReason = z.infer<typeof collapseUnavailableReasonSchema>;

export const collapseResultSchema = z.union([
  z.object({
    available: z.literal(true),
    decisions: z.array(collapseDecisionSchema),
    dividerBefore: z.number().nullable(),
  }),
  z.object({ available: z.literal(false), reason: collapseUnavailableReasonSchema }),
]);
export type CollapseResult = z.infer<typeof collapseResultSchema>;

export const chapterCallersSchema = z.object({
  chapterIndex: z.number(),
  callers: z.array(z.string()),
  total: z.number(),
});
export type ChapterCallers = z.infer<typeof chapterCallersSchema>;

/** Mirror of the CLI's `PromptCapStats` (narrative/prompt.ts). */
export const capStatsSchema = z.object({
  perFileCap: z.number(),
  globalCap: z.number(),
  inputFileCount: z.number(),
  inputLineCount: z.number(),
  narratedFileCount: z.number(),
  narratedLineCount: z.number(),
  truncatedFiles: z.array(z.object({ file: z.string(), hunksDropped: z.number(), linesDropped: z.number() })),
  droppedFiles: z.array(z.string()),
});
export type CapStats = z.infer<typeof capStatsSchema>;
