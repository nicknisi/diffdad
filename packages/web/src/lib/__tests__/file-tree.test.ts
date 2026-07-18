import { describe, expect, it } from 'vitest';
import { buildFileTree, fileStats, type FileTreeNode } from '../file-tree';
import type { DiffFile } from '../../state/types';

function mkFile(path: string, adds = 1, removes = 0): DiffFile {
  const lines = [
    ...Array.from({ length: adds }, (_, i) => ({ type: 'add' as const, content: `a${i}`, lineNumber: { new: i + 1 } })),
    ...Array.from({ length: removes }, (_, i) => ({
      type: 'remove' as const,
      content: `r${i}`,
      lineNumber: { old: i + 1 },
    })),
  ];
  return {
    file: path,
    isNewFile: false,
    isDeleted: false,
    hunks: [{ header: '@@', oldStart: 1, oldCount: removes, newStart: 1, newCount: adds, lines }],
  };
}

function names(nodes: FileTreeNode[]): string[] {
  return nodes.map((n) => (n.kind === 'dir' ? `${n.name}/` : n.name));
}

describe('buildFileTree', () => {
  it('nests files under directories, dirs first then files, both alphabetical', () => {
    const tree = buildFileTree([
      mkFile('zz.md'),
      mkFile('src/b.ts'),
      mkFile('src/a.ts'),
      mkFile('README.md'),
      mkFile('lib/util.ts'),
    ]);
    expect(names(tree)).toEqual(['lib/', 'src/', 'README.md', 'zz.md']);
    const src = tree[1] as FileTreeNode & { kind: 'dir' };
    expect(names(src.children)).toEqual(['a.ts', 'b.ts']);
  });

  it('compresses single-child directory chains into one node', () => {
    const tree = buildFileTree([mkFile('src/components/deep/One.tsx'), mkFile('src/components/deep/Two.tsx')]);
    expect(tree).toHaveLength(1);
    const dir = tree[0] as FileTreeNode & { kind: 'dir' };
    expect(dir.name).toBe('src/components/deep');
    expect(dir.path).toBe('src/components/deep');
    expect(names(dir.children)).toEqual(['One.tsx', 'Two.tsx']);
  });

  it('stops compressing where a directory branches or holds files', () => {
    const tree = buildFileTree([mkFile('src/a/x.ts'), mkFile('src/b/y.ts'), mkFile('src/index.ts')]);
    expect(tree).toHaveLength(1);
    const src = tree[0] as FileTreeNode & { kind: 'dir' };
    expect(src.name).toBe('src');
    expect(names(src.children)).toEqual(['a/', 'b/', 'index.ts']);
  });

  it('keeps leaf paths pointing at the original diff file', () => {
    const f = mkFile('src/deep/nested/file.ts');
    const tree = buildFileTree([f]);
    let node: FileTreeNode = tree[0]!;
    while (node.kind === 'dir') node = node.children[0]!;
    expect(node.path).toBe('src/deep/nested/file.ts');
    expect(node.file).toBe(f);
    expect(node.name).toBe('file.ts');
  });
});

describe('fileStats', () => {
  it('counts adds and removes across hunks', () => {
    expect(fileStats(mkFile('a.ts', 3, 2))).toEqual({ adds: 3, removes: 2 });
  });
});
