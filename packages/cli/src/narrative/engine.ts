import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";
import type { DiffDadConfig } from "../config";
import type { DiffFile, PRMetadata } from "../github/types";
import { buildNarrativePrompt } from "./prompt";
import type { NarrativeResponse } from "./types";

const DEFAULT_ANTHROPIC_MODEL = "claude-sonnet-4-6";
const DEFAULT_OPENAI_MODEL = "gpt-4o";
const DEFAULT_OLLAMA_MODEL = "llama3.1";
const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434/v1";

function hasConfiguredProvider(config: DiffDadConfig): boolean {
  return config.aiProvider !== undefined;
}

export function getModel(config: DiffDadConfig): LanguageModelV1 {
  const provider = config.aiProvider ?? "anthropic";

  switch (provider) {
    case "anthropic": {
      const anthropic = createAnthropic({ apiKey: config.aiApiKey });
      return anthropic(config.aiModel ?? DEFAULT_ANTHROPIC_MODEL);
    }
    case "openai": {
      const openai = createOpenAI({ apiKey: config.aiApiKey });
      return openai(config.aiModel ?? DEFAULT_OPENAI_MODEL);
    }
    case "ollama": {
      const ollama = createOpenAI({
        baseURL: config.aiBaseUrl ?? DEFAULT_OLLAMA_BASE_URL,
        apiKey: "ollama",
      });
      return ollama(config.aiModel ?? DEFAULT_OLLAMA_MODEL);
    }
    case "openai-compatible": {
      const compatible = createOpenAI({
        baseURL: config.aiBaseUrl,
        apiKey: config.aiApiKey ?? "openai-compatible",
      });
      return compatible(config.aiModel ?? DEFAULT_OPENAI_MODEL);
    }
    default: {
      const exhaustive: never = provider;
      throw new Error(`Unsupported aiProvider: ${exhaustive as string}`);
    }
  }
}

async function callClaudeCli(
  system: string,
  user: string,
): Promise<{ text: string; truncated: boolean }> {
  const args = ["claude", "-p", "--output-format", "text"];

  const prompt = `${system}\n\n---\n\n${user}`;
  const proc = Bun.spawn(args, {
    stdin: new Response(prompt),
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    const msg = stderr.trim() || `claude exited with code ${exitCode}`;
    if (msg.includes("not found") || msg.includes("No such file")) {
      throw new Error(
        "claude CLI not found. Install Claude Code or run `dad config` to set an API provider.",
      );
    }
    throw new Error(`claude CLI failed: ${msg}`);
  }

  return { text: stdout, truncated: false };
}

export async function callAi(
  config: DiffDadConfig,
  system: string,
  user: string,
  maxTokens?: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!hasConfiguredProvider(config)) {
    return callClaudeCli(system, user);
  }

  const model = getModel(config);
  const result = await generateText({
    model,
    system,
    messages: [{ role: "user", content: user }],
    maxTokens,
  });
  return {
    text: result.text,
    truncated: result.finishReason === "length",
  };
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }

  return trimmed;
}

export async function generateNarrative(
  pr: PRMetadata,
  files: DiffFile[],
  fileTree: string[],
  config: DiffDadConfig,
): Promise<NarrativeResponse> {
  const { system, user } = buildNarrativePrompt({
    title: pr.title,
    description: pr.body,
    labels: pr.labels,
    files,
    fileTree,
  });

  const MAX_RETRIES = 2;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const result = await callAi(config, system, user, 16384);

    const json = extractJson(result.text);
    try {
      return JSON.parse(json) as NarrativeResponse;
    } catch (err) {
      if (result.truncated && attempt < MAX_RETRIES) {
        console.log(`Narrative truncated (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying...`);
        continue;
      }
      throw new Error(
        `Failed to parse narrative JSON: ${(err as Error).message}${result.truncated ? " (response was truncated — PR may be too large for the model's output limit)" : ""}`,
      );
    }
  }
  throw new Error("Unreachable");
}
