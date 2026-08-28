import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CallStackFrame } from '../../state/types';
import { buildTreeRows, CallStackSection } from '../CallStackSection';

/**
 * Pure `buildTreeRows` connector logic plus a server-rendered markup smoke test. Rendered through
 * `react-dom/server` (no store, props-only component) to match the suite's node environment.
 */

function frame(label: string, depth: number, change: CallStackFrame['change'] = 'unchanged'): CallStackFrame {
  return { label, depth, change };
}

describe('buildTreeRows', () => {
  it('emits no connector at depth 0 and elbows at deeper levels', () => {
    const rows = buildTreeRows([frame('root', 0), frame('a', 1), frame('b', 1)]);
    expect(rows[0]!.prefix).toBe('');
    expect(rows[1]!.prefix).toBe('├─ '); // a has a sibling below
    expect(rows[2]!.prefix).toBe('└─ '); // b is last
  });

  it('draws vertical guides for ancestor levels that still have siblings', () => {
    // root, child(has sibling), grandchild, sibling-of-child
    const rows = buildTreeRows([frame('root', 0), frame('c1', 1), frame('gc', 2), frame('c2', 1)]);
    expect(rows[1]!.prefix).toBe('├─ '); // c1 not last (c2 follows)
    expect(rows[2]!.prefix).toBe('│  └─ '); // guide for c1's level, gc is last child
    expect(rows[3]!.prefix).toBe('└─ '); // c2 last
  });
});

describe('CallStackSection markup', () => {
  const frames: CallStackFrame[] = [
    frame('handleSubmit — src/form.ts', 0),
    { label: 'validate — src/form.ts', depth: 1, change: 'added', file: 'src/form.ts', hunkIndex: 0 },
    { label: 'legacyCheck — src/old.ts', depth: 1, change: 'removed', file: 'src/old.ts', hunkIndex: 3 },
  ];

  it('renders a linked frame as a button when resolveHunkId hits', () => {
    const html = renderToStaticMarkup(
      <CallStackSection
        title="Submit path"
        frames={frames}
        resolveHunkId={(file, idx) => (file === 'src/form.ts' && idx === 0 ? 'ch-0-hunk-src/form.ts-0' : null)}
      />,
    );
    expect(html).toContain('Submit path');
    expect(html).toContain('<button');
    expect(html).toContain('handleSubmit');
    // The unresolved removed frame shows its file as a dim suffix, not a button link.
    expect(html).toContain('src/old.ts');
  });

  it('renders no buttons when nothing resolves', () => {
    const html = renderToStaticMarkup(<CallStackSection title="Flow" frames={frames} />);
    expect(html).not.toContain('<button');
  });
});
