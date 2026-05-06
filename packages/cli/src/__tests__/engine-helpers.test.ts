import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getModel, inferProviderFromEnv, resolveAiPath, setCliOverride } from '../narrative/engine';
import type { DiffDadConfig } from '../config';

describe('inferProviderFromEnv', () => {
  let originalAnthropic: string | undefined;
  let originalOpenAI: string | undefined;

  beforeEach(() => {
    originalAnthropic = process.env.ANTHROPIC_API_KEY;
    originalOpenAI = process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (originalAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalAnthropic;
    if (originalOpenAI === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAI;
  });

  it('returns null when no env keys are present', () => {
    expect(inferProviderFromEnv()).toBeNull();
  });

  it('prefers ANTHROPIC_API_KEY when both are present', () => {
    process.env.ANTHROPIC_API_KEY = 'ant-key';
    process.env.OPENAI_API_KEY = 'oai-key';
    expect(inferProviderFromEnv()).toEqual({ aiProvider: 'anthropic', aiApiKey: 'ant-key' });
  });

  it('falls back to OpenAI when only OPENAI_API_KEY is set', () => {
    process.env.OPENAI_API_KEY = 'oai-key';
    expect(inferProviderFromEnv()).toEqual({ aiProvider: 'openai', aiApiKey: 'oai-key' });
  });
});

describe('resolveAiPath', () => {
  let originalAnthropic: string | undefined;
  let originalOpenAI: string | undefined;
  let originalDiffdadCli: string | undefined;

  beforeEach(() => {
    originalAnthropic = process.env.ANTHROPIC_API_KEY;
    originalOpenAI = process.env.OPENAI_API_KEY;
    originalDiffdadCli = process.env.DIFFDAD_CLI;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.DIFFDAD_CLI;
    setCliOverride(undefined as unknown as string);
  });

  afterEach(() => {
    if (originalAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalAnthropic;
    if (originalOpenAI === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAI;
    if (originalDiffdadCli === undefined) delete process.env.DIFFDAD_CLI;
    else process.env.DIFFDAD_CLI = originalDiffdadCli;
    setCliOverride(undefined as unknown as string);
  });

  it('uses local-cli when no provider is configured and no env key is set', () => {
    const out = resolveAiPath({});
    expect(out.path).toBe('local-cli');
    expect(out.effectiveConfig).toEqual({});
  });

  it('uses api when an aiProvider is explicitly configured', () => {
    const config: DiffDadConfig = { aiProvider: 'openai', aiApiKey: 'k' };
    const out = resolveAiPath(config);
    expect(out.path).toBe('api');
    expect(out.effectiveConfig.aiProvider).toBe('openai');
  });

  it('promotes to api and merges inferred env config when no provider is configured', () => {
    process.env.ANTHROPIC_API_KEY = 'ant-key';
    const out = resolveAiPath({ theme: 'dark' });
    expect(out.path).toBe('api');
    expect(out.effectiveConfig.aiProvider).toBe('anthropic');
    expect(out.effectiveConfig.aiApiKey).toBe('ant-key');
    expect(out.effectiveConfig.theme).toBe('dark');
  });

  it('forces local-cli when --with override is set, even if a provider is configured', () => {
    setCliOverride('claude');
    const out = resolveAiPath({ aiProvider: 'anthropic', aiApiKey: 'k' });
    expect(out.path).toBe('local-cli');
  });

  it('forces local-cli when DIFFDAD_CLI env is set, even if ANTHROPIC_API_KEY is present', () => {
    process.env.DIFFDAD_CLI = 'claude';
    process.env.ANTHROPIC_API_KEY = 'ant-key';
    const out = resolveAiPath({});
    expect(out.path).toBe('local-cli');
  });

  it('respects configured defaultCli over env-inferred API key', () => {
    process.env.ANTHROPIC_API_KEY = 'ant-key';
    const out = resolveAiPath({ defaultCli: 'claude' });
    expect(out.path).toBe('local-cli');
  });

  it('still uses configured aiProvider when defaultCli is also somehow set', () => {
    // aiProvider is set explicitly — that wins over defaultCli.
    const out = resolveAiPath({ aiProvider: 'anthropic', aiApiKey: 'k', defaultCli: 'claude' });
    expect(out.path).toBe('api');
  });
});

describe('getModel', () => {
  it('throws on an unknown provider', () => {
    const badConfig = { aiProvider: 'mystery' } as unknown as DiffDadConfig;
    expect(() => getModel(badConfig)).toThrow(/Unsupported aiProvider/);
  });

  it('returns a LanguageModelV1-shaped object for anthropic without throwing', () => {
    const m = getModel({ aiProvider: 'anthropic', aiApiKey: 'k' });
    // We don't want to call the model; just verify it constructed.
    expect(m).toBeTruthy();
    expect(typeof (m as unknown as { modelId?: unknown }).modelId).not.toBe('undefined');
  });

  it('returns a model for openai', () => {
    const m = getModel({ aiProvider: 'openai', aiApiKey: 'k', aiModel: 'gpt-4o' });
    expect(m).toBeTruthy();
  });

  it('returns a model for ollama with a custom base URL', () => {
    const m = getModel({ aiProvider: 'ollama', aiBaseUrl: 'http://localhost:11434/v1' });
    expect(m).toBeTruthy();
  });

  it('returns a model for openai-compatible', () => {
    const m = getModel({ aiProvider: 'openai-compatible', aiBaseUrl: 'https://example.com/v1' });
    expect(m).toBeTruthy();
  });
});
