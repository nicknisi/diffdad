import { homedir } from "os";
import { join } from "path";
import { readFile, writeFile, mkdir } from "fs/promises";
import type { NarrativeResponse } from "./types";

const CACHE_DIR = join(homedir(), ".cache", "diffdad");

function cachePath(owner: string, repo: string, number: number, sha: string): string {
  return join(CACHE_DIR, `${owner}-${repo}-${number}-${sha}.json`);
}

export async function getCachedNarrative(
  owner: string,
  repo: string,
  number: number,
  sha: string,
): Promise<NarrativeResponse | null> {
  try {
    const path = cachePath(owner, repo, number, sha);
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as NarrativeResponse;
  } catch {
    return null;
  }
}

export async function cacheNarrative(
  owner: string,
  repo: string,
  number: number,
  sha: string,
  narrative: NarrativeResponse,
): Promise<void> {
  const path = cachePath(owner, repo, number, sha);
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(path, JSON.stringify(narrative));
}
