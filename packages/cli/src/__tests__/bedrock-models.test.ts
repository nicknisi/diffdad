import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import {
  BedrockClient,
  type FoundationModelSummary,
  type InferenceProfileSummary,
  ListFoundationModelsCommand,
  ListInferenceProfilesCommand,
} from '@aws-sdk/client-bedrock';
import * as credentialProviders from '@aws-sdk/credential-providers';
import * as awsProfiles from '../narrative/aws-profiles';
import {
  listBedrockModels,
  mergeBedrockModels,
  resolveBedrockRegion,
  toInvokeAuth,
  toListClientAuth,
} from '../narrative/bedrock-models';

function fm(over: Partial<FoundationModelSummary>): FoundationModelSummary {
  return {
    modelArn: `arn:${over.modelId}`,
    modelId: 'x',
    outputModalities: ['TEXT'],
    ...over,
  } as FoundationModelSummary;
}
function ip(over: Partial<InferenceProfileSummary>): InferenceProfileSummary {
  return {
    inferenceProfileId: 'p',
    inferenceProfileName: 'P',
    inferenceProfileArn: `arn:${over.inferenceProfileId}`,
    models: [],
    status: 'ACTIVE',
    type: 'SYSTEM_DEFINED',
    ...over,
  } as InferenceProfileSummary;
}

describe('mergeBedrockModels', () => {
  it('drops foundation models that only support INFERENCE_PROFILE (not on-demand invokable)', () => {
    const out = mergeBedrockModels(
      [
        // Current Claude: inference-profile-only. The bare id is NOT invokable on-demand, so drop it.
        // Cast: the live API returns 'INFERENCE_PROFILE' but the SDK's InferenceType type lags it.
        fm({
          modelId: 'anthropic.claude-opus-4-8',
          modelName: 'Opus',
          inferenceTypesSupported: [
            'INFERENCE_PROFILE',
          ] as unknown as FoundationModelSummary['inferenceTypesSupported'],
        }),
        // An older model that supports on-demand directly — keep it.
        fm({ modelId: 'anthropic.claude-v2', modelName: 'Claude v2', inferenceTypesSupported: ['ON_DEMAND'] }),
      ],
      [ip({ inferenceProfileId: 'us.anthropic.claude-opus-4-8', inferenceProfileName: 'US Opus' })],
    );
    expect(out.map((m) => m.id)).toEqual(['anthropic.claude-v2', 'us.anthropic.claude-opus-4-8']);
  });

  it('keeps a foundation model whose inferenceTypesSupported is unset (cannot classify → do not over-filter)', () => {
    const out = mergeBedrockModels(
      [fm({ modelId: 'some.model', modelName: 'X', inferenceTypesSupported: undefined })],
      [],
    );
    expect(out.map((m) => m.id)).toEqual(['some.model']);
  });

  it('drops foundation models without TEXT output modality', () => {
    const out = mergeBedrockModels(
      [
        fm({ modelId: 'text.model', modelName: 'Text Model', outputModalities: ['TEXT'] }),
        fm({ modelId: 'embed.model', modelName: 'Embed Model', outputModalities: ['EMBEDDING'] }),
      ],
      [],
    );
    expect(out.map((m) => m.id)).toEqual(['text.model']);
  });

  it('dedupes an inference-profile id that collides with a foundation-model id (appears once)', () => {
    const out = mergeBedrockModels(
      [fm({ modelId: 'us.anthropic.claude', modelName: 'Claude' })],
      [ip({ inferenceProfileId: 'us.anthropic.claude', inferenceProfileName: 'Claude Profile' })],
    );
    const matches = out.filter((m) => m.id === 'us.anthropic.claude');
    expect(matches).toHaveLength(1);
    // Foundation wins the collision.
    expect(matches[0]!.label).toBe('Claude');
  });

  it('merges profiles that have no foundation-model equivalent and labels them', () => {
    const out = mergeBedrockModels(
      [],
      [ip({ inferenceProfileId: 'us.anthropic.sonnet', inferenceProfileName: 'Claude Sonnet' })],
    );
    expect(out).toEqual([{ id: 'us.anthropic.sonnet', label: 'Claude Sonnet (inference profile)' }]);
  });

  it('sorts the merged result by id', () => {
    const out = mergeBedrockModels(
      [fm({ modelId: 'zeta', modelName: 'Z' }), fm({ modelId: 'alpha', modelName: 'A' })],
      [ip({ inferenceProfileId: 'mid', inferenceProfileName: 'M' })],
    );
    expect(out.map((m) => m.id)).toEqual(['alpha', 'mid', 'zeta']);
  });

  it('falls back to the id when a foundation-model name is missing', () => {
    const out = mergeBedrockModels([fm({ modelId: 'no.name', modelName: undefined })], []);
    expect(out[0]).toEqual({ id: 'no.name', label: 'no.name' });
  });

  it('falls back to the id when an inference-profile name is missing', () => {
    const out = mergeBedrockModels([], [ip({ inferenceProfileId: 'p.noname', inferenceProfileName: undefined })]);
    expect(out[0]).toEqual({ id: 'p.noname', label: 'p.noname (inference profile)' });
  });
});

describe('toListClientAuth', () => {
  it('maps an api-key choice to bearer token config with bearer scheme preference', () => {
    const auth = toListClientAuth({ kind: 'api-key', apiKey: 'bedrock-api-key-abc' });
    expect(auth).toEqual({
      token: { token: 'bedrock-api-key-abc' },
      authSchemePreference: ['httpBearerAuth'],
    });
  });

  it('maps an explicit choice to a static sigv4 credentials provider', async () => {
    const auth = toListClientAuth({ kind: 'explicit', accessKeyId: 'AKIA', secretAccessKey: 's' });
    if (!('credentials' in auth)) throw new Error('expected sigv4 credentials');
    expect(await auth.credentials()).toEqual({ accessKeyId: 'AKIA', secretAccessKey: 's' });
  });
});

describe('toInvokeAuth', () => {
  it('maps sigv4 choices to a credentialProvider with no fetch override', async () => {
    const auth = toInvokeAuth({ kind: 'explicit', accessKeyId: 'AKIA', secretAccessKey: 's' });
    expect(auth.fetch).toBeUndefined();
    expect(await auth.credentialProvider!()).toEqual({ accessKeyId: 'AKIA', secretAccessKey: 's' });
  });

  it('maps an api-key choice to a fetch that swaps the signed header for the bearer token', async () => {
    const seen: { url?: string; auth?: string | null; body?: unknown } = {};
    const inner = async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.url = String(input);
      seen.auth = new Headers(init?.headers).get('authorization');
      seen.body = init?.body;
      return new Response('{}');
    };
    const auth = toInvokeAuth({ kind: 'api-key', apiKey: 'bedrock-api-key-abc' }, inner);

    // The provider's SigV4 signer runs before our fetch and needs SOME credentials to not throw.
    await expect(auth.credentialProvider!()).resolves.toBeDefined();

    // Simulate the signed request the sigv4Fetch wrapper hands to the inner fetch.
    await auth.fetch!('https://bedrock-runtime.us-east-1.amazonaws.com/model/m/converse', {
      method: 'POST',
      body: '{"messages":[]}',
      headers: { authorization: 'AWS4-HMAC-SHA256 Credential=discarded', 'content-type': 'application/json' },
    });
    expect(seen.auth).toBe('Bearer bedrock-api-key-abc');
    expect(seen.body).toBe('{"messages":[]}');
  });
});

describe('resolveBedrockRegion', () => {
  it('returns the explicit region unchanged (the client normalizes it, no AWS call)', async () => {
    expect(await resolveBedrockRegion({ aiProvider: 'amazon-bedrock', aiRegion: 'us-west-2' })).toBe('us-west-2');
  });
});

describe('listBedrockModels', () => {
  afterEach(() => {
    // spyOn restores are automatic per Bun's mock reset, but be explicit for clarity.
  });

  it('merges both AWS calls and follows inference-profile pagination', async () => {
    const send = spyOn(BedrockClient.prototype, 'send').mockImplementation((command: unknown): Promise<unknown> => {
      if (command instanceof ListFoundationModelsCommand) {
        return Promise.resolve({ modelSummaries: [fm({ modelId: 'fm.text', modelName: 'FM Text' })] });
      }
      if (command instanceof ListInferenceProfilesCommand) {
        const token = command.input.nextToken;
        if (!token) {
          return Promise.resolve({
            inferenceProfileSummaries: [ip({ inferenceProfileId: 'ip.one', inferenceProfileName: 'IP One' })],
            nextToken: 'page2',
          });
        }
        return Promise.resolve({
          inferenceProfileSummaries: [ip({ inferenceProfileId: 'ip.two', inferenceProfileName: 'IP Two' })],
        });
      }
      throw new Error('unexpected command');
    });

    try {
      const out = await listBedrockModels({ aiProvider: 'amazon-bedrock', aiRegion: 'us-east-1' });
      expect(out.models.map((m) => m.id)).toEqual(['fm.text', 'ip.one', 'ip.two']);
      // The resolved region rides along so the UI can prefill it after a successful list.
      expect(out.region).toBe('us-east-1');
    } finally {
      send.mockRestore();
    }
  });

  it('scopes the credential chain to a named profile when one is set (no explicit keys)', async () => {
    const send = spyOn(BedrockClient.prototype, 'send').mockImplementation((): Promise<unknown> => {
      return Promise.resolve({ modelSummaries: [], inferenceProfileSummaries: [] });
    });
    const chain = spyOn(credentialProviders, 'fromNodeProviderChain').mockReturnValue((async () => ({
      accessKeyId: 'x',
      secretAccessKey: 'y',
    })) as ReturnType<typeof credentialProviders.fromNodeProviderChain>);
    try {
      await listBedrockModels({ aiProvider: 'amazon-bedrock', aiRegion: 'us-east-1', aiProfile: 'my-sso' });
      expect(chain).toHaveBeenCalledWith({ profile: 'my-sso' });
    } finally {
      send.mockRestore();
      chain.mockRestore();
    }
  });

  it('resolves the region from the profile when aiRegion is blank (the SDK will not do this itself)', async () => {
    const send = spyOn(BedrockClient.prototype, 'send').mockImplementation((): Promise<unknown> => {
      return Promise.resolve({ modelSummaries: [], inferenceProfileSummaries: [] });
    });
    const chain = spyOn(credentialProviders, 'fromNodeProviderChain').mockReturnValue((async () => ({
      accessKeyId: 'x',
      secretAccessKey: 'y',
    })) as ReturnType<typeof credentialProviders.fromNodeProviderChain>);
    const profileRegion = spyOn(awsProfiles, 'resolveProfileRegion').mockResolvedValue('us-east-1');
    try {
      // No aiRegion — the profile mode UI has no region field, so this is the real-world shape.
      const out = await listBedrockModels({ aiProvider: 'amazon-bedrock', aiProfile: 'PlatformDev' });
      expect(profileRegion).toHaveBeenCalledWith('PlatformDev');
      // The profile's region flows into the client and back out for the UI to prefill.
      expect(out.region).toBe('us-east-1');
    } finally {
      send.mockRestore();
      chain.mockRestore();
      profileRegion.mockRestore();
    }
  });

  it('propagates AWS errors to the caller', async () => {
    const send = spyOn(BedrockClient.prototype, 'send').mockImplementation((): Promise<unknown> => {
      return Promise.reject(new Error('User is not authorized to perform: bedrock:ListFoundationModels'));
    });
    try {
      await expect(listBedrockModels({ aiProvider: 'amazon-bedrock', aiRegion: 'us-east-1' })).rejects.toThrow(
        /not authorized/,
      );
    } finally {
      send.mockRestore();
    }
  });
});
