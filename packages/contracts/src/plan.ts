import { z } from 'zod';
import { concernSchema, readingPlanStepSchema, verdictSchema } from './narrative';

export const hunkRefSchema = z.object({ file: z.string(), hunkIndex: z.number() });
export type HunkRef = z.infer<typeof hunkRefSchema>;

export const planThemeSchema = z.object({
  id: z.string(),
  title: z.string(),
  riskLevel: z.enum(['low', 'medium', 'high']),
  rationale: z.string(),
  hunkRefs: z.array(hunkRefSchema),
  suppress: z.boolean().optional(),
});
export type PlanTheme = z.infer<typeof planThemeSchema>;

export const planSchema = z.object({
  schemaVersion: z.literal(1),
  prTitle: z.string(),
  prTldr: z.string(),
  prVerdict: verdictSchema,
  themes: z.array(planThemeSchema),
  readingPlan: z.array(readingPlanStepSchema),
  concerns: z.array(concernSchema),
  missing: z.array(z.string()).optional(),
});
export type Plan = z.infer<typeof planSchema>;
