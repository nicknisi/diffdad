import { useCallback, useEffect } from 'react';
import { useReviewStore } from '../state/review-store';
import type { AgentComment } from '../state/types';

export type ComposeInput = {
  path: string;
  line: number;
  body: string;
  side?: 'LEFT' | 'RIGHT';
  hunkContext?: string;
  chapterTitle?: string;
};

/** Render unresolved (open + delivered) agent comments as markdown (mirrors `dad comments`). */
export function commentsToMarkdown(comments: AgentComment[]): string {
  const open = comments.filter((c) => c.status !== 'addressed');
  if (open.length === 0) return 'No open review comments.';
  const lines: string[] = [`# Review comments (${open.length})`, ''];
  for (const c of open) {
    lines.push(`## ${c.path}:${c.line}`);
    if (c.chapterTitle) lines.push(`_${c.chapterTitle}_`);
    lines.push('', c.body);
    for (const r of c.replies) lines.push('', `> **${r.author}:** ${r.body}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/**
 * The agent-comment loop, frontend side. Fetches the initial list once; live updates
 * arrive via the `agent-comment` SSE event (see useLiveStream). Separate from the GitHub
 * comment hook by design — agent comments have string ids and a status lifecycle.
 */
export function useAgentComments() {
  const agentComments = useReviewStore((s) => s.agentComments);
  const setAgentComments = useReviewStore((s) => s.setAgentComments);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/agent-comments')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (!cancelled && Array.isArray(data)) setAgentComments(data as AgentComment[]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [setAgentComments]);

  const compose = useCallback(
    async (input: ComposeInput): Promise<AgentComment | null> => {
      try {
        const res = await fetch('/api/agent-comments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
        });
        if (!res.ok) return null;
        const created = (await res.json()) as AgentComment;
        // Optimistic: the SSE broadcast will also arrive, but update immediately.
        const current = useReviewStore.getState().agentComments;
        if (!current.find((c) => c.id === created.id)) setAgentComments([...current, created]);
        return created;
      } catch {
        return null;
      }
    },
    [setAgentComments],
  );

  const copyForAgent = useCallback(async (): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(commentsToMarkdown(useReviewStore.getState().agentComments));
      return true;
    } catch {
      return false;
    }
  }, []);

  return { agentComments, compose, copyForAgent };
}
