/**
 * Small synchronous string hash for content-addressed identity keys (finding ids,
 * chapter content keys). Two FNV-1a passes with different offset bases give 16 hex
 * chars — deterministic across sessions, cheap enough for render paths, and
 * collision-safe enough for per-PR scopes. Not cryptographic; never used for security.
 */
export function hashKey(input: string): string {
  return `${fnv1a(input, 0x811c9dc5)}${fnv1a(input, 0x1000193)}`;
}

function fnv1a(input: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply, kept in uint32 via shifts to avoid float drift.
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
