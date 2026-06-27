import { describe, expect, it } from 'vitest';
import { AgentActivity } from '../units/agent-activity';

describe('AgentActivity', () => {
  it('records and returns the last-seen timestamp per unit', () => {
    let t = 1000;
    const a = new AgentActivity({ now: () => t });
    expect(a.lastSeen('u1')).toBeUndefined();
    a.touch('u1');
    expect(a.lastSeen('u1')).toBe(1000);
    t = 2000;
    a.touch('u1');
    expect(a.lastSeen('u1')).toBe(2000);
    expect(a.lastSeen('u2')).toBeUndefined();
  });

  it('notifies onTouch with the unit + timestamp so the daemon can broadcast presence', () => {
    const seen: [string, number][] = [];
    const a = new AgentActivity({ now: () => 4242 });
    a.onTouch = (id, ts) => seen.push([id, ts]);
    a.touch('u9');
    expect(seen).toEqual([['u9', 4242]]);
  });
});
