import type { DiffFile, DiffHunk, DiffLine } from './types';

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
// Accept any git prefix, not just a/ b/ — `diff.mnemonicPrefix` emits c/ w/ i/ o/, and merge
// diffs use 1/ 2/. GitHub diffs are always a/ b/, but local `git diff` honors user config.
const FILE_HEADER_RE = /^diff --git [a-z12]\/(.+) [a-z12]\/(.+)$/;

export function parseDiff(raw: string): DiffFile[] {
  if (!raw || raw.trim().length === 0) {
    return [];
  }

  const lines = raw.split('\n');
  const fileChunks: string[][] = [];
  let current: string[] | null = null;

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      if (current) {
        fileChunks.push(current);
      }
      current = [line];
    } else if (current) {
      current.push(line);
    }
  }
  if (current) {
    fileChunks.push(current);
  }

  return fileChunks.map(parseFileChunk);
}

function parseFileChunk(chunk: string[]): DiffFile {
  const header = chunk[0] ?? '';
  const file = extractFilePath(header);

  let isNewFile = false;
  let isDeleted = false;
  const hunks: DiffHunk[] = [];

  let i = 1;
  while (i < chunk.length) {
    const line = chunk[i]!;
    if (line.startsWith('@@')) {
      break;
    }
    if (line.startsWith('new file mode')) {
      isNewFile = true;
    } else if (line.startsWith('deleted file mode')) {
      isDeleted = true;
    }
    i++;
  }

  while (i < chunk.length) {
    const line = chunk[i]!;
    if (!line.startsWith('@@')) {
      i++;
      continue;
    }
    const match = line.match(HUNK_HEADER_RE);
    if (!match) {
      i++;
      continue;
    }
    const oldStart = Number(match[1]);
    const oldCount = match[2] === undefined ? 1 : Number(match[2]);
    const newStart = Number(match[3]);
    const newCount = match[4] === undefined ? 1 : Number(match[4]);

    const hunkLines: DiffLine[] = [];
    let oldLine = oldStart;
    let newLine = newStart;
    i++;

    while (i < chunk.length) {
      const body = chunk[i]!;
      if (body.startsWith('@@') || body.startsWith('diff --git ')) {
        break;
      }
      if (body.startsWith('\\')) {
        i++;
        continue;
      }
      const prefix = body[0];
      const content = body.slice(1);
      if (prefix === '+') {
        hunkLines.push({
          type: 'add',
          content,
          lineNumber: { new: newLine },
        });
        newLine++;
      } else if (prefix === '-') {
        hunkLines.push({
          type: 'remove',
          content,
          lineNumber: { old: oldLine },
        });
        oldLine++;
      } else if (prefix === ' ') {
        hunkLines.push({
          type: 'context',
          content,
          lineNumber: { old: oldLine, new: newLine },
        });
        oldLine++;
        newLine++;
      } else if (body === '') {
        i++;
        continue;
      } else {
        break;
      }
      i++;
    }

    hunks.push({
      header: line,
      oldStart,
      oldCount,
      newStart,
      newCount,
      lines: hunkLines,
    });
  }

  return { file, isNewFile, isDeleted, hunks };
}

function extractFilePath(header: string): string {
  const match = header.match(FILE_HEADER_RE);
  if (match) {
    return match[2]!;
  }
  // Fallback for odd headers: the last `<x>/path` token is the new-side path.
  const parts = header.split(' ');
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i]!;
    if (/^[a-z12]\//.test(part)) {
      return part.slice(2);
    }
  }
  return '';
}
