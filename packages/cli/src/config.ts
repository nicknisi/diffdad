import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type AiProvider = "anthropic" | "openai" | "openai-compatible";

export interface DiffDadConfig {
  githubToken?: string;
  aiProvider?: AiProvider;
  aiApiKey?: string;
  aiModel?: string;
  aiBaseUrl?: string;
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
