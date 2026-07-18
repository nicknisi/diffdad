import type { DiffDadConfig } from '../config';

/**
 * The credential resolution decision for the amazon-bedrock provider, as plain data.
 *
 * Precedence, highest first:
 *   1. `api-key`  — a Bedrock bearer API key is present; requests use `Authorization: Bearer`, no SigV4.
 *   2. `explicit` — both an access key id AND a secret access key are present (a partial pair does
 *      not count; it falls through).
 *   3. `profile`  — a named AWS profile is set; the caller scopes the node provider chain to it.
 *   4. `default`  — nothing set; resolve the ambient chain (env, `~/.aws`, `AWS_PROFILE`, IAM role).
 *
 * The settings form keeps modes mutually exclusive on save (picking one clears the others' fields),
 * so this order only decides hand-edited configs.
 *
 * Kept as a pure function (no AWS imports) so the branching is unit-testable and shared by both the
 * list path (`bedrock-models.ts`) and the invoke path (`ai-runtime.ts`) instead of being duplicated.
 */
export type BedrockCredsChoice =
  | { kind: 'api-key'; apiKey: string }
  | { kind: 'explicit'; accessKeyId: string; secretAccessKey: string }
  | { kind: 'profile'; profile: string }
  | { kind: 'default' };

export function resolveBedrockCreds(config: DiffDadConfig): BedrockCredsChoice {
  if (config.aiBedrockApiKey) {
    return { kind: 'api-key', apiKey: config.aiBedrockApiKey };
  }
  if (config.aiAccessKeyId && config.aiSecretAccessKey) {
    return {
      kind: 'explicit',
      accessKeyId: config.aiAccessKeyId,
      secretAccessKey: config.aiSecretAccessKey,
    };
  }
  if (config.aiProfile) {
    return { kind: 'profile', profile: config.aiProfile };
  }
  return { kind: 'default' };
}
