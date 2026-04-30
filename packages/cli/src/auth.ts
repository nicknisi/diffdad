import { readConfig } from "./config";

export interface ResolveGitHubTokenOptions {
  skipGhCli?: boolean;
  skipConfig?: boolean;
}

export async function resolveGitHubToken(
  opts: ResolveGitHubTokenOptions = {},
): Promise<string | null> {
  // Priority 1: env var
  const envToken = process.env.DIFFDAD_GITHUB_TOKEN;
  if (envToken && envToken.trim().length > 0) {
    return envToken.trim();
  }

  // Priority 2: gh auth token
  if (!opts.skipGhCli) {
    const ghToken = await tryGhAuthToken();
    if (ghToken) {
      return ghToken;
    }
  }

  // Priority 3: config file
  if (!opts.skipConfig) {
    try {
      const config = await readConfig();
      if (config.githubToken && config.githubToken.trim().length > 0) {
        return config.githubToken.trim();
      }
    } catch {
      // ignore
    }
  }

  return null;
}

async function tryGhAuthToken(): Promise<string | null> {
  try {
    const proc = Bun.spawn(["gh", "auth", "token"], {
      stdout: "pipe",
      stderr: "pipe",
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
