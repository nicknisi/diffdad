import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { resolveGitHubToken } from './auth';

export type AiProvider = 'anthropic' | 'openai' | 'openai-compatible' | 'ollama';
export type CliPreference = 'claude' | 'codex' | 'pi';

export type StoryStructure = 'chapters' | 'linear' | 'outline';
export type LayoutMode = 'toc' | 'linear';
export type DisplayDensity = 'comfortable' | 'compact';
export type NarrationDensity = 'terse' | 'normal' | 'verbose';
export type ThemePreference = 'light' | 'dark' | 'auto';
export type AccentId = 'classic' | 'paprika' | 'tomato' | 'forest' | 'plum' | 'sky' | 'dadcore';

export interface DiffDadConfig {
  githubToken?: string;
  aiProvider?: AiProvider;
  cliPreference?: CliPreference;
  aiApiKey?: string;
  aiModel?: string;
  aiBaseUrl?: string;
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
    let cliPreference: CliPreference | undefined = existing.cliPreference;

    if (useClaudeCli) {
      process.stdout.write(`\n  ${c.green}✓${c.reset} Using local CLI ${c.dim}(claude → codex → pi)${c.reset}\n`);

      // Ask which CLI to prefer
      option('0', `${c.dim}auto${c.reset}`, '— claude → codex → pi (default)');
      option('1', `${c.green}claude${c.reset}`, '— Claude Code CLI');
      option('2', 'codex', '— OpenAI Codex CLI');
      option('3', 'pi', '— pi CLI');
      process.stdout.write('\n');
      const cliOptions: { value: CliPreference; label: string }[] = [
        { value: 'claude', label: 'claude' },
        { value: 'codex', label: 'codex' },
        { value: 'pi', label: 'pi' },
      ];
      const defaultCliChoice =
        existing.cliPreference === 'codex' ? '2' : existing.cliPreference === 'pi' ? '3' : existing.cliPreference === 'claude' ? '1' : '0';
      while (true) {
        const answer = await ask(`  ${c.white}preferred CLI [0-3]${c.reset} ${c.gray}(${defaultCliChoice})${c.reset}: `);
        const choice = answer.length === 0 ? defaultCliChoice : answer;
        if (choice === '0') { cliPreference = undefined; break; }
        if (choice === '1') { cliPreference = 'claude'; break; }
        if (choice === '2') { cliPreference = 'codex'; break; }
        if (choice === '3') { cliPreference = 'pi'; break; }
        process.stdout.write(`  ${c.red}enter 0-3${c.reset}\n`);
      }
      if (cliPreference) {
        process.stdout.write(`  ${c.green}✓${c.reset} CLI preference set to ${c.cyan}${cliPreference}${c.reset}\n`);
      }

      aiApiKey = undefined;
      aiBaseUrl = undefined;
      aiModel = undefined;
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
      if (cliPreference) next.cliPreference = cliPreference;
      else delete next.cliPreference;
    } else {
      if (aiApiKey !== undefined) next.aiApiKey = aiApiKey;
      else delete next.aiApiKey;
      if (aiBaseUrl !== undefined) next.aiBaseUrl = aiBaseUrl;
      else delete next.aiBaseUrl;
      // Switching to an API provider clears any CLI preference
      delete next.cliPreference;
    }
    if (githubToken && githubToken.length > 0) next.githubToken = githubToken;

    await writeConfig(next);
    process.stdout.write(`\n  ${c.green}✓${c.reset} saved to ${c.dim}${getConfigPath()}${c.reset}\n\n`);
    return 0;
  } finally {
    close();
  }
}
