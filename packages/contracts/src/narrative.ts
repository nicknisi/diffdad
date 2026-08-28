import { z } from 'zod';

export const verdictSchema = z.enum(['safe', 'caution', 'risky']);
export type Verdict = z.infer<typeof verdictSchema>;

export const riskSchema = z.enum(['low', 'medium', 'high']);
export type Risk = z.infer<typeof riskSchema>;

export const concernCategorySchema = z.enum([
  'logic',
  'state',
  'timing',
  'validation',
  'security',
  'test-gap',
  'api-contract',
  'error-handling',
]);
export type ConcernCategory = z.infer<typeof concernCategorySchema>;

export const readingPlanStepSchema = z.object({
  step: z.string(),
  chapterIndex: z.number().optional(),
  why: z.string().optional(),
});
export type ReadingPlanStep = z.infer<typeof readingPlanStepSchema>;

export const concernSchema = z.object({
  question: z.string(),
  file: z.string(),
  line: z.number(),
  category: concernCategorySchema,
  why: z.string(),
});
export type Concern = z.infer<typeof concernSchema>;

export const calloutSchema = z.object({
  file: z.string(),
  line: z.number(),
  level: z.enum(['nit', 'concern', 'warning']),
  message: z.string(),
});
export type Callout = z.infer<typeof calloutSchema>;

export const reshowEntrySchema = z.object({
  ref: z.number(),
  file: z.string().optional(),
  framing: z.string().optional(),
  highlight: z.object({ from: z.number(), to: z.number() }).optional(),
});
export type ReshowEntry = z.infer<typeof reshowEntrySchema>;

export const narrativeSectionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('narrative'), content: z.string() }),
  z.object({
    type: z.literal('diff'),
    file: z.string(),
    startLine: z.number(),
    endLine: z.number(),
    hunkIndex: z.number(),
  }),
]);
export type NarrativeSection = z.infer<typeof narrativeSectionSchema>;

export const narrativeChapterSchema = z.object({
  title: z.string(),
  summary: z.string(),
  whyMatters: z.string(),
  risk: riskSchema,
  sections: z.array(narrativeSectionSchema),
  callouts: z.array(calloutSchema).optional(),
  reshow: z.array(reshowEntrySchema).optional(),
  themeId: z.string().optional(),
});
export type NarrativeChapter = z.infer<typeof narrativeChapterSchema>;

export const narrativeResponseSchema = z.object({
  title: z.string(),
  tldr: z.string(),
  verdict: verdictSchema,
  readingPlan: z.array(readingPlanStepSchema),
  concerns: z.array(concernSchema),
  chapters: z.array(narrativeChapterSchema),
  missing: z.array(z.string()).optional(),
});
export type NarrativeResponse = z.infer<typeof narrativeResponseSchema>;
