import { normalizePath } from './paths';
import type { Callout, Concern, DiffFile } from '../state/types';

export type ConcernFinding = {
  kind: 'concern';
  concern: Concern;
  file: string;
  line: number;
  chapterIndex?: number;
};

export type CalloutFinding = {
  kind: 'callout';
  callout: Callout;
  file: string;
  line: number;
  chapterIndex: number;
};

export type Finding = ConcernFinding | CalloutFinding;

function findChapterForLine(
  chapterByHunk: Map<string, number>,
  files: DiffFile[],
  file: string,
  line: number,
): number | undefined {
  const norm = normalizePath(file);
  const diffFile = files.find((f) => normalizePath(f.file) === norm);
  if (!diffFile) return undefined;
  for (let i = 0; i < diffFile.hunks.length; i++) {
    const h = diffFile.hunks[i]!;
    const start = h.newStart;
    const end = start + Math.max(h.newCount - 1, 0);
    if (line >= start && line <= end) {
      return chapterByHunk.get(`${norm}:${i}`);
    }
  }
  return undefined;
}

export function aggregateFindings(
  concerns: Concern[],
  chapters: { callouts?: Callout[]; sections: { type: string; file?: string; hunkIndex?: number }[] }[],
  files: DiffFile[],
): Finding[] {
  const chapterByHunk = new Map<string, number>();
  chapters.forEach((ch, ci) => {
    for (const s of ch.sections) {
      if (s.type === 'diff' && s.file && s.hunkIndex !== undefined) {
        const key = `${normalizePath(s.file)}:${s.hunkIndex}`;
        if (!chapterByHunk.has(key)) chapterByHunk.set(key, ci);
      }
    }
  });

  const findings: Finding[] = [];

  for (const concern of concerns) {
    const chapterIndex = findChapterForLine(chapterByHunk, files, concern.file, concern.line);
    findings.push({ kind: 'concern', concern, file: concern.file, line: concern.line, chapterIndex });
  }

  chapters.forEach((ch, ci) => {
    if (!ch.callouts) return;
    for (const callout of ch.callouts) {
      findings.push({ kind: 'callout', callout, file: callout.file, line: callout.line, chapterIndex: ci });
    }
  });

  findings.sort((a, b) => {
    const ca = a.chapterIndex ?? Infinity;
    const cb = b.chapterIndex ?? Infinity;
    if (ca !== cb) return ca - cb;
    const fa = normalizePath(a.file);
    const fb = normalizePath(b.file);
    if (fa !== fb) return fa < fb ? -1 : 1;
    return a.line - b.line;
  });

  return findings;
}
