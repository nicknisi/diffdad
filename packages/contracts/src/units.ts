import { z } from 'zod';
import { capStatsSchema } from './collapse';
import { diffFileSchema, prMetadataSchema } from './github';
import { concernSchema, narrativeResponseSchema, verdictSchema } from './narrative';

/**
 * Wire shape of a review unit as broadcast on the `units` event (packages/cli/src/units/lane.ts
 * `unitsPayload`, which is `ReviewUnit & { lane }`). Not drift-guarded against `ReviewUnit`: that type
 * pulls in `TriageSummary`, `CriticalityTag`, and `TriageKind` from files outside this task's read set.
 * The nested shapes are modeled from the web-side mirror instead.
 */

export const laneSchema = z.enum(['needs-you', 'probably-not', 'in-flight', 'cleared']);
export type Lane = z.infer<typeof laneSchema>;

export const unitStatusSchema = z.enum(['queued', 'approved', 'changes_requested', 'done']);
export type UnitStatus = z.infer<typeof unitStatusSchema>;

export const criticalityTagSchema = z.enum([
  'auth',
  'security',
  'crypto',
  'payment',
  'migration',
  'permission',
  'token',
  'session',
  'database',
  'config',
  'infra',
]);
export type CriticalityTag = z.infer<typeof criticalityTagSchema>;

export const triageKindSchema = z.enum([
  'lockfile',
  'generated',
  'snapshot',
  'vendored',
  'minified',
  'binary',
  'oversized',
  'manifest',
  'test-only',
  'docs',
  'source',
]);
export type TriageKind = z.infer<typeof triageKindSchema>;

export const triagedFileSchema = z.object({
  path: z.string(),
  kind: triageKindSchema,
  criticality: z.array(criticalityTagSchema),
});
export type TriagedFile = z.infer<typeof triagedFileSchema>;

export const triageSummarySchema = z.object({
  files: z.array(triagedFileSchema),
  criticality: z.array(criticalityTagSchema),
  additions: z.number(),
  deletions: z.number(),
  truncated: z.boolean(),
  sha: z.string(),
});
export type TriageSummary = z.infer<typeof triageSummarySchema>;

export const unitDecisionSchema = z.object({
  kind: z.enum(['approved', 'changes_requested']),
  concerns: z.array(concernSchema).optional(),
  note: z.string().optional(),
});
export type UnitDecision = z.infer<typeof unitDecisionSchema>;

export const wireUnitSchema = z.object({
  unitId: z.string(),
  repo: z.string(),
  source: z.literal('github'),
  worktreePath: z.string(),
  taskLabel: z.string(),
  intent: z.string(),
  uncertainties: z.array(z.string()),
  baseRef: z.string(),
  diffContentKey: z.string(),
  status: unitStatusSchema,
  toResolve: z.number(),
  files: z.array(diffFileSchema),
  metadata: prMetadataSchema,
  narrative: narrativeResponseSchema.optional(),
  capStats: capStatsSchema.optional(),
  verdict: verdictSchema.optional(),
  decision: unitDecisionSchema.optional(),
  error: z.string().optional(),
  prNumber: z.number().optional(),
  prUrl: z.string().optional(),
  prAuthor: z.string().optional(),
  lastReviewedSha: z.string().optional(),
  pinned: z.boolean().optional(),
  triage: triageSummarySchema.optional(),
  dismissedAtSha: z.string().optional(),
  reviewRollup: z.object({ approved: z.number(), changesRequested: z.number() }).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lane: laneSchema,
});
export type WireUnit = z.infer<typeof wireUnitSchema>;

/** `units` event payload: `unitsPayload(...)` plus the poller's optional `polledAt`. */
export const unitsPayloadSchema = z.object({
  units: z.array(wireUnitSchema),
  dismissed: z.array(wireUnitSchema),
  polledAt: z.number().optional(),
});
export type UnitsPayload = z.infer<typeof unitsPayloadSchema>;
