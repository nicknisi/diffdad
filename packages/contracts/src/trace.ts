import { z } from 'zod';

/**
 * One coding-agent authoring session matched to the PR under review, mined from local Claude Code
 * logs on the reviewer's machine. Read-only and best-effort: `userPrompts` are the human prompts that
 * drove the change, never uploaded or persisted — they exist only in this HTTP response.
 */
/**
 * One extracted human prompt. `verified` is the guarantee: the text is a proven verbatim substring of the
 * session transcript, so the UI may quote it. `truncated` marks a display-capped prefix. An unverified
 * prompt is NEVER shown — the UI renders a placeholder in its place.
 */
export const tracePromptSchema = z.object({
  text: z.string(),
  verified: z.boolean(),
  truncated: z.boolean().optional(),
});
export type TracePrompt = z.infer<typeof tracePromptSchema>;

export const traceSessionSummarySchema = z.object({
  sessionId: z.string(),
  path: z.string(),
  startedAt: z.string(),
  endedAt: z.string(),
  branch: z.string().optional(),
  cwd: z.string().optional(),
  score: z.number(),
  userPrompts: z.array(tracePromptSchema),
});
export type TraceSessionSummary = z.infer<typeof traceSessionSummarySchema>;

export const traceIntentResponseSchema = z.object({
  sessions: z.array(traceSessionSummarySchema),
});
export type TraceIntentResponse = z.infer<typeof traceIntentResponseSchema>;
