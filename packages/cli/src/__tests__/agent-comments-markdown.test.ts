import { describe, expect, it } from 'vitest';
import { renderCommentsMarkdown } from '../agent-comments/markdown';
import type { AgentComment } from '../agent-comments/types';

function mk(over: Partial<AgentComment> = {}): AgentComment {
  return {
    id: 'id',
    path: 'src/a.ts',
    line: 10,
    side: 'RIGHT',
    body: 'extract this guard',
    status: 'open',
    author: 'user',
    replies: [],
    hunkContext: '',
    createdAt: 't',
    ...over,
  };
}

describe('renderCommentsMarkdown', () => {
  it('renders a friendly message for no open comments', () => {
    expect(renderCommentsMarkdown([])).toBe('No open review comments.');
    expect(renderCommentsMarkdown([mk({ status: 'addressed' })])).toBe('No open review comments.');
  });

  it('renders a single comment with file:line and body', () => {
    const md = renderCommentsMarkdown([mk()]);
    expect(md).toContain('# Review comments (1)');
    expect(md).toContain('## src/a.ts:10');
    expect(md).toContain('extract this guard');
  });

  it('renders multiple comments with hunk context and replies', () => {
    const md = renderCommentsMarkdown([
      mk({ id: '1', path: 'a.ts', line: 1, body: 'one', hunkContext: '@@ -1 +1 @@\n-a\n+b' }),
      mk({ id: '2', path: 'b.ts', line: 2, body: 'two', replies: [{ id: 'r', author: 'agent', body: 'done', createdAt: 't' }] }),
      mk({ id: '3', path: 'c.ts', line: 3, body: 'three', chapterTitle: 'Chapter X' }),
    ]);
    expect(md).toContain('# Review comments (3)');
    expect(md).toContain('```diff');
    expect(md).toContain('> **agent:** done');
    expect(md).toContain('_Chapter X_');
  });
});
