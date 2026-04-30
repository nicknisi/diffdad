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

function resolveModel(config: DiffDadConfig): LanguageModelV1 {
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

  const model = resolveModel(config);

  const result = await generateText({
    model,
    system,
    messages: [{ role: "user", content: user }],
  });

  const json = extractJson(result.text);
  try {
    return JSON.parse(json) as NarrativeResponse;
  } catch (err) {
    throw new Error(
      `Failed to parse narrative JSON from model output: ${(err as Error).message}`,
    );
  }
}
