/**
 * Minimal normalization of Claude Code JSONL session logs into the few event kinds the intent UI and
 * the matching ladder need. Strictly read-only and defensive: unparseable lines are skipped and every
 * field is treated as possibly absent, because the log format drifts across Claude Code versions.
 */

export type TraceEvent =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; markdown: string }
  | { kind: 'tool'; tool: string; title?: string; filePath?: string };

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** Pull the human-authored text out of a `type:'user'` message, or '' when the entry is tool noise. */
function userText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    // tool_result blocks are the agent feeding tool output back to itself, never a human prompt.
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
  }
  return parts.join('\n').trim();
}

function firstString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

/** Extract the assistant text and tool_use events from a `type:'assistant'` message. */
function assistantEvents(content: unknown): TraceEvent[] {
  if (typeof content === 'string') {
    const text = content.trim();
    return text ? [{ kind: 'assistant', markdown: text }] : [];
  }
  if (!Array.isArray(content)) return [];
  const out: TraceEvent[] = [];
  const textParts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    const b = block as Record<string, unknown>;
    if (b.type === 'text' && typeof b.text === 'string') {
      textParts.push(b.text);
    } else if (b.type === 'tool_use') {
      const input = (b.input ?? {}) as Record<string, unknown>;
      out.push({
        kind: 'tool',
        tool: asString(b.name) || 'tool',
        title: firstString(input, ['description', 'command', 'pattern', 'prompt']),
        filePath: firstString(input, ['file_path', 'path', 'notebook_path']),
      });
    }
  }
  const markdown = textParts.join('\n').trim();
  if (markdown) out.unshift({ kind: 'assistant', markdown });
  return out;
}

/**
 * Parse a JSONL session log body into {@link TraceEvent}s. One JSON object per line; malformed lines
 * and entries without a usable shape are silently dropped.
 */
export function normalizeSession(jsonlText: string): TraceEvent[] {
  const events: TraceEvent[] = [];
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
    const message = (entry.message ?? {}) as Record<string, unknown>;
    if (entry.type === 'user') {
      const text = userText(message.content).trim();
      if (text) events.push({ kind: 'user', text });
    } else if (entry.type === 'assistant') {
      events.push(...assistantEvents(message.content));
    }
  }
  return events;
}
