import { z } from 'zod';

/**
 * One coding-agent authoring session matched to the PR under review, mined from local Claude Code
 * logs on the reviewer's machine. Read-only and best-effort: `userPrompts` are the human prompts that
 * drove the change, never uploaded or persisted — they exist only in this HTTP response.
 */
export const traceSessionSummarySchema = z.object({
  sessionId: z.string(),
  path: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
  branch: z.string().optional(),
  cwd: z.string().optional(),
  score: z.number(),
  userPrompts: z.array(z.string()),
});
export type TraceSessionSummary = z.infer<typeof traceSessionSummarySchema>;

export const traceIntentResponseSchema = z.object({
  sessions: z.array(traceSessionSummarySchema),
});
export type TraceIntentResponse = z.infer<typeof traceIntentResponseSchema>;
