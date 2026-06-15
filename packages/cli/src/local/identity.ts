import { basename } from 'path';
import { spawnText } from './git';

export type RepoIdentity = { owner: string; repo: string };

/** Parse owner/repo from a GitHub remote URL (ssh or https). */
export function parseRemoteUrl(url: string): RepoIdentity | null {
  const ssh = url.match(/^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/i);
  if (ssh?.[1] && ssh[2]) return { owner: ssh[1], repo: ssh[2] };
  const https = url.match(/^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i);
  if (https?.[1] && https[2]) return { owner: https[1], repo: https[2] };
  return null;
}

/**
 * Identity for cache/store keying in watch mode (never used for network calls). Derives
 * owner/repo from the `origin` remote; falls back to the working-directory name with a
 * "local" owner when there is no GitHub remote.
 */
export async function resolveLocalIdentity(cwd: string = process.cwd()): Promise<RepoIdentity> {
  const { code, stdout } = await spawnText(['git', 'remote', 'get-url', 'origin']);
  if (code === 0) {
    const parsed = parseRemoteUrl(stdout.trim());
    if (parsed) return parsed;
  }
  return { owner: 'local', repo: basename(cwd) || 'repo' };
}
