import type { DiffDadConfig } from '../config';
import { callAi } from '../narrative/engine';
import { buildRecapPrompt } from './prompt';
import type { RecapSources } from './sources';
import { normalizeRecap, type RecapResponse } from './types';

const RECAP_MAX_TOKENS = 8192;

export type RecapGenerationResult = {
  recap: RecapResponse;
  provider: string;
};

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

export type RecapGenerationOptions = {
  onProgress?: (info: { delta: string; chars: number }) => void;
};

export async function generateRecap(
  sources: RecapSources,
  config: DiffDadConfig,
  options: RecapGenerationOptions = {},
): Promise<RecapGenerationResult> {
  const { system, user } = buildRecapPrompt(sources);

  const MAX_RETRIES = 1;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let chars = 0;
    const onChunk = options.onProgress
      ? (delta: string) => {
          chars += delta.length;
          options.onProgress?.({ delta, chars });
        }
      : undefined;

    const result = await callAi(config, system, user, RECAP_MAX_TOKENS, onChunk);

    try {
      const parsed = JSON.parse(extractJson(result.text));
      return { recap: normalizeRecap(parsed), provider: result.provider };
    } catch (err) {
      if (result.truncated && attempt < MAX_RETRIES) {
        console.log(`Recap truncated (attempt ${attempt + 1}/${MAX_RETRIES + 1}), retrying...`);
        continue;
      }
      throw new Error(
        `Failed to parse recap JSON: ${(err as Error).message}${result.truncated ? ' (response was truncated)' : ''}`,
      );
    }
  }
  throw new Error('Unreachable');
}
