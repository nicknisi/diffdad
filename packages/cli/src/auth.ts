import { readConfig } from './config';

export interface ResolveGitHubTokenOptions {
  skipGhCli?: boolean;
  skipConfig?: boolean;
}

/** Which source a resolved GitHub token came from (or null when none was found). */
export type GitHubTokenSource = 'env' | 'gh' | 'config' | null;

/**
 * Resolve the GitHub token AND report where it came from (env → gh CLI → config file, in priority
 * order). The settings surface needs the source so it can show "authenticated via gh" instead of
 * falsely claiming "no token" whenever the config file itself holds no token.
 */
export async function resolveGitHubTokenWithSource(
  opts: ResolveGitHubTokenOptions = {},
): Promise<{ token: string | null; source: GitHubTokenSource }> {
  // Priority 1: env var
  const envToken = process.env.DIFFDAD_GITHUB_TOKEN;
  if (envToken && envToken.trim().length > 0) {
    return { token: envToken.trim(), source: 'env' };
  }

  // Priority 2: gh auth token
  if (!opts.skipGhCli) {
    const ghToken = await tryGhAuthToken();
    if (ghToken) {
      return { token: ghToken, source: 'gh' };
    }
  }

  // Priority 3: config file
  if (!opts.skipConfig) {
    try {
      const config = await readConfig();
      if (config.githubToken && config.githubToken.trim().length > 0) {
        return { token: config.githubToken.trim(), source: 'config' };
      }
    } catch {
      // ignore
    }
  }

  return { token: null, source: null };
}

export async function resolveGitHubToken(opts: ResolveGitHubTokenOptions = {}): Promise<string | null> {
  return (await resolveGitHubTokenWithSource(opts)).token;
}

async function tryGhAuthToken(): Promise<string | null> {
  try {
    const proc = Bun.spawn(['gh', 'auth', 'token'], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      return null;
    }
    const out = await new Response(proc.stdout).text();
    const trimmed = out.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}
