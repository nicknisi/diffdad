import type { DiffFile } from '../github/types';
import { callAi } from '../narrative/engine';

type AiConfig = Parameters<typeof callAi>[0];

export type TriageSeverity = 'risk' | 'warn' | 'info';

export type TriageFlag = {
  file: string;
  line?: number;
  severity: TriageSeverity;
  kind: string;
  message: string;
};

const TRIAGE_MAX_TOKENS = 1400;

const TRIAGE_SYSTEM = `You are a fast triage pass for a developer watching an AI coding agent edit their working tree in real time. You are NOT writing a code review, a narrative, or a summary. Your only job is to point the developer's attention at the few spots most worth a human look right now.

Scan the diff and flag ONLY concrete instances of these agent-era failure modes:
- rewritten-tests: a test's assertion or expectation was edited to match new behavior (the agent may have "fixed" the test instead of the code). Surface these first.
- duplication: re-implements a helper/util/function that almost certainly already exists in the codebase.
- untrusted-input: user- or externally-controlled input flows into an LLM prompt, shell command, SQL, eval, or file path.
- weakened-ci: tests removed or skipped, lint/types disabled, coverage thresholds lowered, errors swallowed.
- sprawl: one change is large or unfocused enough that it is hard to verify confidently.

Rules:
- Flag only what is visible in the diff. Never speculate. If nothing qualifies, return an empty array.
- At most 8 flags. Fewer is better — only what genuinely deserves attention.
- "severity" is one of: "risk" (likely a real problem), "warn" (worth a look), "info" (minor).
- "file" MUST be one of the file paths shown in the diff. "line" is the new-side line number when you can cite one; omit it otherwise.
- "message" is one concise, specific sentence about THIS code — not a generic tip.

Return ONLY a JSON array of objects shaped { "file", "line"?, "severity", "kind", "message" }. No prose, no markdown fences.`;

/** Render DiffFile[] into a compact, line-numbered text the model can cite. Capped for cost/latency. */
function renderDiffForTriage(files: DiffFile[]): string {
  const parts: string[] = [];
  for (const f of files) {
    const tag = f.isNewFile ? ' (new file)' : f.isDeleted ? ' (deleted)' : '';
    parts.push(`### ${f.file}${tag}`);
    f.hunks.forEach((h, hi) => {
      parts.push(`@@ hunk ${hi} @@`);
      for (const l of h.lines) {
        const sign = l.type === 'add' ? '+' : l.type === 'remove' ? '-' : ' ';
        const ln = l.lineNumber.new ?? l.lineNumber.old;
        parts.push(`${sign}${ln != null ? ` ${ln}:` : ''} ${l.content}`);
      }
    });
    parts.push('');
  }
  // Triage must stay cheap and fast even on a huge diff — cap the prompt.
  return parts.join('\n').slice(0, 24000);
}

const SEVERITY_RANK: Record<TriageSeverity, number> = { risk: 0, warn: 1, info: 2 };

/** Resolve a model-supplied path to a real diff file, tolerating minor drift (basename/suffix). */
function resolveFile(candidate: string, files: DiffFile[]): string | null {
  if (files.some((f) => f.file === candidate)) return candidate;
  const bySuffix = files.find((f) => f.file.endsWith(candidate) || candidate.endsWith(f.file));
  return bySuffix ? bySuffix.file : null;
}

/**
 * Parse the model's reply (tolerating markdown fences / surrounding prose) into validated,
 * severity-sorted flags. Drops malformed items and hallucinated file paths. Exported for testing.
 */
export function parseTriageFlags(text: string, files: DiffFile[]): TriageFlag[] {
  let raw = text.trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) raw = fence[1].trim();
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];

  const flags: TriageFlag[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const rawFile = typeof o.file === 'string' ? o.file : '';
    const message = typeof o.message === 'string' ? o.message.trim() : '';
    if (!rawFile || !message) continue;
    const file = resolveFile(rawFile, files);
    if (!file) continue; // drop hallucinated paths
    const severity: TriageSeverity =
      o.severity === 'risk' || o.severity === 'warn' || o.severity === 'info' ? o.severity : 'warn';
    const kind = typeof o.kind === 'string' && o.kind ? o.kind : 'note';
    const line = typeof o.line === 'number' && Number.isFinite(o.line) ? o.line : undefined;
    flags.push({ file, line, severity, kind, message });
  }
  flags.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return flags.slice(0, 8);
}

/**
 * One cheap, non-blocking triage pass over the working-tree diff. Returns risk-sorted flags that
 * point attention at agent-era failure modes. Never throws for an empty diff. Callers run this OFF
 * the hot path — the diff renders without waiting for it.
 */
export async function runTriage(files: DiffFile[], config: AiConfig): Promise<TriageFlag[]> {
  if (files.length === 0) return [];
  const result = await callAi(config, TRIAGE_SYSTEM, renderDiffForTriage(files), TRIAGE_MAX_TOKENS);
  return parseTriageFlags(result.text, files);
}
