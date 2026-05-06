import type { DiffFile } from '../github/types';
import type { NarrativeResponse } from './types';

export type ValidationViolation =
  | { kind: 'duplicate-primary'; file: string; hunkIndex: number; chapters: number[] }
  | { kind: 'orphan-hunk'; file: string; hunkIndex: number }
  | { kind: 'invalid-hunk-index'; file: string; hunkIndex: number; chapter: number }
  | { kind: 'unknown-file'; file: string; chapter: number }
  | { kind: 'reshow-unresolved'; chapter: number; ref: number; file?: string }
  | { kind: 'reshow-forward-ref'; chapter: number; ref: number; file: string };

export type ValidationResult = {
  ok: boolean;
  violations: ValidationViolation[];
};

function normalizePath(p: string): string {
  return p
    .trim()
    .replace(/^[ab]\//, '')
    .replace(/^\/+/, '');
}

/**
 * Validate a NarrativeResponse against the underlying diff. Pure; safe to call
 * after parse and after cache load. Phase 1 callers should treat all
 * violations as warnings — the planner pass (Phase 3) will be the one that
 * enforces them.
 */
export function validateNarrative(narrative: NarrativeResponse, files: DiffFile[]): ValidationResult {
  const violations: ValidationViolation[] = [];

  const fileMap = new Map<string, DiffFile>();
  for (const f of files) fileMap.set(normalizePath(f.file), f);

  // (file:hunkIndex) -> chapter indices that reference it as a primary diff section
  const primaryRefs = new Map<string, number[]>();
  // Any (file:hunkIndex) referenced by either a primary diff section or a reshow entry
  const referenced = new Set<string>();

  narrative.chapters.forEach((ch, ci) => {
    for (const s of ch.sections) {
      if (s.type !== 'diff') continue;
      const norm = normalizePath(s.file);
      const file = fileMap.get(norm);
      if (!file) {
        violations.push({ kind: 'unknown-file', file: s.file, chapter: ci });
        continue;
      }
      if (s.hunkIndex < 0 || s.hunkIndex >= file.hunks.length) {
        violations.push({
          kind: 'invalid-hunk-index',
          file: s.file,
          hunkIndex: s.hunkIndex,
          chapter: ci,
        });
        continue;
      }
      const key = `${norm}:${s.hunkIndex}`;
      const arr = primaryRefs.get(key);
      if (arr) arr.push(ci);
      else primaryRefs.set(key, [ci]);
      referenced.add(key);
    }

    for (const entry of ch.reshow ?? []) {
      // Resolve the file. If `entry.file` is absent, fall back to any earlier
      // primary ref whose hunkIndex matches — same fallback the frontend uses.
      let resolvedNorm: string | undefined;
      if (entry.file) {
        resolvedNorm = normalizePath(entry.file);
      } else {
        for (const [key, owners] of primaryRefs) {
          const sep = key.lastIndexOf(':');
          const keyFile = key.slice(0, sep);
          const keyIdx = Number(key.slice(sep + 1));
          if (keyIdx === entry.ref && owners.some((c) => c < ci)) {
            resolvedNorm = keyFile;
            break;
          }
        }
      }

      if (!resolvedNorm || !fileMap.has(resolvedNorm)) {
        violations.push({ kind: 'reshow-unresolved', chapter: ci, ref: entry.ref, file: entry.file });
        continue;
      }

      const file = fileMap.get(resolvedNorm)!;
      if (entry.ref < 0 || entry.ref >= file.hunks.length) {
        violations.push({ kind: 'reshow-unresolved', chapter: ci, ref: entry.ref, file: entry.file });
        continue;
      }

      const key = `${resolvedNorm}:${entry.ref}`;
      const owners = primaryRefs.get(key);
      if (!owners || !owners.some((c) => c < ci)) {
        violations.push({ kind: 'reshow-forward-ref', chapter: ci, ref: entry.ref, file: resolvedNorm });
      }
      referenced.add(key);
    }
  });

  for (const [key, chapters] of primaryRefs) {
    if (chapters.length > 1) {
      const sep = key.lastIndexOf(':');
      violations.push({
        kind: 'duplicate-primary',
        file: key.slice(0, sep),
        hunkIndex: Number(key.slice(sep + 1)),
        chapters,
      });
    }
  }

  for (const f of files) {
    const norm = normalizePath(f.file);
    f.hunks.forEach((_, idx) => {
      const key = `${norm}:${idx}`;
      if (!referenced.has(key)) {
        violations.push({ kind: 'orphan-hunk', file: f.file, hunkIndex: idx });
      }
    });
  }

  return { ok: violations.length === 0, violations };
}

/** One-line human-readable summary of a violation, for warning logs. */
export function formatViolation(v: ValidationViolation): string {
  switch (v.kind) {
    case 'duplicate-primary':
      return `duplicate primary: ${v.file}#${v.hunkIndex} appears in chapters ${v.chapters.join(', ')}`;
    case 'orphan-hunk':
      return `orphan hunk: ${v.file}#${v.hunkIndex} not referenced by any chapter`;
    case 'invalid-hunk-index':
      return `invalid hunkIndex: ${v.file}#${v.hunkIndex} (chapter ${v.chapter})`;
    case 'unknown-file':
      return `unknown file: ${v.file} (chapter ${v.chapter})`;
    case 'reshow-unresolved':
      return `reshow unresolved: ref=${v.ref}${v.file ? ` file=${v.file}` : ''} (chapter ${v.chapter})`;
    case 'reshow-forward-ref':
      return `reshow forward-ref: ${v.file}#${v.ref} not owned by an earlier chapter (chapter ${v.chapter})`;
  }
}
