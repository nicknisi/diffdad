export type AgentActivityOptions = { now?: () => number };

/**
 * Tracks when an agent was last seen interacting with each unit — parking on `await_decision`, or
 * listing / replying to / resolving its comments. The drill-in turns this into an honest presence
 * cue ("agent connected" vs "no agent connected") WITHOUT faking a real-time socket: an active agent
 * refreshes its timestamp every poll (≤ the await ceiling, ~4 min), so a recent stamp means it will
 * see your notes on its next pass; a stale one means it's gone and the note will wait. Crucially this
 * does NOT flip to "disconnected" the instant the agent unparks to do work between polls — it only
 * goes stale after the window — so the cue stays steady instead of flickering. In-memory only:
 * presence is ephemeral and resets when the daemon restarts (an agent re-announces on its next call).
 */
export class AgentActivity {
  private readonly seen = new Map<string, number>();
  private readonly now: () => number;
  /** Set by the daemon to broadcast a `presence` SSE snapshot when a unit's agent checks in. */
  onTouch?: (unitId: string, lastSeenAt: number) => void;

  constructor(opts: AgentActivityOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
  }

  /** Record that the unit's agent is active right now. */
  touch(unitId: string): void {
    const ts = this.now();
    this.seen.set(unitId, ts);
    this.onTouch?.(unitId, ts);
  }

  /** The agent's last-seen epoch-ms for this unit, or `undefined` if never seen. */
  lastSeen(unitId: string): number | undefined {
    return this.seen.get(unitId);
  }
}
