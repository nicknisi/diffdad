import DOMPurify, { type Config } from 'dompurify';
import MarkdownIt, { type MarkdownIt as MarkdownItInstance, type StateInline, type Token } from 'markdown-it';
import { useEffect, useMemo, useState } from 'react';
import { highlightLine } from '../../lib/shiki';
import { useResolvedTheme } from '../../state/review-store';
import { useHighlighter } from '../../hooks/useHighlighter';

type Props = {
  source: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function highlightBlock(code: string, lang: string, theme: 'light' | 'dark'): string {
  const lines = code.split('\n');
  return lines.map((line) => highlightLine(line, lang, theme) ?? escapeHtml(line)).join('\n');
}

const MERMAID_PRE_STYLE =
  'background:var(--gray-2);border:1px solid var(--gray-a4);padding:0.75rem;border-radius:6px;font-size:0.875rem;overflow-x:auto';

function mermaidBlockHtml(source: string, svgCache: Record<string, string>): string {
  const cached = svgCache[source];
  if (cached) {
    return `<div class="mermaid-rendered" style="overflow-x:auto">${cached}</div>`;
  }
  return `<pre class="mermaid-pending" style="${MERMAID_PRE_STYLE}">${escapeHtml(source)}</pre>`;
}

// GitHub bots wrap attribution in HTML comments (`<!-- ccr-slack-attribution -->`, `<!-- devin-... -->`).
// Strip them before parsing so the markers never reach the DOM — markdown-it would otherwise pass them
// through as html_block tokens.
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

const SANITIZE_CONFIG: Config = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true },
  ADD_TAGS: ['details', 'summary', 'sub', 'sup', 'foreignObject', 'style'],
  ADD_ATTR: [
    'style',
    'class',
    'open',
    'align',
    'dominant-baseline',
    'text-anchor',
    'transform-origin',
    'marker-end',
    'marker-start',
    'refX',
    'refY',
    'markerWidth',
    'markerHeight',
    'orient',
    'markerUnits',
  ],
} as const;

// --- markdown-it inline helpers ---------------------------------------------

function isAsciiWs(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0b || code === 0x0c || code === 0x0d;
}

function isWordChar(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) || // 0-9
    (code >= 0x41 && code <= 0x5a) || // A-Z
    (code >= 0x61 && code <= 0x7a) || // a-z
    code === 0x5f // _
  );
}

// `(^|\s)@([\w-]+)` — chipify the handle. Registered before `text` so the `@` isn't swallowed by the
// text rule first; the whitespace/start guard matches the old regex and keeps `name@host` literal.
// The `linkLevel` guard skips link text so `[@user](url)` leaves the handle as plain text (the old
// regex ran after link conversion and saw `>` before `@`, so it never chipified inside links either).
function mentionRule(state: StateInline, silent: boolean): boolean {
  const start = state.pos;
  if (state.src.charCodeAt(start) !== 0x40 /* @ */) return false;
  if (state.linkLevel > 0) return false;
  const prev = start > 0 ? state.src.charCodeAt(start - 1) : -1;
  if (prev !== -1 && !isAsciiWs(prev)) return false;
  let end = start + 1;
  while (end < state.posMax) {
    const c = state.src.charCodeAt(end);
    if (!((isWordChar(c) || c === 0x2d) /* - */)) break;
    end++;
  }
  if (end === start + 1) return false;
  if (!silent) {
    const name = state.src.slice(start + 1, end);
    const token = state.push('html_inline', '', 0);
    token.content = `<span style="background:var(--purple-a3);border-radius:3px;padding:1px 5px;color:var(--purple-11)">@${escapeHtml(name)}</span>`;
    token.markup = '@';
  }
  state.pos = end;
  return true;
}

// `[\w-]+/[\w-]+#\d+` — linkify owner/repo#N. The href is "#" intentionally: the frontend has no base
// URL to build a real github.com link from at render time. Implemented as a core ruler that splits
// `text` tokens after the inline parse, because the inline `text` rule consumes `owner/repo#123` in
// one gulp (unlike `@`, word chars and `/`/`#` don't stop it) — so an inline rule registered before
// `text` never gets a chance mid-paragraph. Code spans are `code_inline` tokens (no text children),
// so they're naturally skipped; link text is skipped via a link_open/link_close depth counter so the
// ref doesn't produce a nested `<a>`.
function splitRepoRefs(content: string, TokenCtor: typeof MarkdownIt.Token, out: Token[]): void {
  const re = /[\w-]+\/[\w-]+#\d+/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const ref = match[0];
    const before = content.slice(last, match.index);
    if (before) {
      const text = new TokenCtor('text', '', 0);
      text.content = before;
      out.push(text);
    }
    const link = new TokenCtor('html_inline', '', 0);
    link.content = `<a href="#" style="color:var(--brand);text-decoration:underline">${escapeHtml(ref)}</a>`;
    out.push(link);
    last = match.index + ref.length;
  }
  const tail = content.slice(last);
  if (tail) {
    const text = new TokenCtor('text', '', 0);
    text.content = tail;
    out.push(text);
  }
}

function repoRefPlugin(md: MarkdownItInstance): void {
  md.core.ruler.after('inline', 'diffdad_repo_ref', (state) => {
    for (const tok of state.tokens) {
      if (tok.type !== 'inline' || !tok.children) continue;
      const next: Token[] = [];
      let inLink = 0;
      for (const child of tok.children) {
        if (child.type === 'link_open') {
          inLink++;
          next.push(child);
          continue;
        }
        if (child.type === 'link_close') {
          inLink--;
          next.push(child);
          continue;
        }
        if (child.type === 'text' && inLink === 0) {
          splitRepoRefs(child.content, state.Token, next);
        } else {
          next.push(child);
        }
      }
      tok.children = next;
    }
  });
}

// GitHub-style task lists: `[x]`/`[ ]` at the start of a list item renders a ballot-box glyph.
// markdown-it has no built-in task-list support, and the popular plugin emits `<input>` checkboxes,
// so this preserves the original `&#9745;`/`&#9744;` glyph markup instead. Runs after the inline parse
// so the item's children already exist; the checkbox prefix is stripped from the first text child and
// an inline-flex wrapper + glyph are spliced in front. A per-item stack handles nested lists.
function taskListsPlugin(md: MarkdownItInstance): void {
  md.core.ruler.after('inline', 'diffdad_task_lists', (state) => {
    const firstInlineRemaining: boolean[] = [];
    for (const t of state.tokens) {
      if (t.type === 'list_item_open') {
        firstInlineRemaining.push(true);
        continue;
      }
      if (t.type === 'list_item_close') {
        firstInlineRemaining.pop();
        continue;
      }
      const topIdx = firstInlineRemaining.length - 1;
      if (topIdx < 0 || !firstInlineRemaining[topIdx] || t.type !== 'inline') continue;
      firstInlineRemaining[topIdx] = false;
      const checkbox = t.content.match(/^\[([ xX])\]\s*([\s\S]*)$/);
      if (!checkbox) continue;
      const checked = checkbox[1] !== ' ';
      const firstText = t.children?.[0];
      if (firstText?.type === 'text') {
        firstText.content = firstText.content.replace(/^\[([ xX])\]\s*/, '');
      }
      const open = new state.Token('html_inline', '', 0);
      open.content = '<span class="inline-flex items-center gap-1.5">';
      const box = new state.Token('html_inline', '', 0);
      box.content = checked
        ? '<span style="color:var(--green-11)">&#9745;</span>'
        : '<span style="color:var(--fg-3)">&#9744;</span>';
      const space = new state.Token('text', '', 0);
      space.content = ' ';
      const close = new state.Token('html_inline', '', 0);
      close.content = '</span>';
      t.children = [open, box, space, ...(t.children ?? [])];
      t.children.push(close);
    }
  });
}

// --- markdown-it instance with diffdad's rendering ---------------------------

const HEADING_SIZES: Record<number, string> = {
  1: 'text-[1.25em] font-bold',
  2: 'text-[1.15em] font-bold',
  3: 'text-[1.05em] font-semibold',
  4: 'text-[1em] font-semibold',
  5: 'text-[0.95em] font-semibold',
  6: 'text-[0.9em] font-semibold',
};

// `html: true` passes bot comments' raw HTML through for DOMPurify to sanitize. `linkify: false`
// preserves the old behaviour of not autolinking bare URLs (flip it on for full GFM autolinking).
// `breaks: false` matches the old paragraph joining — a single newline is a soft break, not `<br>`.
const md = new MarkdownIt({
  html: true,
  breaks: false,
  linkify: false,
  typographer: false,
});
md.enable(['table', 'strikethrough']);
// taskLists runs before repoRef (both are core rules after 'inline'); the checkbox prefix is stripped
// from the first text child first, then repoRef splits any owner/repo#N that remains in that text.
md.use(taskListsPlugin);
md.use(repoRefPlugin);
md.inline.ruler.before('text', 'diffdad_mention', mentionRule);

type RenderEnv = {
  theme: 'light' | 'dark';
  svgCache: Record<string, string>;
  mermaidSources: string[];
};

// markdown-it marks paragraph tokens `hidden` inside tight lists; the default renderer skips hidden
// tokens, but a custom rule bypasses that check — so respect `hidden` to keep tight lists `<li>text</li>`.
md.renderer.rules.paragraph_open = (tokens, idx) =>
  tokens[idx]!.hidden ? '' : '<p class="mb-3 text-base leading-relaxed" style="color:var(--fg-1)">';
md.renderer.rules.paragraph_close = (tokens, idx) => (tokens[idx]!.hidden ? '' : '</p>');

md.renderer.rules.heading_open = (tokens, idx) => {
  const tag = tokens[idx]!.tag;
  const level = Number.parseInt(tag.slice(1), 10) || 6;
  return `<${tag} class="mt-4 mb-2 ${HEADING_SIZES[level] ?? ''}" style="color:var(--fg-1)">`;
};
md.renderer.rules.heading_close = (tokens, idx) => `</${tokens[idx]!.tag}>`;

md.renderer.rules.hr = () => '<hr class="my-3 border-t" style="border-color:var(--gray-a4)" />';

md.renderer.rules.blockquote_open = () =>
  '<blockquote class="my-2 border-l-[3px] pl-3 italic" style="border-color:var(--gray-a5);color:var(--fg-2)">';
md.renderer.rules.blockquote_close = () => '</blockquote>';

md.renderer.rules.bullet_list_open = () => '<ul class="my-2 list-disc pl-6 space-y-1" style="color:var(--fg-1)">';
md.renderer.rules.bullet_list_close = () => '</ul>';
md.renderer.rules.ordered_list_open = () => '<ol class="my-2 list-decimal pl-6 space-y-1" style="color:var(--fg-1)">';
md.renderer.rules.ordered_list_close = () => '</ol>';

md.renderer.rules.table_open = () => '<table class="my-2 w-full text-sm" style="border-collapse:collapse">';
md.renderer.rules.table_close = () => '</table>';
md.renderer.rules.thead_open = () => '<thead>';
md.renderer.rules.thead_close = () => '</thead>';
md.renderer.rules.tbody_open = () => '<tbody>';
md.renderer.rules.tbody_close = () => '</tbody>';
md.renderer.rules.th_open = () =>
  '<th class="px-3 py-1.5 text-left font-semibold" style="color:var(--fg-1);border-bottom:2px solid var(--gray-a4)">';
md.renderer.rules.th_close = () => '</th>';
md.renderer.rules.td_open = () =>
  '<td class="px-3 py-1.5" style="color:var(--fg-2);border-bottom:1px solid var(--gray-a3)">';
md.renderer.rules.td_close = () => '</td>';

md.renderer.rules.code_inline = (tokens, idx) =>
  `<code style="background:var(--gray-a3);border-radius:3px;padding:1px 5px;font-size:0.9em">${escapeHtml(tokens[idx]!.content)}</code>`;

md.renderer.rules.link_open = (tokens, idx) => {
  const href = tokens[idx]!.attrGet('href') ?? '#';
  return `<a href="${escapeHtml(String(href))}" target="_blank" rel="noopener noreferrer" style="color:var(--brand);text-decoration:underline">`;
};
md.renderer.rules.link_close = () => '</a>';

md.renderer.rules.image = (tokens, idx) => {
  const src = tokens[idx]!.attrGet('src') ?? '';
  const alt = tokens[idx]!.content;
  return `<img alt="${escapeHtml(alt)}" src="${escapeHtml(String(src))}" class="inline-block max-h-[1.4em] align-text-bottom" />`;
};

// Fenced code: shiki per-line highlighting + a lang label, matching the old renderer. mermaid fences
// are intercepted and turned into the pending/cached placeholder div the effect below hydrates. The
// trailing newline markdown-it keeps in `token.content` is stripped to match the old `buf.join('\n')`.
md.renderer.rules.fence = (tokens, idx, _opts, env) => {
  const token = tokens[idx]!;
  const lang = token.info.trim();
  const code = token.content.replace(/\n$/, '');
  const e = env as RenderEnv;
  if (lang === 'mermaid') {
    e.mermaidSources.push(code);
    return mermaidBlockHtml(code, e.svgCache);
  }
  const langLabel = lang
    ? `<div class="mb-1 text-xs font-mono uppercase" style="color:var(--fg-3)">${escapeHtml(lang)}</div>`
    : '';
  const codeContent = lang ? highlightBlock(code, lang, e.theme) : escapeHtml(code);
  return `<pre class="my-2 overflow-x-auto rounded-[6px] p-3 font-mono text-sm leading-snug" style="background:var(--gray-2);border:1px solid var(--gray-a4)">${langLabel}<code>${codeContent}</code></pre>`;
};

// Indented code blocks get the same styling as fences (minus the lang label). The old regex renderer
// let these fall through to a paragraph; markdown-it parses them, which matches GitHub.
md.renderer.rules.code_block = (tokens, idx) =>
  `<pre class="my-2 overflow-x-auto rounded-[6px] p-3 font-mono text-sm leading-snug" style="background:var(--gray-2);border:1px solid var(--gray-a4)"><code>${escapeHtml(tokens[idx]!.content)}</code></pre>`;

// Raw HTML blocks (bot comments) pass through verbatim, except a ```mermaid fence embedded inside one
// (e.g. inside <details>) is still intercepted for the effect to hydrate — preserving the old behaviour.
md.renderer.rules.html_block = (tokens, idx, _opts, env) => {
  const e = env as RenderEnv;
  return tokens[idx]!.content.replace(/```mermaid\s*\n([\s\S]*?)```/g, (_, src: string) => {
    const source = src.trim();
    e.mermaidSources.push(source);
    return mermaidBlockHtml(source, e.svgCache);
  });
};

// Exported so the renderer can be tested as a pure string→string function — the component around it
// needs DOMPurify + mermaid + the zustand store, none of which exist in the node test environment.
export function renderInline(text: string): string {
  return md.renderInline(text);
}

type RenderResult = { html: string; mermaidSources: string[] };

export function renderMarkdown(src: string, theme: 'light' | 'dark', svgCache: Record<string, string>): RenderResult {
  const cleaned = src.replace(HTML_COMMENT_RE, '');
  const env: RenderEnv = { theme, svgCache, mermaidSources: [] };
  return { html: md.render(cleaned, env), mermaidSources: env.mermaidSources };
}

let mermaidUid = 0;
let mermaidTheme: string | null = null;

export function Markdown({ source }: Props) {
  const theme = useResolvedTheme();
  useHighlighter();
  const [svgCache, setSvgCache] = useState<Record<string, string>>({});

  const { html: rawHtml, mermaidSources } = useMemo(
    () => renderMarkdown(source, theme, svgCache),
    [source, theme, svgCache],
  );
  const safeHtml = useMemo(() => DOMPurify.sanitize(rawHtml, SANITIZE_CONFIG), [rawHtml]);

  const pending = mermaidSources.filter((s) => !svgCache[s]);

  useEffect(() => {
    if (pending.length === 0) return;

    let cancelled = false;

    (async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        if (cancelled) return;
        if (mermaidTheme !== theme) {
          mermaid.initialize({
            startOnLoad: false,
            theme: theme === 'dark' ? 'dark' : 'default',
            fontFamily: 'inherit',
          });
          mermaidTheme = theme;
        }

        const newEntries: Record<string, string> = {};
        for (const src of pending) {
          if (cancelled) return;
          try {
            const { svg } = await mermaid.render(`mermaid-${mermaidUid++}`, src);
            newEntries[src] = svg;
          } catch (err) {
            console.error('[mermaid] render error:', err);
            newEntries[src] = `<pre style="${MERMAID_PRE_STYLE};color:var(--fg-2)">${escapeHtml(src)}</pre>`;
          }
        }
        if (!cancelled && Object.keys(newEntries).length > 0) {
          setSvgCache((prev) => ({ ...prev, ...newEntries }));
        }
      } catch (err) {
        console.error('[mermaid] import error:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pending.join('\0'), theme]);

  return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}
