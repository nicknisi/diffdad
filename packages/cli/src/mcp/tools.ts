import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentCommentStore } from '../agent-comments/store';
import { type AgentComment, UnknownCommentError } from '../agent-comments/types';

export type Broadcast = (event: string, data: unknown) => void;

export type AgentToolDeps = {
  store: AgentCommentStore;
  broadcast: Broadcast;
};

export type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

// The SDK's `registerTool` generics recurse infinitely over zod raw shapes (TS2589),
// so we register through a minimal structural interface. Zod still validates inputs at
// runtime; tool callbacks receive already-validated args.
export type ToolHost = {
  registerTool(
    name: string,
    config: { title?: string; description?: string; inputSchema?: Record<string, z.ZodTypeAny> },
    cb: (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult,
  ): unknown;
};

/** Projection sent to the agent — the fields it needs to act, without internal churn. */
export function project(c: AgentComment) {
  return {
    id: c.id,
    path: c.path,
    line: c.line,
    side: c.side,
    status: c.status,
    body: c.body,
    hunkContext: c.hunkContext,
    chapterTitle: c.chapterTitle,
    replies: c.replies.map((r) => ({ author: r.author, body: r.body })),
  };
}

export const text = (value: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
});
export const errorText = (message: string): ToolResult => ({ content: [{ type: 'text', text: message }], isError: true });

/**
 * Register the three agent-comment tools on an MCP server. Every mutation broadcasts
 * an `agent-comment` snapshot so the dad UI updates live over its existing SSE channel.
 */
export function registerAgentCommentTools(server: McpServer, { store, broadcast }: AgentToolDeps): void {
  const host = server as unknown as ToolHost;
  const notify = () => broadcast('agent-comment', { comments: store.list() });

  host.registerTool(
    'list_review_comments',
    {
      description:
        'List review comments the developer left for you. Fetching marks open comments as delivered (acknowledged) — only call when you intend to act on them. Default returns open comments.',
      inputSchema: { status: z.enum(['open', 'delivered', 'all']).optional() },
    },
    async (args) => {
      const filter = (args.status as 'open' | 'delivered' | 'all' | undefined) ?? 'open';
      // Capture the matching set BEFORE flipping — markDelivered mutates these objects
      // in place, so projecting `requested` afterward reflects the new delivered status
      // without re-filtering (which would drop the just-delivered comments from `open`).
      const requested = store.list(filter);
      const openIds = requested.filter((c) => c.status === 'open').map((c) => c.id);
      if (openIds.length > 0) {
        await store.markDelivered(openIds);
        notify();
      }
      return text(requested.map(project));
    },
  );

  host.registerTool(
    'reply_to_comment',
    {
      description:
        'Post a reply to a review comment (e.g. what you changed, or why you left it as-is). Renders inline in the dad UI.',
      inputSchema: { id: z.string(), body: z.string() },
    },
    async (args) => {
      try {
        const comment = await store.addReply(args.id as string, { author: 'agent', body: args.body as string });
        notify();
        return text(project(comment));
      } catch (err) {
        if (err instanceof UnknownCommentError) return errorText(err.message);
        throw err;
      }
    },
  );

  host.registerTool(
    'resolve_comment',
    {
      description: 'Mark a review comment addressed, with an optional note describing what you did.',
      inputSchema: { id: z.string(), note: z.string().optional() },
    },
    async (args) => {
      try {
        const comment = await store.resolve(args.id as string, args.note as string | undefined);
        notify();
        return text(project(comment));
      } catch (err) {
        if (err instanceof UnknownCommentError) return errorText(err.message);
        throw err;
      }
    },
  );
}
