import { describe, expect, it } from 'vitest';
import { renderInline, renderMarkdown } from '../markdown/Markdown';

// diffdad renders only untrusted LLM/GitHub-user markdown, so these guard the hardening invariants:
// raw HTML is never emitted as HTML, and link/image URLs are restricted to a protocol allowlist.
// Assertions run against renderMarkdown/renderInline (the pre-DOMPurify string output), so a passing
// test proves the dangerous markup never even reaches DOMPurify.

describe('markdown hardening: raw HTML', () => {
  it('escapes a <script> tag instead of emitting it', () => {
    const { html } = renderMarkdown('<script>alert(1)</script>', 'light', {});
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes inline raw HTML tags', () => {
    const out = renderInline('hi <img src=x onerror=alert(1)> there');
    expect(out).not.toContain('<img src=x');
    expect(out).toContain('&lt;img');
  });
});

describe('markdown hardening: URL protocol allowlist', () => {
  it('neutralizes a javascript: link to plain text', () => {
    const out = renderInline('[click](javascript:alert(1))');
    expect(out).not.toContain('<a');
    expect(out).not.toContain('href=');
    expect(out).toContain('click');
  });

  it('neutralizes a data: image to its alt text', () => {
    const out = renderInline('![pic](data:image/png;base64,AAAA)');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('data:');
    expect(out).toContain('pic');
  });

  it('neutralizes a file: link to plain text', () => {
    const out = renderInline('[secret](file:///etc/passwd)');
    expect(out).not.toContain('<a');
    expect(out).not.toContain('href=');
    expect(out).toContain('secret');
  });

  it('neutralizes a vbscript: link to plain text', () => {
    const out = renderInline('[x](vbscript:msgbox)');
    expect(out).not.toContain('<a');
    expect(out).not.toContain('href=');
  });

  it('neutralizes a local absolute file path link', () => {
    const out = renderInline('[open](/Users/nick/secret.txt)');
    expect(out).not.toContain('<a');
    expect(out).toContain('open');
  });

  it('neutralizes a ~/ home path link', () => {
    const out = renderInline('[open](~/secret.txt)');
    expect(out).not.toContain('<a');
    expect(out).toContain('open');
  });

  it('still renders a normal https link', () => {
    expect(renderInline('[t](https://example.com)')).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer" style="color:var(--brand);text-decoration:underline">t</a>',
    );
  });

  it('still renders a relative anchor link', () => {
    expect(renderInline('[t](#section)')).toContain('<a href="#section"');
  });

  it('still renders an https image', () => {
    expect(renderInline('![alt](https://x/y.png)')).toContain('<img alt="alt" src="https://x/y.png"');
  });
});

describe('markdown hardening: GFM still works', () => {
  it('renders a table', () => {
    const { html } = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |', 'light', {});
    expect(html).toContain('<table');
    expect(html).toContain('>a</th>');
    expect(html).toContain('>1</td>');
  });

  it('renders a fenced code block', () => {
    const { html } = renderMarkdown('```js\nconst x = 1\n```', 'light', {});
    expect(html).toContain('<pre');
    expect(html).toContain('<code>const x = 1</code>');
  });
});
