import type { DiffFile } from '../github/types';
import { computeHunkAnchor, enrichNarrativeAnchors, resolveAnchor } from './anchors';
import type { NarrativeResponse, NarrativeSection } from './types';

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
      if (s.type === 'callstack') {
        // A frame links into the diff only when it carries BOTH file and hunkIndex; validate those refs
        // the same way diff sections are validated, reported per frame via the shared violation kinds.
        for (const frame of s.frames) {
          if (frame.file === undefined || frame.hunkIndex === undefined) continue;
          const norm = normalizePath(frame.file);
          const file = fileMap.get(norm);
          if (!file) {
            violations.push({ kind: 'unknown-file', file: frame.file, chapter: ci });
            continue;
          }
          if (frame.hunkIndex < 0 || frame.hunkIndex >= file.hunks.length) {
            violations.push({ kind: 'invalid-hunk-index', file: frame.file, hunkIndex: frame.hunkIndex, chapter: ci });
          }
        }
        continue;
      }
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
    // Multiple sections in the SAME chapter legitimately re-window one hunk (the writer prompt says
    // to slice a big hunk with startLine/endLine), so only distinct chapters count as duplicates.
    const distinct = [...new Set(chapters)];
    if (distinct.length > 1) {
      const sep = key.lastIndexOf(':');
      violations.push({
        kind: 'duplicate-primary',
        file: key.slice(0, sep),
        hunkIndex: Number(key.slice(sep + 1)),
        chapters: distinct,
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

export type RepairResult = {
  narrative: NarrativeResponse;
  dropped: ValidationViolation[];
};

/**
 * Pure repair pass: strip any diff section or reshow entry that references a hunk the UI cannot
 * resolve (unknown file, out-of-range hunkIndex, or a reshow that points at a nonexistent hunk).
 * Prose (narrative sections, titles, summaries, callouts) is untouched — only broken code refs are
 * removed. The returned narrative is safe to ship: the UI will never receive a reference to a
 * hunk that does not exist. `dropped` lists exactly what was removed, for logging.
 *
 * Kept intentionally narrow: `orphan-hunk` (a real hunk nobody references) and `duplicate-primary`
 * / `reshow-forward-ref` (refs that DO resolve to a real hunk, just structurally suboptimal) are
 * NOT stripped — they don't point at anything nonexistent.
 */
export function repairNarrative(narrative: NarrativeResponse, files: DiffFile[]): RepairResult {
  const dropped: ValidationViolation[] = [];
  const fileMap = new Map<string, DiffFile>();
  for (const f of files) fileMap.set(normalizePath(f.file), f);

  // (file:hunkIndex) referenced as a primary diff section by an earlier chapter — mirrors the
  // frontend fallback used to resolve a reshow entry with no explicit `file`.
  const primaryRefs = new Map<string, number[]>();

  const chapters = narrative.chapters.map((ch, ci) => {
    const sections: NarrativeSection[] = [];
    for (const s of ch.sections) {
      if (s.type === 'callstack') {
        // Null out (never drop) a frame's dead file/hunkIndex pair: the frame's prose stays, only the
        // broken link is removed. Frames carry no anchor, so there is nothing to re-resolve — an
        // unresolvable pair is simply cleared.
        const frames = s.frames.map((frame) => {
          if (frame.file === undefined || frame.hunkIndex === undefined) return frame;
          const norm = normalizePath(frame.file);
          const file = fileMap.get(norm);
          const inRange = file ? frame.hunkIndex >= 0 && frame.hunkIndex < file.hunks.length : false;
          if (file && inRange) return frame;
          if (!file) dropped.push({ kind: 'unknown-file', file: frame.file, chapter: ci });
          else dropped.push({ kind: 'invalid-hunk-index', file: frame.file, hunkIndex: frame.hunkIndex, chapter: ci });
          return { ...frame, file: undefined, hunkIndex: undefined };
        });
        sections.push({ ...s, frames });
        continue;
      }
      if (s.type !== 'diff') {
        sections.push(s);
        continue;
      }
      const norm = normalizePath(s.file);
      const file = fileMap.get(norm);
      const inRange = file ? s.hunkIndex >= 0 && s.hunkIndex < file.hunks.length : false;
      const record = (keyNorm: string, idx: number) => {
        const key = `${keyNorm}:${idx}`;
        const arr = primaryRefs.get(key);
        if (arr) arr.push(ci);
        else primaryRefs.set(key, [ci]);
      };

      // When the section carries a content anchor it is the authoritative join key: re-resolve it
      // against the current diff so a shifted (or now-wrong) hunkIndex is fixed in place rather than
      // trusting a raw index the diff may have moved out from under. During generation sections have
      // no anchor yet (enrichment runs after repair), so this branch only bites on cache load, which
      // is exactly where indices have drifted.
      if (s.anchor) {
        const resolved = resolveAnchor(files, s.anchor);
        if (resolved) {
          const resolvedNorm = normalizePath(resolved.file);
          const resolvedFile = fileMap.get(resolvedNorm)!;
          const fixed: NarrativeSection = {
            ...s,
            file: resolved.file,
            hunkIndex: resolved.hunkIndex,
            anchor: computeHunkAnchor(resolvedFile, resolved.hunkIndex),
          };
          record(resolvedNorm, resolved.hunkIndex);
          sections.push(fixed);
          continue;
        }
        // Anchor couldn't place it. Keep a structurally-valid raw index (a real hunk, just not the one
        // the anchor described); drop only when the index points at nothing.
        if (file && inRange) {
          record(norm, s.hunkIndex);
          sections.push(s);
          continue;
        }
        if (!file) dropped.push({ kind: 'unknown-file', file: s.file, chapter: ci });
        else dropped.push({ kind: 'invalid-hunk-index', file: s.file, hunkIndex: s.hunkIndex, chapter: ci });
        continue;
      }

      // No anchor (fresh generation, or a narrative cached before anchors existed): raw index only.
      if (!file) {
        dropped.push({ kind: 'unknown-file', file: s.file, chapter: ci });
        continue;
      }
      if (!inRange) {
        dropped.push({ kind: 'invalid-hunk-index', file: s.file, hunkIndex: s.hunkIndex, chapter: ci });
        continue;
      }
      record(norm, s.hunkIndex);
      sections.push(s);
    }

    let reshow = ch.reshow;
    if (reshow && reshow.length > 0) {
      reshow = reshow.filter((entry) => {
        let resolvedNorm: string | undefined;
        if (entry.file) {
          resolvedNorm = normalizePath(entry.file);
        } else {
          for (const [key, owners] of primaryRefs) {
            const sep = key.lastIndexOf(':');
            if (Number(key.slice(sep + 1)) === entry.ref && owners.some((c) => c < ci)) {
              resolvedNorm = key.slice(0, sep);
              break;
            }
          }
        }
        const file = resolvedNorm ? fileMap.get(resolvedNorm) : undefined;
        if (!file || entry.ref < 0 || entry.ref >= file.hunks.length) {
          dropped.push({ kind: 'reshow-unresolved', chapter: ci, ref: entry.ref, file: entry.file });
          return false;
        }
        return true;
      });
      if (reshow.length === 0) reshow = undefined;
    }

    return { ...ch, sections, reshow };
  });

  return { narrative: { ...narrative, chapters }, dropped };
}

/**
 * Cache-load boundary: a narrative from cache meets a freshly-fetched diff whose hunk indices may have
 * shifted. Re-resolve stale refs via their anchors (fixing in place), drop only the truly unresolvable,
 * then refresh anchors so subsequent loads keep re-resolving. Safe on older cached narratives that
 * carry no anchors — those simply fall through to the existing drop behavior.
 */
export function reanchorNarrative(narrative: NarrativeResponse, files: DiffFile[]): NarrativeResponse {
  const { narrative: repaired } = repairNarrative(narrative, files);
  return enrichNarrativeAnchors(repaired, files);
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
