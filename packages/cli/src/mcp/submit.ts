import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AgentCommentStore } from '../agent-comments/store';
import { CleanTreeError, type LocalReview } from '../local/diff-source';
import type { UnitStore } from '../units/store';
import type { DecisionChannel } from '../units/decision-channel';
import { type ReviewUnit, UnknownUnitError } from '../units/types';
import { type Broadcast, errorText, project, text, type ToolHost } from './tools';

/** Computes a unit's diff slice from its worktree. The daemon injects `buildLocalReview` bound
 *  to the worktree as cwd; tests inject a fake. Throws `CleanTreeError` when there's nothing to review. */
export type ComputeSlice = (worktreePath: string, baseRef?: string) => Promise<LocalReview>;

export type SubmitToolDeps = {
  store: UnitStore;
  broadcast: Broadcast;
  computeSlice: ComputeSlice;
  decision: DecisionChannel;
  /** Fired after a unit is created so the daemon can enqueue it for the review-worker pool. */
  onSubmitted?: (unit: ReviewUnit) => void;
  /** Long-poll ceiling for `await_decision`. Kept under Bun's 255s idle timeout. */
  awaitTimeoutMs?: number;
  /**
   * Resolve a unit's agent-comment mailbox (the daemon's per-unit `getCommentStore`; `undefined`
   * for an unknown unit). When provided, `await_decision` bundles the unit's outstanding comments
   * into its response and marks open ones delivered — so an agent parked on the verdict never has
   * to remember a separate `list_review_comments` call to catch a hand-typed beat.
   */
  getCommentStore?: (unitId: string) => Promise<AgentCommentStore | undefined>;
};

// Under Bun's `idleTimeout: 255`, a single held request must resolve well before the socket
// is torn down; 240s leaves headroom and the agent re-calls on the {pending:true} response.
const DEFAULT_AWAIT_MS = 240_000;

/**
 * Register the two review-loop MCP tools. `submit_for_review` enqueues a unit and returns its id
 * immediately (the review runs async in the worker pool); `await_decision` long-polls for the
 * verdict. Both close over the shared `UnitStore` + `DecisionChannel`, mirroring `registerAgentCommentTools`.
 */
export function registerSubmitTools(server: McpServer, deps: SubmitToolDeps): void {
  const { store, broadcast, computeSlice, decision, onSubmitted, getCommentStore } = deps;
  const awaitTimeoutMs = deps.awaitTimeoutMs ?? DEFAULT_AWAIT_MS;
  const host = server as unknown as ToolHost;
  const notify = () => broadcast('units', { units: store.list() });

  /**
   * The unit's outstanding (open + delivered, i.e. not-yet-addressed) comments, projected for the
   * agent — or `undefined` when there's no mailbox or nothing outstanding. Marks any `open` ones
   * delivered as a side effect (bundling them IS delivery) and broadcasts so the UI badge updates.
   */
  const bundleComments = async (unitId: string) => {
    if (!getCommentStore) return undefined;
    const cs = await getCommentStore(unitId);
    if (!cs) return undefined;
    const outstanding = cs.list().filter((c) => c.status !== 'addressed');
    if (outstanding.length === 0) return undefined;
    const openIds = outstanding.filter((c) => c.status === 'open').map((c) => c.id);
    if (openIds.length > 0) {
      await cs.markDelivered(openIds);
      broadcast('agent-comment', { unitId, comments: cs.list() });
    }
    // Re-read so just-delivered statuses are reflected in what the agent receives.
    return cs
      .list()
      .filter((c) => c.status !== 'addressed')
      .map(project);
  };

  host.registerTool(
    'submit_for_review',
    {
      description:
        'Submit finished work for review. Returns { unitId } immediately; the review runs asynchronously. ' +
        'Then call await_decision({ unitId }) and park on it for the verdict. Submitting against a clean ' +
        'working tree is a no-op (returns { ok: false }).',
      inputSchema: {
        taskLabel: z.string(),
        intent: z.string(),
        uncertainties: z.array(z.string()).optional(),
        repo: z.string(),
        worktreePath: z.string(),
        baseRef: z.string().optional(),
      },
    },
    async (args) => {
      let review: LocalReview;
      try {
        review = await computeSlice(args.worktreePath as string, args.baseRef as string | undefined);
      } catch (err) {
        if (err instanceof CleanTreeError) {
          return text({ ok: false, reason: 'clean-tree', message: err.message });
        }
        throw err;
      }

      const unit = await store.add({
        repo: args.repo as string,
        worktreePath: args.worktreePath as string,
        taskLabel: args.taskLabel as string,
        intent: args.intent as string,
        uncertainties: (args.uncertainties as string[] | undefined) ?? [],
        baseRef: review.baseRef,
        diffContentKey: review.contentKey,
        files: review.files,
        metadata: review.metadata,
        source: 'agent',
      });
      notify();
      onSubmitted?.(unit);
      return text({ unitId: unit.unitId });
    },
  );

  host.registerTool(
    'await_decision',
    {
      description:
        'Long-poll for the review decision on your unit. Returns { decision } once the reviewer decides ' +
        '(approved or changes_requested, with curated concerns), or { pending: true } on timeout — re-call ' +
        'to keep waiting. The decision is persisted, so it is never lost across reconnects. Any outstanding ' +
        'review comments are bundled in as { comments } (and marked delivered), so you never miss a ' +
        'hand-typed note while parked — reply_to_comment / resolve_comment to close them out.',
      inputSchema: { unitId: z.string() },
    },
    async (args) => {
      const unitId = args.unitId as string;
      const unit = store.get(unitId);
      if (!unit) return errorText(new UnknownUnitError(unitId).message);
      if (unit.decision) {
        const comments = await bundleComments(unitId);
        return text(comments ? { decision: unit.decision, comments } : { decision: unit.decision });
      }

      const decided = await decision.wait(unitId, awaitTimeoutMs);
      const comments = await bundleComments(unitId);
      if (decided) return text(comments ? { decision: decided, comments } : { decision: decided });
      return text(comments ? { pending: true, comments } : { pending: true });
    },
  );
}
