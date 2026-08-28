import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SequenceMessage } from '../../state/types';
import { SequenceSection } from '../SequenceSection';

/**
 * Server-rendered markup smoke test (props-only component, no store) matching the callstack suite's
 * approach. Asserts participant boxes and arrow labels reach the SVG, and the tour toggle renders.
 */

const participants = ['Client', 'Gateway', 'Service'];
const messages: SequenceMessage[] = [
  { from: 'Client', to: 'Gateway', label: 'POST /order' },
  { from: 'Gateway', to: 'Service', label: 'forward', note: 'now retried', file: 'src/gw.ts', hunkIndex: 0 },
  { from: 'Service', to: 'Service', label: 'validate' },
];

describe('SequenceSection markup', () => {
  it('renders participant names and every message label', () => {
    const html = renderToStaticMarkup(
      <SequenceSection title="Order flow" participants={participants} messages={messages} />,
    );
    expect(html).toContain('Order flow');
    for (const p of participants) expect(html).toContain(p);
    for (const m of messages) expect(html).toContain(m.label);
    // Tour entry point is present when there are messages to walk.
    expect(html).toContain('Walk through');
  });

  it('omits the walk-through control when there are no messages', () => {
    const html = renderToStaticMarkup(<SequenceSection title="Empty" participants={['A']} messages={[]} />);
    expect(html).not.toContain('Walk through');
  });
});
