import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type AiProvider = 'anthropic' | 'openai' | 'openai-compatible' | 'ollama' | 'amazon-bedrock';

export type LocalCli = 'claude' | 'codex' | 'pi';
export const LOCAL_CLIS: readonly LocalCli[] = ['claude', 'codex', 'pi'] as const;

export const DEFAULT_CLI_MODELS: Readonly<Record<LocalCli, string>> = {
  claude: 'sonnet',
  codex: '',
  pi: '',
};

export type StoryStructure = 'chapters' | 'linear' | 'outline';
export type LayoutMode = 'toc' | 'linear';
export type DisplayDensity = 'comfortable' | 'compact';
export type NarrationDensity = 'terse' | 'normal' | 'verbose';
export type ThemePreference = 'light' | 'dark' | 'auto';
export type AccentId = 'classic' | 'paprika' | 'tomato' | 'forest' | 'plum' | 'sky' | 'dadcore';

/** Default GitHub review-request poll cadence (ms) when `pollIntervalMs` is unset. */
export const DEFAULT_POLL_INTERVAL_MS = 60_000;

export interface DiffDadConfig {
  githubToken?: string;
  aiProvider?: AiProvider;
  aiApiKey?: string;
  aiModel?: string;
  aiBaseUrl?: string;
  /** AWS region for the amazon-bedrock provider (blank → resolve from the ambient chain / AWS_REGION). */
  aiRegion?: string;
  /** AWS access key id for amazon-bedrock. NOT a secret (an identifier, like a username). Blank → ambient chain. */
  aiAccessKeyId?: string;
  /** AWS secret access key for amazon-bedrock. Secret. Blank → ambient chain. */
  aiSecretAccessKey?: string;
  /** Named AWS profile (from `~/.aws/config`) for amazon-bedrock. Used only when no explicit keys are set. */
  aiProfile?: string;
  /** Bedrock bearer API key for amazon-bedrock. Secret. Dedicated field (not `aiApiKey`) so another provider's lingering key can never flip the Bedrock auth mode. */
  aiBedrockApiKey?: string;
  defaultCli?: LocalCli;
  cliModels?: Partial<Record<LocalCli, string>>;
  storyStructure?: StoryStructure;
  layoutMode?: LayoutMode;
  displayDensity?: DisplayDensity;
  defaultNarrationDensity?: NarrationDensity;
  clusterBots?: boolean;
  theme?: ThemePreference;
  accent?: AccentId;
  /** Daemon GitHub poll cadence (ms). Promoted from the old `--poll=` flag; live-reconfigurable. */
  pollIntervalMs?: number;
}

export function getConfigPath(): string {
  // Honor XDG_CONFIG_HOME (defaults to ~/.config) — both the standard location and a clean seam for
  // tests to isolate config instead of reading the developer's real ~/.config/diffdad/config.json.
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg ? join(xdg, 'diffdad') : join(homedir(), '.config', 'diffdad');
  return join(base, 'config.json');
}

export async function readConfig(): Promise<DiffDadConfig> {
  const path = getConfigPath();
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return {};
  }
  try {
    const data = (await file.json()) as DiffDadConfig;
    return data ?? {};
  } catch {
    return {};
  }
}

export async function writeConfig(config: DiffDadConfig): Promise<void> {
  const path = getConfigPath();
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(config, null, 2) + '\n');
}
