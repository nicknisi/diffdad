const INJECTION_TAGS: readonly string[] = [
  'system',
  'user',
  'assistant',
  'mr_body',
  'mr_details',
  'instructions',
] as const;

const TAG_REGEX = new RegExp(`</?(?:${INJECTION_TAGS.join('|')})\\b[^>]*>`, 'gi');

const INJECTION_PHRASES: readonly RegExp[] = [
  /ignore all previous instructions/gi,
  /ignore previous instructions/gi,
  /disregard the above/gi,
  /^you are\b/gim,
  /^system:/gim,
];

function hasInjectionPattern(text: string): boolean {
  if (TAG_REGEX.test(text)) {
    TAG_REGEX.lastIndex = 0;
    return true;
  }
  return INJECTION_PHRASES.some((re) => {
    const hit = re.test(text);
    re.lastIndex = 0;
    return hit;
  });
}

/** Strips known prompt-injection XML tags and phrases from user-controlled text.
 * Phase 1: allow-list approach — novel tags (e.g. `<diffdad_admin>`) pass through. */
export function sanitizeUserContent(text: unknown): string {
  if (typeof text !== 'string' || text.length === 0) return '';
  if (!hasInjectionPattern(text)) return text;

  let result = text.replace(TAG_REGEX, ' ');
  for (const re of INJECTION_PHRASES) {
    result = result.replace(re, ' ');
  }
  result = result.replace(/[^\S\n]+/g, ' ').replace(/\n{3,}/g, '\n\n');
  return result.trim();
}
