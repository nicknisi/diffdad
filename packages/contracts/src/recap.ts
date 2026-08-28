import { z } from 'zod';

export const decisionSourceTypeSchema = z.enum(['commit', 'thread', 'pr-body', 'force-push', 'issue']);
export type DecisionSourceType = z.infer<typeof decisionSourceTypeSchema>;

export const blockerTypeSchema = z.enum(['ci', 'review-question', 'thrash', 'todo']);
export type BlockerType = z.infer<typeof blockerTypeSchema>;

export const decisionSchema = z.object({
  decision: z.string(),
  reason: z.string(),
  source: z.object({ type: decisionSourceTypeSchema, ref: z.string() }),
  alternativesRuledOut: z.array(z.string()).optional(),
});
export type Decision = z.infer<typeof decisionSchema>;

export const blockerSchema = z.object({
  issue: z.string(),
  evidence: z.string(),
  type: blockerTypeSchema,
});
export type Blocker = z.infer<typeof blockerSchema>;

export const helpSuggestionSchema = z.object({
  suggestion: z.string(),
  why: z.string(),
});
export type HelpSuggestion = z.infer<typeof helpSuggestionSchema>;

export const recapResponseSchema = z.object({
  goal: z.string(),
  stateOfPlay: z.object({
    done: z.array(z.string()),
    wip: z.array(z.string()),
    notStarted: z.array(z.string()),
  }),
  decisions: z.array(decisionSchema),
  blockers: z.array(blockerSchema),
  mentalModel: z.object({
    coreFiles: z.array(z.string()),
    touchpoints: z.array(z.string()),
    sketch: z.string(),
  }),
  howToHelp: z.array(helpSuggestionSchema),
});
export type RecapResponse = z.infer<typeof recapResponseSchema>;
