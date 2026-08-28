import { z } from 'zod';

/**
 * `config` event payload (packages/cli/src/config-api.ts `buildResponse`). `config` is the redacted
 * config object; its full shape (DiffDadConfig) lives outside this task's read set, so it is modeled as
 * an opaque record rather than field-by-field. `github` is the effective GitHub auth state.
 */
export const configResponseSchema = z.object({
  config: z.record(z.string(), z.unknown()),
  github: z.object({
    active: z.boolean(),
    source: z.string().nullable(),
    warning: z.string().optional(),
  }),
});
export type ConfigResponse = z.infer<typeof configResponseSchema>;
