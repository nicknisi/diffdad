import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveGitHubToken } from '../auth';

describe('resolveGitHubToken', () => {
  const originalEnv = process.env.DIFFDAD_GITHUB_TOKEN;

  beforeEach(() => {
    delete process.env.DIFFDAD_GITHUB_TOKEN;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.DIFFDAD_GITHUB_TOKEN;
    } else {
      process.env.DIFFDAD_GITHUB_TOKEN = originalEnv;
    }
  });

  it('returns env var when set', async () => {
    process.env.DIFFDAD_GITHUB_TOKEN = 'ghp_test_env_token';
    const token = await resolveGitHubToken({
      skipGhCli: true,
      skipConfig: true,
    });
    expect(token).toBe('ghp_test_env_token');
  });

  it('returns null when no source available', async () => {
    delete process.env.DIFFDAD_GITHUB_TOKEN;
    const token = await resolveGitHubToken({
      skipGhCli: true,
      skipConfig: true,
    });
    expect(token).toBeNull();
  });
});
