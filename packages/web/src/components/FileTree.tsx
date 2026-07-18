import { useEffect, useMemo, useState } from 'react';
import { buildFileTree, fileStats, type FileTreeNode } from '../lib/file-tree';
import type { DiffFile } from '../state/types';
import { IconChevron } from './Icons';

/** The Files tab's file sections carry `data-filepath`; rows scroll to them by element id. */
export function fileAnchorId(path: string): string {
  return `file-${path}`;
}

function jumpToFile(path: string) {
  const el = document.getElementById(fileAnchorId(path));
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function statusColor(file: DiffFile): string {
  if (file.isNewFile) return 'var(--green-9)';
  if (file.isDeleted) return 'var(--red-9)';
  return 'var(--amber-9)';
}

function FileRow({ node, depth, active }: { node: FileTreeNode & { kind: 'file' }; depth: number; active: boolean }) {
  const { adds, removes } = fileStats(node.file);
  return (
    <button
      type="button"
      onClick={() => jumpToFile(node.path)}
      title={node.path}
      className="flex w-full cursor-pointer items-center gap-1.5 rounded-md py-[4px] pr-1.5 text-left transition-colors hover:bg-[var(--gray-a3)]"
      style={{
        paddingLeft: `${8 + depth * 14}px`,
        background: active ? 'var(--purple-a3)' : undefined,
      }}
    >
      <span
        className="h-[6px] w-[6px] flex-shrink-0 rounded-full"
        style={{ background: statusColor(node.file) }}
        aria-hidden
      />
      <span
        className="min-w-0 flex-1 truncate font-mono text-[11.5px] leading-[16px]"
        style={{ color: active ? 'var(--purple-11)' : 'var(--fg-2)' }}
      >
        {node.name}
      </span>
      <span className="flex-shrink-0 font-mono text-[10px] tabular-nums">
        {adds > 0 && <span style={{ color: 'var(--green-11)' }}>+{adds}</span>}
        {adds > 0 && removes > 0 && ' '}
        {removes > 0 && <span style={{ color: 'var(--red-11)' }}>−{removes}</span>}
      </span>
    </button>
  );
}

function DirRow({
  node,
  depth,
  activePath,
  collapsed,
  onToggle,
}: {
  node: FileTreeNode & { kind: 'dir' };
  depth: number;
  activePath: string | null;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
}) {
  const isCollapsed = collapsed.has(node.path);
  return (
    <li>
      <button
        type="button"
        onClick={() => onToggle(node.path)}
        aria-expanded={!isCollapsed}
        className="flex w-full cursor-pointer items-center gap-1 rounded-md py-[4px] pr-1.5 text-left text-[var(--fg-3)] transition-colors hover:bg-[var(--gray-a3)] hover:text-[var(--fg-2)]"
        style={{ paddingLeft: `${2 + depth * 14}px` }}
      >
        <span
          className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center transition-transform"
          style={{ transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)' }}
        >
          <IconChevron className="h-2.5 w-2.5" />
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] font-medium leading-[16px]">{node.name}/</span>
      </button>
      {!isCollapsed && (
        <ul className="m-0 list-none p-0">
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              collapsed={collapsed}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function TreeNode({
  node,
  depth,
  activePath,
  collapsed,
  onToggle,
}: {
  node: FileTreeNode;
  depth: number;
  activePath: string | null;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
}) {
  if (node.kind === 'dir') {
    return <DirRow node={node} depth={depth} activePath={activePath} collapsed={collapsed} onToggle={onToggle} />;
  }
  return (
    <li>
      <FileRow node={node} depth={depth} active={activePath === node.path} />
    </li>
  );
}

/**
 * Sticky file-tree sidebar for the Files tab: collapsible directories (single-child chains
 * compressed), click-to-jump, and a scroll-spy highlight tracking the file section currently
 * under the reader. Mirrors the BeatRail pattern the Story tab uses.
 */
export function FileTree({ files }: { files: DiffFile[] }) {
  const tree = useMemo(() => buildFileTree(files), [files]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [activePath, setActivePath] = useState<string | null>(null);

  function onToggle(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  // Scroll-spy: the file section crossing a fixed ~100px band just below the sticky header becomes
  // active. The band's bottom offset is computed from the real viewport — a percentage bottom margin
  // goes negative on short windows (600px viewport: 600 − 160 − 75% = −10px) and the observer would
  // silently never fire.
  useEffect(() => {
    const sections = [...document.querySelectorAll('[data-filepath]')];
    if (sections.length === 0) return;
    const bandBottom = Math.max(window.innerHeight - 260, 0);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActivePath(entry.target.getAttribute('data-filepath'));
          }
        }
      },
      { rootMargin: `-160px 0px ${-bandBottom}px 0px` },
    );
    for (const el of sections) observer.observe(el);
    return () => observer.disconnect();
  }, [files]);

  return (
    <aside className="sticky top-[160px] max-h-[calc(100vh-180px)] self-start overflow-y-auto text-[13px]">
      <div className="px-2 pb-[3px] text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--fg-3)]">
        {files.length} files
      </div>
      <ul className="m-0 list-none p-0">
        {tree.map((node) => (
          <TreeNode
            key={node.path}
            node={node}
            depth={0}
            activePath={activePath}
            collapsed={collapsed}
            onToggle={onToggle}
          />
        ))}
      </ul>
    </aside>
  );
}
