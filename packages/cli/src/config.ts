import { mkdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { resolveGitHubToken } from './auth';

export type AiProvider = 'anthropic' | 'openai' | 'openai-compatible' | 'ollama';

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

export interface DiffDadConfig {
  githubToken?: string;
  aiProvider?: AiProvider;
  aiApiKey?: string;
  aiModel?: string;
  aiBaseUrl?: string;
  defaultCli?: LocalCli;
  cliModels?: Partial<Record<LocalCli, string>>;
  storyStructure?: StoryStructure;
  layoutMode?: LayoutMode;
  displayDensity?: DisplayDensity;
  defaultNarrationDensity?: NarrationDensity;
  clusterBots?: boolean;
  theme?: ThemePreference;
  accent?: AccentId;
}

export function getConfigPath(): string {
  return join(homedir(), '.config', 'diffdad', 'config.json');
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

const PROVIDER_DEFAULTS: Record<'anthropic' | 'openai' | 'ollama', { model: string; baseUrl?: string; label: string }> =
  {
    anthropic: { model: 'claude-sonnet-4-6', label: 'Anthropic (Claude)' },
    openai: { model: 'gpt-4o', label: 'OpenAI' },
    ollama: {
      model: 'llama3.1',
      baseUrl: 'http://localhost:11434/v1',
      label: 'Ollama (local)',
    },
  };

function makeAsker() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, (a: string) => resolve(a.trim())));
  const close = () => rl.close();
  return { ask, close };
}

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  purple: '\x1b[38;5;99m',
  green: '\x1b[38;5;78m',
  red: '\x1b[38;5;204m',
  yellow: '\x1b[38;5;221m',
  cyan: '\x1b[38;5;117m',
  gray: '\x1b[38;5;243m',
  white: '\x1b[97m',
};

function heading(text: string) {
  process.stdout.write(`\n  ${c.purple}${c.bold}${text}${c.reset}\n`);
  process.stdout.write(`  ${c.gray}${'─'.repeat(text.length + 2)}${c.reset}\n`);
}

function current(label: string) {
  process.stdout.write(`  ${c.dim}current:${c.reset} ${c.cyan}${label}${c.reset}\n\n`);
}

function option(num: string, label: string, desc: string) {
  process.stdout.write(`  ${c.white}${num}.${c.reset} ${label} ${c.dim}${desc}${c.reset}\n`);
}

async function pickOne<T extends string>(
  ask: (q: string) => Promise<string>,
  label: string,
  options: { value: T; display: string }[],
  currentValue: T,
): Promise<T> {
  const currentDisplay = options.find((o) => o.value === currentValue)?.display ?? currentValue;
  const valid = options.map((o) => o.value).join('/');
  const prompt = `  ${c.dim}${label} [${valid}]${c.reset} ${c.gray}(${currentDisplay})${c.reset}: `;
  while (true) {
    const answer = await ask(prompt);
    if (answer.length === 0) return currentValue;
    const match = options.find((o) => o.value === answer);
    if (match) return match.value;
    process.stdout.write(`  ${c.red}enter ${valid}${c.reset}\n`);
  }
}

export async function runConfig(): Promise<number> {
  const existing = await readConfig();
  const { ask, close } = makeAsker();

  try {
    process.stdout.write(`\n  ${c.purple}${c.bold}Diff Dad${c.reset} ${c.dim}— configuration${c.reset}\n`);

    // --- AI Provider ---
    heading('AI Provider');
    const currentProviderLabel = existing.aiProvider ?? 'local CLI (no API key)';
    current(currentProviderLabel);
    option('0', `${c.green}Local CLI${c.reset}`, '— auto-detects claude, codex, or pi (no API key)');
    option('1', 'Anthropic API', '— requires ANTHROPIC_API_KEY');
    option('2', 'OpenAI', '— requires OPENAI_API_KEY');
    option('3', 'Ollama', '— local models via ollama');
    process.stdout.write('\n');

    let provider: 'anthropic' | 'openai' | 'ollama' | undefined;
    let useClaudeCli = !existing.aiProvider;
    while (true) {
      const defaultChoice = !existing.aiProvider
        ? '0'
        : existing.aiProvider === 'openai'
          ? '2'
          : existing.aiProvider === 'ollama'
            ? '3'
            : '1';
      const answer = await ask(`  ${c.white}pick [0-3]${c.reset} ${c.gray}(${defaultChoice})${c.reset}: `);
      const choice = answer.length === 0 ? defaultChoice : answer;
      if (choice === '0') {
        useClaudeCli = true;
        break;
      }
      if (choice === '1') {
        provider = 'anthropic';
        useClaudeCli = false;
        break;
      }
      if (choice === '2') {
        provider = 'openai';
        useClaudeCli = false;
        break;
      }
      if (choice === '3') {
        provider = 'ollama';
        useClaudeCli = false;
        break;
      }
      process.stdout.write(`  ${c.red}enter 0-3${c.reset}\n`);
    }

    let aiApiKey: string | undefined = existing.aiApiKey;
    let aiBaseUrl: string | undefined = existing.aiBaseUrl;
    let aiModel: string | undefined = existing.aiModel;
    let defaultCli: LocalCli | undefined = existing.defaultCli;
    let cliModels: Partial<Record<LocalCli, string>> | undefined = existing.cliModels;

    if (useClaudeCli) {
      process.stdout.write(`\n  ${c.green}✓${c.reset} Using local CLI\n`);
      aiApiKey = undefined;
      aiBaseUrl = undefined;
      aiModel = undefined;

      defaultCli = await pickOne(
        ask,
        'preferred CLI',
        [
          { value: 'claude' as LocalCli, display: 'claude' },
          { value: 'codex' as LocalCli, display: 'codex' },
          { value: 'pi' as LocalCli, display: 'pi' },
        ],
        existing.defaultCli ?? 'claude',
      );

      const updatedModels: Partial<Record<LocalCli, string>> = { ...existing.cliModels };
      for (const cli of LOCAL_CLIS) {
        const fallback = DEFAULT_CLI_MODELS[cli];
        const currentModel = existing.cliModels?.[cli] ?? fallback;
        const display = currentModel.length > 0 ? currentModel : `${cli} default`;
        const answer = await ask(`  ${c.dim}${cli} model${c.reset} ${c.gray}(${display})${c.reset}: `);
        if (answer.length === 0) {
          if (currentModel.length > 0) updatedModels[cli] = currentModel;
          else delete updatedModels[cli];
        } else if (answer === '-' || answer.toLowerCase() === 'default') {
          delete updatedModels[cli];
        } else {
          updatedModels[cli] = answer;
        }
      }
      cliModels = Object.keys(updatedModels).length > 0 ? updatedModels : undefined;
    } else if (provider) {
      const defaults = PROVIDER_DEFAULTS[provider];
      process.stdout.write('\n');

      if (provider === 'ollama') {
        const currentUrl = existing.aiBaseUrl ?? defaults.baseUrl ?? '';
        const answer = await ask(`  ${c.dim}base URL${c.reset} ${c.gray}(${currentUrl})${c.reset}: `);
        aiBaseUrl = answer.length === 0 ? currentUrl : answer;
        aiApiKey = undefined;
      } else {
        const providerName = provider === 'anthropic' ? 'Anthropic' : 'OpenAI';
        const hasExisting = provider === existing.aiProvider && existing.aiApiKey && existing.aiApiKey.length > 0;
        const suffix = hasExisting ? ` ${c.gray}(enter to keep existing)${c.reset}` : '';
        const answer = await ask(`  ${c.dim}${providerName} API key${c.reset}${suffix}: `);
        if (answer.length > 0) {
          aiApiKey = answer;
        } else if (!hasExisting) {
          process.stdout.write(`  ${c.yellow}no API key set${c.reset}\n`);
        }
        aiBaseUrl = undefined;
      }

      const currentModel = provider === existing.aiProvider && existing.aiModel ? existing.aiModel : defaults.model;
      const modelAnswer = await ask(`  ${c.dim}model${c.reset} ${c.gray}(${currentModel})${c.reset}: `);
      aiModel = modelAnswer.length === 0 ? currentModel : modelAnswer;
    }

    // --- GitHub Token ---
    heading('GitHub');
    const tokenFromEnvOrGh = await resolveGitHubToken({ skipConfig: true });
    let githubToken = existing.githubToken;

    if (tokenFromEnvOrGh) {
      const source = process.env.DIFFDAD_GITHUB_TOKEN ? 'DIFFDAD_GITHUB_TOKEN env' : 'gh CLI';
      process.stdout.write(`  ${c.green}✓${c.reset} token found via ${c.cyan}${source}${c.reset}\n`);
    } else if (githubToken && githubToken.length > 0) {
      process.stdout.write(`  ${c.green}✓${c.reset} token stored in config\n`);
      const answer = await ask(`  ${c.dim}replace?${c.reset} ${c.gray}(enter to keep)${c.reset}: `);
      if (answer.length > 0) githubToken = answer;
    } else {
      process.stdout.write(
        `  ${c.yellow}no token found${c.reset} ${c.dim}— set DIFFDAD_GITHUB_TOKEN, run${c.reset} ${c.cyan}gh auth login${c.reset}${c.dim}, or enter one:${c.reset}\n`,
      );
      const answer = await ask(`  ${c.dim}personal access token${c.reset}: `);
      if (answer.length > 0) {
        githubToken = answer;
        process.stdout.write(`  ${c.green}✓${c.reset} saved\n`);
      }
    }

    // --- Display Settings ---
    heading('Display');

    const theme = await pickOne(
      ask,
      'theme',
      [
        { value: 'auto' as ThemePreference, display: 'auto' },
        { value: 'light' as ThemePreference, display: 'light' },
        { value: 'dark' as ThemePreference, display: 'dark' },
      ],
      existing.theme ?? 'auto',
    );

    const accent = await pickOne(
      ask,
      'accent',
      [
        { value: 'classic' as AccentId, display: 'classic (purple)' },
        { value: 'paprika' as AccentId, display: 'paprika (orange)' },
        { value: 'tomato' as AccentId, display: 'tomato (red-orange)' },
        { value: 'forest' as AccentId, display: 'forest (green)' },
        { value: 'plum' as AccentId, display: 'plum (purple)' },
        { value: 'sky' as AccentId, display: 'sky (blue)' },
        { value: 'dadcore' as AccentId, display: 'dadcore (warm paprika)' },
      ],
      existing.accent ?? 'classic',
    );

    const storyStructure = await pickOne(
      ask,
      'story structure',
      [
        { value: 'chapters' as StoryStructure, display: 'chapters' },
        { value: 'linear' as StoryStructure, display: 'linear' },
        { value: 'outline' as StoryStructure, display: 'outline' },
      ],
      existing.storyStructure ?? 'chapters',
    );

    const layoutMode = await pickOne(
      ask,
      'layout',
      [
        { value: 'toc' as LayoutMode, display: 'sidebar TOC' },
        { value: 'linear' as LayoutMode, display: 'linear' },
      ],
      existing.layoutMode ?? 'toc',
    );

    const defaultNarrationDensity = await pickOne(
      ask,
      'narration density',
      [
        { value: 'terse' as NarrationDensity, display: 'terse' },
        { value: 'normal' as NarrationDensity, display: 'normal' },
        { value: 'verbose' as NarrationDensity, display: 'verbose' },
      ],
      existing.defaultNarrationDensity ?? 'normal',
    );

    // --- Persist ---
    const next: DiffDadConfig = {
      ...existing,
      aiProvider: useClaudeCli ? undefined : provider,
      aiModel,
      theme,
      accent,
      storyStructure,
      layoutMode,
      defaultNarrationDensity,
    };
    if (useClaudeCli) {
      delete next.aiProvider;
      delete next.aiApiKey;
      delete next.aiBaseUrl;
      delete next.aiModel;
      if (defaultCli) next.defaultCli = defaultCli;
      else delete next.defaultCli;
      if (cliModels) next.cliModels = cliModels;
      else delete next.cliModels;
    } else {
      if (aiApiKey !== undefined) next.aiApiKey = aiApiKey;
      else delete next.aiApiKey;
      if (aiBaseUrl !== undefined) next.aiBaseUrl = aiBaseUrl;
      else delete next.aiBaseUrl;
    }
    if (githubToken && githubToken.length > 0) next.githubToken = githubToken;

    await writeConfig(next);
    process.stdout.write(`\n  ${c.green}✓${c.reset} saved to ${c.dim}${getConfigPath()}${c.reset}\n\n`);
    return 0;
  } finally {
    close();
  }
}

const SECRET_KEYS = new Set(['githubToken', 'aiApiKey']);

export function redactSecret(value: string): string {
  if (value.length === 0) return '<empty>';
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}…${value.slice(-4)} (${value.length} chars)`;
}

function formatValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return `${c.dim}<unset>${c.reset}`;
  if (SECRET_KEYS.has(key) && typeof value === 'string') {
    return `${c.yellow}${redactSecret(value)}${c.reset}`;
  }
  if (typeof value === 'string') return `${c.cyan}${value}${c.reset}`;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return `${c.cyan}${String(value)}${c.reset}`;
  }
  return `${c.cyan}${JSON.stringify(value)}${c.reset}`;
}

const SECTIONS: { title: string; keys: string[] }[] = [
  {
    title: 'AI Provider',
    keys: ['aiProvider', 'aiApiKey', 'aiBaseUrl', 'aiModel', 'defaultCli', 'cliModels'],
  },
  { title: 'GitHub', keys: ['githubToken'] },
  {
    title: 'Display',
    keys: [
      'theme',
      'accent',
      'storyStructure',
      'layoutMode',
      'displayDensity',
      'defaultNarrationDensity',
      'clusterBots',
    ],
  },
];

export async function showConfig(): Promise<number> {
  const path = getConfigPath();
  const file = Bun.file(path);
  const exists = await file.exists();

  process.stdout.write(`\n  ${c.purple}${c.bold}Diff Dad${c.reset} ${c.dim}— current config${c.reset}\n`);
  process.stdout.write(`  ${c.dim}path:${c.reset} ${exists ? c.cyan : c.gray}${path}${c.reset}`);
  if (!exists) {
    process.stdout.write(` ${c.gray}(not created yet — run ${c.cyan}dad config${c.gray})${c.reset}\n\n`);
    return 0;
  }
  process.stdout.write('\n');

  let raw: Record<string, unknown>;
  try {
    raw = (await file.json()) as Record<string, unknown>;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stdout.write(`\n  ${c.red}error reading config:${c.reset} ${msg}\n\n`);
    return 1;
  }

  const seen = new Set<string>();
  const longestLabel = SECTIONS.flatMap((s) => s.keys).reduce((m, k) => Math.max(m, k.length), 0);

  for (const section of SECTIONS) {
    heading(section.title);
    for (const key of section.keys) {
      seen.add(key);
      const value = raw[key];
      const label = key.padEnd(longestLabel);
      process.stdout.write(`  ${c.dim}${label}${c.reset}  ${formatValue(key, value)}\n`);
    }
  }

  const extraKeys = Object.keys(raw).filter((k) => !seen.has(k));
  if (extraKeys.length > 0) {
    heading('Other');
    const extraPad = extraKeys.reduce((m, k) => Math.max(m, k.length), 0);
    for (const key of extraKeys) {
      const label = key.padEnd(extraPad);
      process.stdout.write(`  ${c.dim}${label}${c.reset}  ${formatValue(key, raw[key])}\n`);
    }
  }

  process.stdout.write('\n');
  return 0;
}

export async function resetConfig(opts: { yes?: boolean } = {}): Promise<number> {
  const path = getConfigPath();
  const file = Bun.file(path);
  const exists = await file.exists();

  process.stdout.write(`\n  ${c.purple}${c.bold}Diff Dad${c.reset} ${c.dim}— reset config${c.reset}\n`);
  process.stdout.write(`  ${c.dim}path:${c.reset} ${c.cyan}${path}${c.reset}\n`);

  if (!exists) {
    process.stdout.write(`  ${c.dim}nothing to reset — config does not exist${c.reset}\n\n`);
    return 0;
  }

  if (!opts.yes) {
    const { ask, close } = makeAsker();
    try {
      process.stdout.write(`  ${c.yellow}this will delete your saved API keys, tokens, and preferences${c.reset}\n`);
      const answer = await ask(`  ${c.dim}type${c.reset} ${c.cyan}yes${c.reset} ${c.dim}to confirm:${c.reset} `);
      if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
        process.stdout.write(`  ${c.dim}cancelled${c.reset}\n\n`);
        return 0;
      }
    } finally {
      close();
    }
  }

  await rm(path, { force: true });
  process.stdout.write(`\n  ${c.green}✓${c.reset} config removed\n\n`);
  return 0;
}
