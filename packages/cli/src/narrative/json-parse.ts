/**
 * Pull a JSON object out of an LLM response. Tolerates fenced code blocks and
 * leading/trailing prose.
 */
export function extractJson(text: string): string {
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

/**
 * Best-effort partial JSON parser. Walks the prefix and emits a JSON object
 * with whatever values have closed cleanly. Used to render incremental
 * narrative updates while the LLM is still streaming.
 *
 * Strategy: try fast-path parsing the prefix as-is, with two fallbacks if it
 * fails:
 *   1. Close any open string + add closing braces/brackets for the open stack.
 *      Works when we're mid-value (e.g. inside a string).
 *   2. Truncate to the last "safe cut" — the position just before a comma or
 *      after a close brace/bracket — then re-close the stack. Works when we're
 *      mid-key (e.g. `...,"tld` with no colon yet).
 * Returns the parsed object from the first strategy that succeeds, or null.
 */
export function tryParsePartialJson(text: string): unknown | null {
  const startIdx = text.indexOf('{');
  if (startIdx === -1) return null;
  const body = text.slice(startIdx);

  try {
    return JSON.parse(body);
  } catch {
    // fallthrough
  }

  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  /** Position (exclusive end) where we could safely truncate the body. */
  let lastSafeCut = -1;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') {
      stack.pop();
      // Right after a close, safe to cut here (exclusive end).
      lastSafeCut = i + 1;
    } else if (ch === ',') {
      // Right before a comma, safe to cut. We want the body up to but not
      // including the comma so the closing brace/bracket comes right after the
      // last complete pair.
      lastSafeCut = i;
    }
  }

  // Strategy 1: close open string, then close the open stack.
  let candidate1 = body;
  if (inString) candidate1 += '"';
  const stack1 = [...stack];
  while (stack1.length > 0) candidate1 += stack1.pop();
  try {
    return JSON.parse(candidate1);
  } catch {
    // fallthrough
  }

  // Strategy 2: truncate to last safe cut, recompute the open stack at that
  // position, then close.
  if (lastSafeCut > 0) {
    const stack2: string[] = [];
    let inStr2 = false;
    let esc2 = false;
    for (let i = 0; i < lastSafeCut; i++) {
      const ch = body[i]!;
      if (esc2) {
        esc2 = false;
        continue;
      }
      if (inStr2) {
        if (ch === '\\') esc2 = true;
        else if (ch === '"') inStr2 = false;
        continue;
      }
      if (ch === '"') inStr2 = true;
      else if (ch === '{') stack2.push('}');
      else if (ch === '[') stack2.push(']');
      else if (ch === '}' || ch === ']') stack2.pop();
    }
    let candidate2 = body.slice(0, lastSafeCut);
    while (stack2.length > 0) candidate2 += stack2.pop();
    try {
      return JSON.parse(candidate2);
    } catch {
      return null;
    }
  }

  return null;
}
