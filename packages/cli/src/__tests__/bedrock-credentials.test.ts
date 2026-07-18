import { describe, expect, it } from 'bun:test';
import { resolveBedrockCreds } from '../narrative/bedrock-credentials';

describe('resolveBedrockCreds', () => {
  it('picks explicit static keys when both id and secret are present', () => {
    const choice = resolveBedrockCreds({
      aiProvider: 'amazon-bedrock',
      aiAccessKeyId: 'AKIAEXAMPLE',
      aiSecretAccessKey: 'secret',
    });
    expect(choice).toEqual({
      kind: 'explicit',
      accessKeyId: 'AKIAEXAMPLE',
      secretAccessKey: 'secret',
    });
  });

  it('lets explicit keys win even when a profile is also configured', () => {
    const choice = resolveBedrockCreds({
      aiAccessKeyId: 'AKIAEXAMPLE',
      aiSecretAccessKey: 'secret',
      aiProfile: 'my-sso',
    });
    expect(choice.kind).toBe('explicit');
  });

  it('picks the named profile when no explicit keys are present', () => {
    const choice = resolveBedrockCreds({ aiProfile: 'my-sso', aiRegion: 'us-east-1' });
    expect(choice).toEqual({ kind: 'profile', profile: 'my-sso' });
  });

  it('ignores a lone access key id (no secret) and falls through to the profile', () => {
    const choice = resolveBedrockCreds({ aiAccessKeyId: 'AKIAEXAMPLE', aiProfile: 'my-sso' });
    expect(choice).toEqual({ kind: 'profile', profile: 'my-sso' });
  });

  it('falls back to the default chain when neither keys nor a profile are set', () => {
    const choice = resolveBedrockCreds({ aiProvider: 'amazon-bedrock', aiRegion: 'us-east-1' });
    expect(choice).toEqual({ kind: 'default' });
  });

  it('picks the bearer API key when one is set', () => {
    const choice = resolveBedrockCreds({ aiProvider: 'amazon-bedrock', aiBedrockApiKey: 'bedrock-api-key-abc' });
    expect(choice).toEqual({ kind: 'api-key', apiKey: 'bedrock-api-key-abc' });
  });

  it('lets the API key win over explicit keys and a profile', () => {
    const choice = resolveBedrockCreds({
      aiBedrockApiKey: 'bedrock-api-key-abc',
      aiAccessKeyId: 'AKIAEXAMPLE',
      aiSecretAccessKey: 'secret',
      aiProfile: 'my-sso',
    });
    expect(choice.kind).toBe('api-key');
  });
});
