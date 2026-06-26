import type { TriageSeverity } from '../state/types';

/**
 * Canonical color tokens for the shared severity vocabulary (`risk` / `warn` / `info`),
 * used by watch-mode triage flags, the beat rail, and walkthrough resolve strips so the
 * three speak the same visual language. Tokens (not hex) so light/dark track automatically.
 */
export const SEVERITY: Record<TriageSeverity, { color: string; bg: string; label: string }> = {
  risk: { color: 'var(--red-11)', bg: 'var(--red-3)', label: 'risk' },
  warn: { color: 'var(--amber-11)', bg: 'var(--gray-3)', label: 'warn' },
  info: { color: 'var(--gray-11)', bg: 'var(--gray-3)', label: 'info' },
};
