import { loadSharedConfigFiles } from '@smithy/shared-ini-file-loader';

export interface AwsProfile {
  name: string;
  region?: string;
}

type IniSection = Record<string, string | undefined>;
type IniData = Record<string, IniSection>;

// loadSharedConfigFiles folds non-profile `[sso-session x]` / `[services x]` blocks into configFile
// under a `<type>.` prefix. Those are not selectable profiles, so drop them.
const NON_PROFILE_PREFIXES = ['sso-session.', 'services.'];

/**
 * Merge the profile names from `~/.aws/config` and `~/.aws/credentials` into one deduped, sorted list.
 * Region is read from the config file only (AWS resolves region there, not from the credentials file),
 * so a credentials-only profile surfaces with no region. Non-profile sections are filtered out.
 */
export function mergeAwsProfiles(configFile: IniData, credentialsFile: IniData): AwsProfile[] {
  const byName = new Map<string, AwsProfile>();
  const add = (name: string, region?: string) => {
    if (NON_PROFILE_PREFIXES.some((prefix) => name.startsWith(prefix))) return;
    const existing = byName.get(name);
    if (existing) {
      if (region && !existing.region) existing.region = region;
    } else {
      byName.set(name, region ? { name, region } : { name });
    }
  };
  for (const [name, section] of Object.entries(configFile)) add(name, section?.region);
  for (const name of Object.keys(credentialsFile)) add(name);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Enumerate the AWS profiles available on this machine. Never throws — an unreadable / missing
 * `~/.aws` yields an empty list, which the UI treats as "no profiles."
 */
export async function listAwsProfiles(): Promise<AwsProfile[]> {
  try {
    const { configFile, credentialsFile } = await loadSharedConfigFiles();
    return mergeAwsProfiles(configFile, credentialsFile);
  } catch {
    return [];
  }
}

/**
 * Read the region declared on a single profile in `~/.aws/config`. The AWS SDK scopes credentials to
 * a profile but resolves region independently (from env / the default profile), so it never picks up
 * the selected profile's `region =` — callers pass it explicitly. Never throws; returns undefined when
 * the profile is missing, has no region, or `~/.aws` is unreadable.
 */
export async function resolveProfileRegion(profile: string): Promise<string | undefined> {
  try {
    const { configFile } = await loadSharedConfigFiles();
    return configFile[profile]?.region;
  } catch {
    return undefined;
  }
}
