import type { DiffFile } from '../state/types';

export type FileTreeNode =
  | { kind: 'dir'; name: string; path: string; children: FileTreeNode[] }
  | { kind: 'file'; name: string; path: string; file: DiffFile };

export function fileStats(file: DiffFile): { adds: number; removes: number } {
  let adds = 0;
  let removes = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'add') adds++;
      else if (line.type === 'remove') removes++;
    }
  }
  return { adds, removes };
}

type DirDraft = { dirs: Map<string, DirDraft>; files: { name: string; file: DiffFile }[] };

/**
 * Nest a flat diff-file list into a directory tree for the Files-tab sidebar. Directories sort
 * before files, both alphabetically; single-child directory chains compress into one node
 * ("src/components" instead of "src" > "components") so deep repos don't waste indentation.
 */
export function buildFileTree(files: DiffFile[]): FileTreeNode[] {
  const root: DirDraft = { dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.file.split('/').filter(Boolean);
    let cur = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i]!;
      let next = cur.dirs.get(p);
      if (!next) {
        next = { dirs: new Map(), files: [] };
        cur.dirs.set(p, next);
      }
      cur = next;
    }
    cur.files.push({ name: parts[parts.length - 1] ?? f.file, file: f });
  }

  function emit(draft: DirDraft, prefix: string): FileTreeNode[] {
    const dirs: FileTreeNode[] = [...draft.dirs.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, child]) => {
        let label = name;
        let path = prefix ? `${prefix}/${name}` : name;
        let node = child;
        while (node.files.length === 0 && node.dirs.size === 1) {
          const [childName, grand] = [...node.dirs.entries()][0]!;
          label = `${label}/${childName}`;
          path = `${path}/${childName}`;
          node = grand;
        }
        return { kind: 'dir' as const, name: label, path, children: emit(node, path) };
      });
    const leaves: FileTreeNode[] = draft.files
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ name, file }) => ({ kind: 'file' as const, name, path: file.file, file }));
    return [...dirs, ...leaves];
  }
  return emit(root, '');
}
