import { readdir, readFile } from 'fs/promises';
import { homedir } from 'os';
import { basename, join } from 'path';
import type { TracePrompt, TraceSessionSummary } from '@diffdad/contracts';
import { normalizeSession } from './normalize';

/** Collapse every run of whitespace to a single space and trim the ends. Pure; exported for tests. */
export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Prove that `text` is a verbatim quote from `transcript`, comparing after collapsing whitespace runs to
 * single spaces on both sides. An exact (whitespace-collapsed) substring verifies; a display-capped
 * prefix of the full transcript verifies AND reports `truncated: true`. Anything else — corrupted or
 * empty — fails, and a failed prompt is never quoted. Pure; exported for tests.
 */
export function verifyPromptText(text: string, transcript: string): { verified: boolean; truncated?: boolean } {
  const needle = collapseWhitespace(text);
  const haystack = collapseWhitespace(transcript);
  if (!needle || !haystack) return { verified: false };
  if (needle === haystack) return { verified: true };
  // A truncated display is a proper prefix of the full transcript.
  if (haystack.startsWith(needle)) return { verified: true, truncated: true };
  if (haystack.includes(needle)) return { verified: true };
  return { verified: false };
}

export type FindMatchingSessionsOptions = {
  /** Repo-name hints; a session whose cwd basename matches one scores the cwd rung. */
  repoDirHints: string[];
  /** PR head branch. A session whose gitBranch equals it scores the top rung. */
  branch?: string;
  /** Diff file paths. A session touching >=2 of them via tool events scores the file rung. */
  changedFiles: string[];
  /** Start of the PR commit window; sessions active at/after it score the recency rung. */
  since?: Date;
  /** Defaults to ~/.claude/projects. Injectable for tests. */
  logRoot?: string;
};

const MAX_PROMPT_CHARS = 2000;
const MAX_PROMPTS = 20;
const TOP_N = 3;

// Scoring ladder weights, highest signal first.
const SCORE_BRANCH = 4;
const SCORE_CWD = 2;
const SCORE_FILES = 2;
const SCORE_RECENCY = 1;

type SessionMeta = {
  sessionId: string;
  startedAt: string;
  endedAt: string;
  branch?: string;
  cwd?: string;
};

function parseMeta(jsonlText: string): SessionMeta {
  let sessionId = '';
  let branch: string | undefined;
  let cwd: string | undefined;
  let minTs = Infinity;
  let maxTs = -Infinity;
  for (const line of jsonlText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: Record<string, unknown>;
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== 'object') continue;
      entry = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    if (!sessionId && typeof entry.sessionId === 'string') sessionId = entry.sessionId;
    if (!branch && typeof entry.gitBranch === 'string' && entry.gitBranch.length > 0) branch = entry.gitBranch;
    if (!cwd && typeof entry.cwd === 'string' && entry.cwd.length > 0) cwd = entry.cwd;
    if (typeof entry.timestamp === 'string') {
      const t = Date.parse(entry.timestamp);
      if (Number.isFinite(t)) {
        if (t < minTs) minTs = t;
        if (t > maxTs) maxTs = t;
      }
    }
  }
  const startedAt = Number.isFinite(minTs) ? new Date(minTs).toISOString() : '';
  const endedAt = Number.isFinite(maxTs) ? new Date(maxTs).toISOString() : '';
  return { sessionId, startedAt, endedAt, branch, cwd };
}

function isNoise(text: string): boolean {
  if (text.startsWith('/')) return true; // slash command
  if (/^<(command-|local-command-)/.test(text)) return true; // slash-command scaffolding
  if (text.includes('<tool_use_error>')) return true;
  return false;
}

function extractPrompts(jsonlText: string): TracePrompt[] {
  const out: TracePrompt[] = [];
  for (const ev of normalizeSession(jsonlText)) {
    if (ev.kind !== 'user') continue;
    const full = ev.text.trim();
    if (!full || isNoise(full)) continue;
    const display = full.length > MAX_PROMPT_CHARS ? full.slice(0, MAX_PROMPT_CHARS) : full;
    // Verify the shown text against the full message it was sliced from, so a display-cap truncation
    // surfaces as `truncated` and any mangling surfaces as `verified: false`.
    const { verified, truncated } = verifyPromptText(display, full);
    out.push({ text: display, verified, ...(truncated ? { truncated: true } : {}) });
    if (out.length >= MAX_PROMPTS) break;
  }
  return out;
}

/** Count distinct changed files a session touched via tool events (basename or path-suffix match). */
function countFileMatches(jsonlText: string, changedFiles: string[]): number {
  const toolPaths = new Set<string>();
  for (const ev of normalizeSession(jsonlText)) {
    if (ev.kind === 'tool' && ev.filePath) toolPaths.add(ev.filePath);
  }
  if (toolPaths.size === 0) return 0;
  const toolBases = new Set([...toolPaths].map((p) => basename(p)));
  let matched = 0;
  for (const changed of changedFiles) {
    const base = basename(changed);
    const hit = toolBases.has(base) || [...toolPaths].some((p) => p.endsWith(changed) || changed.endsWith(p));
    if (hit) matched++;
  }
  return matched;
}

async function listJsonlFiles(logRoot: string): Promise<string[]> {
  let rootEntries;
  try {
    rootEntries = await readdir(logRoot, { withFileTypes: true });
  } catch {
    return []; // missing root => no feature
  }
  const files: string[] = [];
  for (const entry of rootEntries) {
    if (entry.isDirectory()) {
      const dir = join(logRoot, entry.name);
      try {
        for (const sub of await readdir(dir)) {
          if (sub.endsWith('.jsonl')) files.push(join(dir, sub));
        }
      } catch {
        // unreadable project dir: skip
      }
    } else if (entry.name.endsWith('.jsonl')) {
      files.push(join(logRoot, entry.name));
    }
  }
  return files;
}

export async function findMatchingSessions(opts: FindMatchingSessionsOptions): Promise<TraceSessionSummary[]> {
  const logRoot = opts.logRoot ?? join(homedir(), '.claude', 'projects');
  const hints = opts.repoDirHints.map((h) => h.toLowerCase()).filter((h) => h.length > 0);
  const files = await listJsonlFiles(logRoot);

  const candidates: TraceSessionSummary[] = [];
  for (const file of files) {
    let text: string;
    try {
      text = await readFile(file, 'utf-8');
    } catch {
      continue;
    }
    const meta = parseMeta(text);

    let score = 0;
    if (opts.branch && meta.branch && meta.branch === opts.branch) score += SCORE_BRANCH;
    if (meta.cwd && hints.includes(basename(meta.cwd).toLowerCase())) score += SCORE_CWD;
    if (countFileMatches(text, opts.changedFiles) >= 2) score += SCORE_FILES;
    // Recency is a tiebreaker, never an identity: without at least one identity rung (branch, cwd,
    // or file overlap), a session from an unrelated project would qualify purely by being recent —
    // and its private prompts would surface on the wrong PR.
    const hasIdentity = score > 0;
    if (opts.since && meta.endedAt && Date.parse(meta.endedAt) >= opts.since.getTime()) score += SCORE_RECENCY;

    if (!hasIdentity) continue;

    candidates.push({
      sessionId: meta.sessionId || basename(file, '.jsonl'),
      path: file,
      startedAt: meta.startedAt,
      endedAt: meta.endedAt,
      branch: meta.branch,
      cwd: meta.cwd,
      score,
      userPrompts: extractPrompts(text),
    });
  }

  candidates.sort((a, b) => b.score - a.score || b.endedAt.localeCompare(a.endedAt));
  return candidates.slice(0, TOP_N);
}
