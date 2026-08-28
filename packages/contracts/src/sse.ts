import { z } from 'zod';
import { chapterCallersSchema, capStatsSchema, collapseResultSchema } from './collapse';
import { configResponseSchema } from './config';
import { checkRunSchema, diffFileSchema, prCommentSchema, prMetadataSchema, prReviewSchema } from './github';
import { narrativeChapterSchema, narrativeResponseSchema } from './narrative';
import { planSchema } from './plan';
import { recapResponseSchema } from './recap';
import { unitsPayloadSchema } from './units';

/** Blast-radius fields that ride the `narrative` and `collapse` payloads. Both keys absent = not looked yet. */
const blastRadiusShape = {
  collapse: collapseResultSchema.optional(),
  callers: z.array(chapterCallersSchema).optional(),
};

const narrativePayloadSchema = z.object({
  narrative: narrativeResponseSchema,
  pr: prMetadataSchema,
  files: z.array(diffFileSchema),
  comments: z.array(prCommentSchema),
  ...blastRadiusShape,
  capStats: capStatsSchema.optional(),
});

export const sseEventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('connected'), data: z.object({ timestamp: z.number() }) }),
  z.object({ event: z.literal('comment'), data: prCommentSchema }),
  z.object({
    event: z.literal('unit-comment'),
    data: z.object({ unitId: z.string(), comment: prCommentSchema }),
  }),
  z.object({ event: z.literal('comments'), data: z.array(prCommentSchema) }),
  z.object({ event: z.literal('checks'), data: z.array(checkRunSchema) }),
  z.object({ event: z.literal('reviews'), data: z.array(prReviewSchema) }),
  z.object({ event: z.literal('config'), data: configResponseSchema }),
  z.object({ event: z.literal('pr'), data: prMetadataSchema }),
  z.object({ event: z.literal('units'), data: unitsPayloadSchema }),
  z.object({
    event: z.literal('regenerating'),
    data: z.object({ previousSha: z.string(), newSha: z.string() }),
  }),
  z.object({ event: z.literal('narrative-progress'), data: z.object({ chars: z.number() }) }),
  z.object({ event: z.literal('narrative-error'), data: z.object({ message: z.string() }) }),
  z.object({
    event: z.literal('narrative.partial'),
    data: z.object({
      narrative: narrativeResponseSchema,
      pr: prMetadataSchema,
      files: z.array(diffFileSchema),
      comments: z.array(prCommentSchema),
    }),
  }),
  z.object({ event: z.literal('narrative'), data: narrativePayloadSchema }),
  z.object({ event: z.literal('collapse'), data: z.object(blastRadiusShape) }),
  z.object({ event: z.literal('plan-ready'), data: z.object({ plan: planSchema }) }),
  z.object({
    event: z.literal('chapter-ready'),
    data: z.object({ themeId: z.string(), index: z.number(), chapter: narrativeChapterSchema }),
  }),
  z.object({ event: z.literal('recap'), data: z.object({ recap: recapResponseSchema }) }),
  z.object({ event: z.literal('recap-generating'), data: z.object({ generating: z.boolean() }) }),
  z.object({ event: z.literal('recap-error'), data: z.object({ error: z.string() }) }),
]);
export type SseEvent = z.infer<typeof sseEventSchema>;
