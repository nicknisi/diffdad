import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentCommentStore } from '../agent-comments/store';
import { UnknownCommentError } from '../agent-comments/types';
import { type Broadcast, errorText, project, text, type ToolHost } from './tools';

/**
 * Resolve a unit's comment store, or `undefined` when the unitId names no live unit. The daemon
 * injects this backed by its per-unit store cache (which checks the UnitStore first), so an agent
 * passing a stale/wrong unitId gets a clean error instead of silently writing to a phantom store.
 */
export type ResolveCommentStore = (unitId: string) => Promise<AgentCommentStore | undefined>;

export type UnitCommentToolDeps = {
  getStore: ResolveCommentStore;
  broadcast: Broadcast;
};

/**
 * The daemon variant of `registerAgentCommentTools`: the same list/reply/resolve loop, but every
 * tool is scoped to a `unitId` (the id `submit_for_review` returned). The daemon hosts many units at
 * once, so a global mailbox would leak one unit's comments to every parked agent — these tools route
 * each mutation to that unit's own store and broadcast a unit-scoped `agent-comment` snapshot, which
 * the dad UI applies only to the open unit's tab.
 */
export function registerUnitCommentTools(server: McpServer, { getStore, broadcast }: UnitCommentToolDeps): void {
  const host = server as unknown as ToolHost;
  const notify = (unitId: string, store: AgentCommentStore) =>
    broadcast('agent-comment', { unitId, comments: store.list() });

  host.registerTool(
    'list_review_comments',
    {
      description:
        'List the review comments the developer left on your unit (pass the unitId returned by ' +
        'submit_for_review). Fetching marks open comments as delivered (acknowledged) — only call when ' +
        'you intend to act on them. Default returns open comments.',
      inputSchema: { unitId: z.string(), status: z.enum(['open', 'delivered', 'all']).optional() },
    },
    async (args) => {
      const store = await getStore(args.unitId as string);
      if (!store) return errorText(`unknown unit: ${args.unitId as string}`);
      const filter = (args.status as 'open' | 'delivered' | 'all' | undefined) ?? 'open';
      // Capture the matching set BEFORE flipping — markDelivered mutates these objects in place, so
      // projecting `requested` afterward reflects the new delivered status without re-filtering.
      const requested = store.list(filter);
      const openIds = requested.filter((c) => c.status === 'open').map((c) => c.id);
      if (openIds.length > 0) {
        await store.markDelivered(openIds);
        notify(args.unitId as string, store);
      }
      return text(requested.map(project));
    },
  );

  host.registerTool(
    'reply_to_comment',
    {
      description:
        'Post a reply to a review comment on your unit (e.g. what you changed, or why you left it as-is). ' +
        'Renders inline in the dad UI.',
      inputSchema: { unitId: z.string(), id: z.string(), body: z.string() },
    },
    async (args) => {
      const store = await getStore(args.unitId as string);
      if (!store) return errorText(`unknown unit: ${args.unitId as string}`);
      try {
        const comment = await store.addReply(args.id as string, { author: 'agent', body: args.body as string });
        notify(args.unitId as string, store);
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
      description: 'Mark a review comment on your unit addressed, with an optional note describing what you did.',
      inputSchema: { unitId: z.string(), id: z.string(), note: z.string().optional() },
    },
    async (args) => {
      const store = await getStore(args.unitId as string);
      if (!store) return errorText(`unknown unit: ${args.unitId as string}`);
      try {
        const comment = await store.resolve(args.id as string, args.note as string | undefined);
        notify(args.unitId as string, store);
        return text(project(comment));
      } catch (err) {
        if (err instanceof UnknownCommentError) return errorText(err.message);
        throw err;
      }
    },
  );
}
