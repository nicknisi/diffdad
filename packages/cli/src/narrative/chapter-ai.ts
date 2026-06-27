import type { DiffFile } from '../github/types';
import type { NarrativeResponse } from './types';

/** A per-chapter AI request: "ask" a question about the chapter, or "renarrate" it through a lens. */
export type ChapterAiInput = {
  action?: string;
  chapterIndex?: number;
  question?: string;
  lens?: string;
};

export type ChapterAiPrompt = { ok: true; systemPrompt: string; userPrompt: string } | { ok: false; error: string };

/**
 * Build the prompts for a per-chapter "ask Dad" / "re-narrate" request from a narrative + its diff.
 * Pure (no I/O) so PR mode (`server.ts`) and the daemon's unit-scoped `/api/units/:id/ai` share one
 * definition. Callers guard `!narrative` (→ 503) before calling; every other failure is a 400 here.
 */
export function buildChapterAiPrompt(
  narrative: NarrativeResponse,
  files: DiffFile[],
  input: ChapterAiInput,
): ChapterAiPrompt {
  const { action, chapterIndex, question, lens } = input;
  if (typeof chapterIndex !== 'number') return { ok: false, error: 'missing chapterIndex' };
  const chapter = narrative.chapters[chapterIndex];
  if (!chapter) return { ok: false, error: 'invalid chapter' };

  // hunkIndex is per-file (index into DiffFile.hunks), not a flat index across all files.
  const filesByPath = new Map(files.map((f) => [f.file, f]));
  const chapterDiff = chapter.sections
    .filter((s): s is Extract<typeof s, { type: 'diff' }> => s.type === 'diff')
    .map((s) => {
      const diffFile = filesByPath.get(s.file);
      if (!diffFile) return '';
      const hunk = diffFile.hunks[s.hunkIndex];
      if (!hunk) return '';
      return (
        `--- ${diffFile.file} ---\n` +
        hunk.lines.map((l) => (l.type === 'add' ? '+' : l.type === 'remove' ? '-' : ' ') + l.content).join('\n')
      );
    })
    .join('\n\n');

  if (action === 'ask') {
    if (!question || typeof question !== 'string') return { ok: false, error: 'missing question' };
    return {
      ok: true,
      systemPrompt: 'You are a code review assistant. Answer questions about the code changes concisely. Use markdown.',
      userPrompt: `Chapter: ${chapter.title}\n\nNarration: ${chapter.summary}\n\nDiff:\n${chapterDiff}\n\nQuestion: ${question}`,
    };
  }

  if (action === 'renarrate') {
    if (!lens || typeof lens !== 'string') return { ok: false, error: 'missing lens' };
    const densityLenses = ['terse', 'normal', 'verbose'];
    const systemPrompt = densityLenses.includes(lens)
      ? `You are a code review narrator. Rewrite this chapter narration in a ${lens} style. ${
          lens === 'terse'
            ? 'One sentence max.'
            : lens === 'verbose'
              ? 'One detailed paragraph.'
              : 'Two to three sentences.'
        } Use markdown.`
      : `You are a code review narrator. Re-narrate through a ${lens} lens. Focus on what matters from that perspective. 2-3 sentences, markdown.`;
    return {
      ok: true,
      systemPrompt,
      userPrompt: `Chapter: ${chapter.title}\n\nOriginal: ${chapter.summary}\n\nDiff:\n${chapterDiff}`,
    };
  }

  return { ok: false, error: 'unknown action' };
}
