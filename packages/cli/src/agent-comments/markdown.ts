import type { AgentComment } from './types';

/**
 * Render unresolved agent comments (open + delivered, i.e. anything not yet addressed) as a
 * markdown block — the manual fallback for agents that can't speak MCP (the "Copy for agent"
 * button and `dad comments` both use this). Delivered-but-unaddressed comments are still
 * actionable, so they remain in the fallback.
 */
export function renderCommentsMarkdown(comments: AgentComment[]): string {
  const open = comments.filter((c) => c.status !== 'addressed');
  if (open.length === 0) {
    return 'No open review comments.';
  }

  const lines: string[] = [`# Review comments (${open.length})`, ''];
  for (const c of open) {
    lines.push(`## ${c.path}:${c.line}`);
    if (c.chapterTitle) lines.push(`_${c.chapterTitle}_`);
    lines.push('', c.body);
    if (c.hunkContext.trim()) {
      lines.push('', '```diff', c.hunkContext.trim(), '```');
    }
    for (const r of c.replies) {
      lines.push('', `> **${r.author}:** ${r.body}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}
