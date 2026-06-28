import { z } from 'zod';
import type { AgentComment } from '../agent-comments/types';

export type Broadcast = (event: string, data: unknown) => void;

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
export const errorText = (message: string): ToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});
