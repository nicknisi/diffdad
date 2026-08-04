import { describe, expect, it } from 'vitest';
import { renderInline, renderMarkdown } from '../Markdown';

// `renderMarkdown` is the markdown-it render (pre-DOMPurify). The component around it needs DOMPurify
// + mermaid + the zustand store, none of which exist in the node test environment, so the block-level
// rules are tested directly here. Shiki's highlighter is also unloaded in tests, so fenced code falls
// back to escaped text — which is exactly what lets us assert the wrapper markup deterministically.

describe('renderMarkdown: blocks', () => {
  it('wraps plain text in a styled paragraph', () => {
    const { html } = renderMarkdown('Hello world', 'light', {});
    expect(html).toContain('<p class="mb-3 text-base leading-relaxed" style="color:var(--fg-1)">Hello world</p>');
  });

  it('renders headings with the per-level size classes', () => {
    expect(renderMarkdown('# Title', 'light', {}).html).toContain(
      '<h1 class="mt-4 mb-2 text-[1.25em] font-bold" style="color:var(--fg-1)">Title</h1>',
    );
    expect(renderMarkdown('## Sub', 'light', {}).html).toContain(
      '<h2 class="mt-4 mb-2 text-[1.15em] font-bold" style="color:var(--fg-1)">Sub</h2>',
    );
  });

  it('renders a horizontal rule with the diffdad hr styling', () => {
    expect(renderMarkdown('---', 'light', {}).html).toContain(
      '<hr class="my-3 border-t" style="border-color:var(--gray-a4)" />',
    );
  });

  it('renders a blockquote with the left-border italic styling', () => {
    const { html } = renderMarkdown('> a quote', 'light', {});
    expect(html).toContain(
      '<blockquote class="my-2 border-l-[3px] pl-3 italic" style="border-color:var(--gray-a5);color:var(--fg-2)">',
    );
    expect(html).toContain('a quote');
  });

  it('renders a tight unordered list without inner <p> tags', () => {
    const { html } = renderMarkdown('- a\n- b', 'light', {});
    expect(html).toContain('<ul class="my-2 list-disc pl-6 space-y-1" style="color:var(--fg-1)">');
    expect(html).toContain('<li>a</li>');
    expect(html).toContain('<li>b</li>');
    expect(html).not.toContain('<p');
  });

  it('renders an ordered list with the decimal styling', () => {
    const { html } = renderMarkdown('1. a\n2. b', 'light', {});
    expect(html).toContain('<ol class="my-2 list-decimal pl-6 space-y-1" style="color:var(--fg-1)">');
    expect(html).toContain('<li>a</li>');
  });
});

describe('renderMarkdown: task lists', () => {
  it('renders checked and unchecked ballot-box glyphs wrapping the item text', () => {
    const { html } = renderMarkdown('- [x] done\n- [ ] todo', 'light', {});
    expect(html).toContain('<span class="inline-flex items-center gap-1.5">');
    expect(html).toContain('&#9745;');
    expect(html).toContain('done</span>');
    expect(html).toContain('&#9744;');
    expect(html).toContain('todo</span>');
    // The raw `[x]` / `[ ]` markers must be consumed, not left as text.
    expect(html).not.toContain('[x]');
    expect(html).not.toContain('[ ]');
  });

  it('handles nested checklists without bleeding the checkbox across items', () => {
    const { html } = renderMarkdown('- [x] top\n  - [ ] sub', 'light', {});
    expect(html).toContain('&#9745;');
    expect(html).toContain('&#9744;');
    expect(html).toContain('top</span>');
    expect(html).toContain('sub</span>');
  });
});

describe('renderMarkdown: tables', () => {
  it('renders header + body rows with the diffdad cell styling', () => {
    const { html } = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |', 'light', {});
    expect(html).toContain('<table class="my-2 w-full text-sm" style="border-collapse:collapse">');
    expect(html).toContain('<thead>');
    expect(html).toContain(
      '<th class="px-3 py-1.5 text-left font-semibold" style="color:var(--fg-1);border-bottom:2px solid var(--gray-a4)">a</th>',
    );
    expect(html).toContain('<tbody>');
    expect(html).toContain(
      '<td class="px-3 py-1.5" style="color:var(--fg-2);border-bottom:1px solid var(--gray-a3)">1</td>',
    );
  });
});

describe('renderMarkdown: code', () => {
  it('renders a fenced block with the lang label and styled pre/code wrapper', () => {
    // No highlighter in the test env, so the code falls back to escaped text — assert the wrapper.
    const { html } = renderMarkdown('```js\nconst x = 1\n```', 'light', {});
    expect(html).toContain(
      '<pre class="my-2 overflow-x-auto rounded-[6px] p-3 font-mono text-sm leading-snug" style="background:var(--gray-2);border:1px solid var(--gray-a4)">',
    );
    expect(html).toContain('<div class="mb-1 text-xs font-mono uppercase" style="color:var(--fg-3)">js</div>');
    expect(html).toContain('<code>const x = 1</code>');
  });

  it('renders an indented code block with the same wrapper (minus the lang label)', () => {
    const { html } = renderMarkdown('    const y = 2', 'light', {});
    expect(html).toContain(
      '<pre class="my-2 overflow-x-auto rounded-[6px] p-3 font-mono text-sm leading-snug" style="background:var(--gray-2);border:1px solid var(--gray-a4)"><code>',
    );
    expect(html).toContain('const y = 2');
    expect(html).not.toContain('uppercase');
  });

  it('renders inline code with the chip styling', () => {
    expect(renderInline('see `c` here')).toContain(
      '<code style="background:var(--gray-a3);border-radius:3px;padding:1px 5px;font-size:0.9em">c</code>',
    );
  });
});

describe('renderMarkdown: mermaid', () => {
  it('intercepts a ```mermaid fence and registers the source for the effect to hydrate', () => {
    const { html, mermaidSources } = renderMarkdown('```mermaid\ngraph LR\nA-->B\n```', 'light', {});
    expect(html).toContain('mermaid-pending');
    expect(mermaidSources).toEqual(['graph LR\nA-->B']);
  });

  it('returns the cached svg when the source is already in the cache', () => {
    const source = 'graph LR\nA-->B';
    const { html } = renderMarkdown('```mermaid\n' + source + '\n```', 'light', { [source]: '<svg/>' });
    expect(html).toContain('mermaid-rendered');
    expect(html).toContain('<svg/>');
    expect(html).not.toContain('mermaid-pending');
  });

  it('intercepts a ```mermaid fence embedded inside a raw HTML block', () => {
    const { html, mermaidSources } = renderMarkdown('<div>\n```mermaid\ngraph TD\nA-->B\n```\n</div>', 'light', {});
    expect(html).toContain('mermaid-pending');
    expect(mermaidSources).toEqual(['graph TD\nA-->B']);
  });
});

describe('renderMarkdown: links, images, autolinks', () => {
  it('renders [text](url) with target=_blank and the brand styling', () => {
    expect(renderInline('[t](http://x)')).toBe(
      '<a href="http://x" target="_blank" rel="noopener noreferrer" style="color:var(--brand);text-decoration:underline">t</a>',
    );
  });

  it('renders ![alt](url) with the inline image class', () => {
    expect(renderInline('![alt](http://x/y.png)')).toBe(
      '<img alt="alt" src="http://x/y.png" class="inline-block max-h-[1.4em] align-text-bottom" />',
    );
  });
});

describe('renderMarkdown: diffdad inline rules', () => {
  it('chipifies @mentions only when preceded by whitespace or start', () => {
    expect(renderInline('hi @user')).toContain(
      '<span style="background:var(--purple-a3);border-radius:3px;padding:1px 5px;color:var(--purple-11)">@user</span>',
    );
    // `name@host` is an email-ish fragment — the whitespace guard keeps it literal.
    expect(renderInline('name@host')).toBe('name@host');
  });

  it('linkifies owner/repo#N references to the placeholder href', () => {
    expect(renderInline('see foo/bar#123 now')).toContain(
      '<a href="#" style="color:var(--brand);text-decoration:underline">foo/bar#123</a>',
    );
  });

  it('does not chipify or linkify inside a code span', () => {
    expect(renderInline('`@user and foo/bar#123`')).toBe(
      '<code style="background:var(--gray-a3);border-radius:3px;padding:1px 5px;font-size:0.9em">@user and foo/bar#123</code>',
    );
  });
});

describe('renderMarkdown: emphasis (the whole point of the port)', () => {
  it('renders *italic*, _italic_, and **bold** at block level', () => {
    const { html } = renderMarkdown('_italic_ and **bold**', 'light', {});
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<strong>bold</strong>');
  });

  it('renders ***bold-italic*** — a case the old regex renderer could not handle', () => {
    expect(renderInline('***bi***')).toBe('<em><strong>bi</strong></em>');
  });

  it('renders ~~strikethrough~~ (newly enabled GFM rule)', () => {
    expect(renderInline('~~strike~~')).toBe('<s>strike</s>');
  });

  it('leaves snake_case identifiers literal at block level', () => {
    const { html } = renderMarkdown('use snake_case here', 'light', {});
    expect(html).toContain('snake_case');
    expect(html).not.toContain('<em>');
  });
});

describe('renderMarkdown: HTML handling', () => {
  it('strips HTML comments before rendering', () => {
    const { html } = renderMarkdown('a <!-- ccr-slack-attribution --> b', 'light', {});
    expect(html).not.toContain('<!--');
    expect(html).not.toContain('ccr-slack-attribution');
    expect(html).toContain('a');
    expect(html).toContain('b');
  });

  it('passes raw HTML blocks (bot comments) through verbatim for DOMPurify', () => {
    const { html } = renderMarkdown('<div class="x">hello</div>', 'light', {});
    expect(html).toContain('<div class="x">hello</div>');
  });
});
