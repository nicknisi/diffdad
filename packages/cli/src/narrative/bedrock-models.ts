import {
  BedrockClient,
  type FoundationModelSummary,
  type InferenceProfileSummary,
  ListFoundationModelsCommand,
  ListInferenceProfilesCommand,
} from '@aws-sdk/client-bedrock';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import type { DiffDadConfig } from '../config';
import { resolveProfileRegion } from './aws-profiles';
import { type BedrockCredsChoice, resolveBedrockCreds } from './bedrock-credentials';

// Cap the AWS round-trip. With no credentials/region the SDK's chain falls through to the EC2
// instance-metadata endpoint (169.254.169.254), which is unroutable off-EC2 and hangs on slow
// connection-timeout retries. Racing a deadline turns that silent hang into a surfaced 502.
const LIST_TIMEOUT_MS = 10_000;

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  // When the deadline wins, `work` is still pending and may reject later (e.g. the credential chain
  // giving up on IMDS seconds after the race settled) — absorb that so it can't become an unhandled
  // rejection. Promise.race subscribes separately, so a caller still sees `work`'s own rejection.
  work.catch(() => {});
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer)) as Promise<T>;
}

export interface BedrockModelOption {
  id: string;
  label: string;
}

/**
 * Merge text-capable foundation models with inference profiles into one deduped, sorted list.
 *
 * - Foundation models are filtered to those advertising `TEXT` output (defensive — the API is also
 *   asked with `byOutputModality: 'TEXT'`, but a mocked/older response may not honor it).
 * - Foundation models that only support `INFERENCE_PROFILE` (no `ON_DEMAND`) are dropped: the bare id
 *   can't be invoked directly, so offering it is a trap. Current Claude models are exactly this case —
 *   they're reachable through the `us.anthropic.*` inference profiles, which are merged in below.
 * - Dedupe by id (foundation wins a collision — same underlying model, one row); sort by id.
 */
export function mergeBedrockModels(
  foundationModels: FoundationModelSummary[],
  inferenceProfiles: InferenceProfileSummary[],
): BedrockModelOption[] {
  const byId = new Map<string, BedrockModelOption>();

  for (const m of foundationModels) {
    if (!m.modelId) continue;
    if (!m.outputModalities?.includes('TEXT')) continue;
    // Drop inference-profile-only models. We check ON_DEMAND *positively* rather than looking for
    // 'INFERENCE_PROFILE' because the live API returns that value but the SDK's InferenceType type
    // doesn't list it — so keep only what's provably on-demand invokable. An unset field means the API
    // didn't classify the model, so keep it rather than over-filter.
    if (m.inferenceTypesSupported && !m.inferenceTypesSupported.includes('ON_DEMAND')) continue;
    if (byId.has(m.modelId)) continue;
    const label = m.modelName && m.modelName.length > 0 ? m.modelName : m.modelId;
    byId.set(m.modelId, { id: m.modelId, label });
  }

  for (const p of inferenceProfiles) {
    if (!p.inferenceProfileId) continue;
    if (byId.has(p.inferenceProfileId)) continue;
    const name =
      p.inferenceProfileName && p.inferenceProfileName.length > 0 ? p.inferenceProfileName : p.inferenceProfileId;
    byId.set(p.inferenceProfileId, { id: p.inferenceProfileId, label: `${name} (inference profile)` });
  }

  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Map a SigV4 credential choice to the SDK credential provider. Explicit keys become a static
 * provider, a named profile scopes the node chain, and `default` resolves the ambient chain (env,
 * `~/.aws`, `AWS_PROFILE`, IAM role). The `api-key` kind is excluded at the type level: a bearer
 * key has no SigV4 identity, so routing it here would silently authenticate as the ambient chain.
 */
function toCredentialProvider(
  choice: Exclude<BedrockCredsChoice, { kind: 'api-key' }>,
): ReturnType<typeof fromNodeProviderChain> {
  if (choice.kind === 'explicit') {
    const identity = { accessKeyId: choice.accessKeyId, secretAccessKey: choice.secretAccessKey };
    return async () => identity;
  }
  return choice.kind === 'profile' ? fromNodeProviderChain({ profile: choice.profile }) : fromNodeProviderChain();
}

/** Auth fragment for the raw `BedrockClient` (list path): SigV4 credentials or a bearer token. */
export type BedrockListClientAuth =
  | { credentials: ReturnType<typeof fromNodeProviderChain> }
  | { token: { token: string }; authSchemePreference: ['httpBearerAuth'] };

/** Plain fetch signature — Bun's `typeof fetch` drags in `preconnect`, which callers don't provide. */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** Auth fragment for `createAmazonBedrock` (invoke path). `fetch` is set only for bearer auth. */
export interface BedrockInvokeAuth {
  credentialProvider: () => Promise<{ accessKeyId: string; secretAccessKey: string; sessionToken?: string }>;
  fetch?: typeof globalThis.fetch;
}

/*
 * The two mappers below are the ONLY translation from a creds choice to SDK auth config — one per
 * SDK, because the raw client and the AI-SDK provider take different shapes. They must stay in
 * lockstep: "Load models" succeeding has to imply generation authenticates the same way.
 */

export function toListClientAuth(choice: BedrockCredsChoice): BedrockListClientAuth {
  if (choice.kind === 'api-key') {
    return { token: { token: choice.apiKey }, authSchemePreference: ['httpBearerAuth'] };
  }
  return { credentials: toCredentialProvider(choice) };
}

// @ai-sdk/amazon-bedrock@2 has no bearer support (that landed in v3 / ai@5) and unconditionally
// SigV4-signs every POST, throwing if the credential chain is empty. So bearer mode feeds the
// signer a dummy identity and swaps the real bearer header in at the inner fetch — the signature
// is computed, discarded, and never reaches the wire. Verified live against us-east-1.
const BEARER_DUMMY_IDENTITY = { accessKeyId: 'bedrock-api-key', secretAccessKey: 'bedrock-api-key' };

export function toInvokeAuth(choice: BedrockCredsChoice, fetchImpl: FetchLike = globalThis.fetch): BedrockInvokeAuth {
  if (choice.kind !== 'api-key') {
    return { credentialProvider: toCredentialProvider(choice) };
  }
  const bearerFetch: FetchLike = (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set('authorization', `Bearer ${choice.apiKey}`);
    return fetchImpl(input, { ...init, headers });
  };
  // Cast: Bun's `typeof fetch` demands a `preconnect` property the AI SDK never touches.
  return { credentialProvider: async () => BEARER_DUMMY_IDENTITY, fetch: bearerFetch as typeof globalThis.fetch };
}

/**
 * The region this config declares, without asking the SDK: explicit `aiRegion` wins, otherwise the
 * selected profile's `region =` from `~/.aws` — which the SDK never reads on its own (it scopes
 * credentials to the profile but resolves region from env / the default profile). `undefined` means
 * "let the client's own default chain decide".
 */
async function resolveConfiguredRegion(config: DiffDadConfig, choice: BedrockCredsChoice): Promise<string | undefined> {
  return config.aiRegion || (choice.kind === 'profile' ? await resolveProfileRegion(choice.profile) : undefined);
}

/**
 * Build a BedrockClient for the config, returning the configured region alongside so callers don't
 * re-derive it. `region` is `undefined` when the client is left to its ambient chain.
 */
async function makeBedrockClient(
  config: DiffDadConfig,
): Promise<{ client: BedrockClient; region: string | undefined }> {
  const choice = resolveBedrockCreds(config);
  const region = await resolveConfiguredRegion(config, choice);
  return { client: new BedrockClient({ region, ...toListClientAuth(choice) }), region };
}

/**
 * Resolve the region the SDK would actually use for this config — the explicit `aiRegion` if set,
 * otherwise the profile's / ambient chain's region (env, `~/.aws/config`, SSO session). Returns
 * `undefined` (never throws) when nothing resolves, so callers can fall through to their own error.
 *
 * This closes the asymmetry between the two Bedrock SDKs: the raw `BedrockClient` resolves region from
 * the profile on its own, but `createAmazonBedrock` (the invoke path) needs an explicit string — so the
 * invoke path resolves region through here first.
 */
export async function resolveBedrockRegion(config: DiffDadConfig): Promise<string | undefined> {
  try {
    const choice = resolveBedrockCreds(config);
    const configured = await resolveConfiguredRegion(config, choice);
    if (configured) return configured;
    // Ambient case: only the SDK's own chain (env, the config file's default profile) can answer,
    // and its region resolution lives in the client constructor — build one just for this fallback.
    return await new BedrockClient({ ...toListClientAuth(choice) }).config.region();
  } catch {
    return undefined;
  }
}

/**
 * List available Bedrock text models for a config: text-capable foundation models merged with
 * inference profiles (see {@link mergeBedrockModels}). The region the client ended up with rides
 * along so the UI can prefill it after a successful list (transparency for profile users).
 *
 * Throws on any AWS error (missing permission, bad region, expired creds); the caller surfaces it.
 */
export async function listBedrockModels(
  config: DiffDadConfig,
): Promise<{ models: BedrockModelOption[]; region: string | undefined }> {
  const { client, region: configured } = await makeBedrockClient(config);

  // ListFoundationModels returns everything in one call (no nextToken). ListInferenceProfiles
  // paginates, so follow nextToken until exhausted or nothing new comes back.
  const [fm, profiles, region] = await withTimeout(
    Promise.all([
      client.send(new ListFoundationModelsCommand({ byOutputModality: 'TEXT' })),
      collectInferenceProfiles(client),
      // Only ask the SDK when the config didn't already answer (ambient-chain case).
      configured ?? client.config.region().catch(() => undefined),
    ]),
    LIST_TIMEOUT_MS,
    'Timed out reaching AWS — check the region and credentials for this profile',
  );

  return { models: mergeBedrockModels(fm.modelSummaries ?? [], profiles), region };
}

async function collectInferenceProfiles(client: BedrockClient): Promise<InferenceProfileSummary[]> {
  const all: InferenceProfileSummary[] = [];
  let nextToken: string | undefined;
  do {
    const page = await client.send(new ListInferenceProfilesCommand(nextToken ? { nextToken } : {}));
    if (page.inferenceProfileSummaries) all.push(...page.inferenceProfileSummaries);
    nextToken = page.nextToken;
  } while (nextToken);
  return all;
}
