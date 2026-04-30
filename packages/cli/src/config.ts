import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { resolveGitHubToken } from "./auth";

export type AiProvider =
  | "anthropic"
  | "openai"
  | "openai-compatible"
  | "ollama";

export type StoryStructure = "chapters" | "linear" | "outline";
export type LayoutMode = "toc" | "linear";
export type DisplayDensity = "comfortable" | "compact";
export type NarrationDensity = "terse" | "normal" | "verbose";

export interface DiffDadConfig {
  githubToken?: string;
  aiProvider?: AiProvider;
  aiApiKey?: string;
  aiModel?: string;
  aiBaseUrl?: string;
  storyStructure?: StoryStructure;
  layoutMode?: LayoutMode;
  displayDensity?: DisplayDensity;
  defaultNarrationDensity?: NarrationDensity;
  clusterBots?: boolean;
}

export function getConfigPath(): string {
  return join(homedir(), ".config", "diffdad", "config.json");
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
  await Bun.write(path, JSON.stringify(config, null, 2) + "\n");
}

const PROVIDER_DEFAULTS: Record<
  "anthropic" | "openai" | "ollama",
  { model: string; baseUrl?: string; label: string }
> = {
  anthropic: { model: "claude-sonnet-4-6", label: "Anthropic (Claude)" },
  openai: { model: "gpt-4o", label: "OpenAI" },
  ollama: {
    model: "llama3.1",
    baseUrl: "http://localhost:11434/v1",
    label: "Ollama (local)",
  },
};

function makeAsker() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> =>
    new Promise(resolve => rl.question(q, (a: string) => resolve(a.trim())));
  const close = () => rl.close();
  return { ask, close };
}

export async function runConfig(): Promise<number> {
  const existing = await readConfig();
  const { ask, close } = makeAsker();

  try {
    process.stdout.write("\n  Diff Dad — configuration\n\n");

    // --- AI Provider ---
    process.stdout.write("  AI Provider\n");
    const currentProviderLabel = existing.aiProvider
      ? existing.aiProvider
      : "claude CLI (default — uses your Claude subscription)";
    process.stdout.write(`  Current: ${currentProviderLabel}\n\n`);
    process.stdout.write("  0. Claude CLI (default — uses your Claude subscription, no API key needed)\n");
    process.stdout.write("  1. Anthropic API (requires API key)\n");
    process.stdout.write("  2. OpenAI (requires API key)\n");
    process.stdout.write("  3. Ollama (local)\n\n");

    let provider: "anthropic" | "openai" | "ollama" | undefined;
    let useClaudeCli = !existing.aiProvider;
    while (true) {
      const defaultChoice = !existing.aiProvider
        ? "0"
        : existing.aiProvider === "openai"
          ? "2"
          : existing.aiProvider === "ollama"
            ? "3"
            : "1";
      const answer = await ask(`  Pick a provider [0-3] (${defaultChoice}): `);
      const choice = answer.length === 0 ? defaultChoice : answer;
      if (choice === "0") { useClaudeCli = true; break; }
      if (choice === "1") { provider = "anthropic"; useClaudeCli = false; break; }
      if (choice === "2") { provider = "openai"; useClaudeCli = false; break; }
      if (choice === "3") { provider = "ollama"; useClaudeCli = false; break; }
      process.stdout.write("  Please enter 0, 1, 2, or 3.\n");
    }

    let aiApiKey: string | undefined = existing.aiApiKey;
    let aiBaseUrl: string | undefined = existing.aiBaseUrl;
    let aiModel: string | undefined = existing.aiModel;

    if (useClaudeCli) {
      process.stdout.write("\n  Using Claude CLI — no API key needed.\n");
      aiApiKey = undefined;
      aiBaseUrl = undefined;
      aiModel = undefined;
    } else if (provider) {
      const defaults = PROVIDER_DEFAULTS[provider];
      process.stdout.write("\n");

      if (provider === "ollama") {
        const currentUrl = existing.aiBaseUrl ?? defaults.baseUrl ?? "";
        const answer = await ask(`  Ollama base URL [${currentUrl}]: `);
        aiBaseUrl = answer.length === 0 ? currentUrl : answer;
        aiApiKey = undefined;
      } else {
        const providerName = provider === "anthropic" ? "Anthropic" : "OpenAI";
        const hasExisting =
          provider === existing.aiProvider &&
          existing.aiApiKey &&
          existing.aiApiKey.length > 0;
        const suffix = hasExisting ? " (leave blank to keep existing)" : "";
        const answer = await ask(`  ${providerName} API key${suffix}: `);
        if (answer.length > 0) {
          aiApiKey = answer;
        } else if (!hasExisting) {
          process.stdout.write("  Warning: no API key set.\n");
        }
        aiBaseUrl = undefined;
      }

      const currentModel =
        provider === existing.aiProvider && existing.aiModel
          ? existing.aiModel
          : defaults.model;
      process.stdout.write("\n");
      const modelAnswer = await ask(
        `  Model (leave blank for default — ${currentModel}): `,
      );
      aiModel = modelAnswer.length === 0 ? currentModel : modelAnswer;
    }

    // --- GitHub Token ---
    process.stdout.write("\n  GitHub Token\n");

    // Check what's already available outside the config file
    const tokenFromEnvOrGh = await resolveGitHubToken({ skipConfig: true });
    let githubToken = existing.githubToken;

    if (tokenFromEnvOrGh) {
      const source = process.env.DIFFDAD_GITHUB_TOKEN
        ? "env DIFFDAD_GITHUB_TOKEN"
        : "gh CLI";
      process.stdout.write(`  Current: ✓ found via ${source}\n`);
    } else if (githubToken && githubToken.length > 0) {
      process.stdout.write("  Current: ✓ stored in config\n");
      const answer = await ask(
        "  Replace GitHub token? (leave blank to keep): ",
      );
      if (answer.length > 0) githubToken = answer;
    } else {
      process.stdout.write("  Current: (not set)\n\n");
      const answer = await ask("  GitHub personal access token: ");
      if (answer.length > 0) {
        githubToken = answer;
        process.stdout.write("  ✓ Saved\n");
      }
    }

    // --- Display Settings ---
    process.stdout.write("\n  Display Settings\n");

    const currentStoryStructure: StoryStructure =
      existing.storyStructure ?? "chapters";
    let storyStructure: StoryStructure = currentStoryStructure;
    while (true) {
      const answer = await ask(
        `  Story structure [chapters/linear/outline] (current: ${currentStoryStructure}): `,
      );
      if (answer.length === 0) break;
      if (answer === "chapters" || answer === "linear" || answer === "outline") {
        storyStructure = answer;
        break;
      }
      process.stdout.write("  Please enter chapters, linear, or outline.\n");
    }

    const currentLayoutMode: LayoutMode = existing.layoutMode ?? "toc";
    let layoutMode: LayoutMode = currentLayoutMode;
    while (true) {
      const answer = await ask(
        `  Layout [toc/linear] (current: ${currentLayoutMode}): `,
      );
      if (answer.length === 0) break;
      if (answer === "toc" || answer === "linear") {
        layoutMode = answer;
        break;
      }
      process.stdout.write("  Please enter toc or linear.\n");
    }

    const currentNarrationDensity: NarrationDensity =
      existing.defaultNarrationDensity ?? "normal";
    let defaultNarrationDensity: NarrationDensity = currentNarrationDensity;
    while (true) {
      const answer = await ask(
        `  Narration density [terse/normal/verbose] (current: ${currentNarrationDensity}): `,
      );
      if (answer.length === 0) break;
      if (answer === "terse" || answer === "normal" || answer === "verbose") {
        defaultNarrationDensity = answer;
        break;
      }
      process.stdout.write("  Please enter terse, normal, or verbose.\n");
    }

    // --- Persist ---
    const next: DiffDadConfig = {
      ...existing,
      aiProvider: useClaudeCli ? undefined : provider,
      aiModel,
      storyStructure,
      layoutMode,
      defaultNarrationDensity,
    };
    if (useClaudeCli) {
      delete next.aiProvider;
      delete next.aiApiKey;
      delete next.aiBaseUrl;
      delete next.aiModel;
    } else {
      if (aiApiKey !== undefined) next.aiApiKey = aiApiKey;
      else delete next.aiApiKey;
      if (aiBaseUrl !== undefined) next.aiBaseUrl = aiBaseUrl;
      else delete next.aiBaseUrl;
    }
    if (githubToken && githubToken.length > 0) next.githubToken = githubToken;

    await writeConfig(next);
    process.stdout.write(`\n  ✓ Config saved to ${getConfigPath()}\n\n`);
    return 0;
  } finally {
    close();
  }
}
