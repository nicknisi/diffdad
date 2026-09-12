import DOMPurify, { type Config } from 'dompurify';
import MarkdownIt, { type MarkdownIt as MarkdownItInstance, type StateInline, type Token } from 'markdown-it';
import { useEffect, useMemo, useState } from 'react';
import { highlightLine } from '../../lib/shiki';
import { useResolvedTheme, useReviewStore } from '../../state/review-store';
import { useHighlighter } from '../../hooks/useHighlighter';

type Props = {
  source: string;
  /** `github` = the PR-description pipeline (raw HTML parsed, hard-wrapped newlines, autolinks,
   *  GFM alerts). Default `narration` = today's hardened short-prose pipeline, byte-identical. */
  variant?: 'narration' | 'github';
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// URL hardening for LLM/GitHub-user content. diffdad has no trusted-author markdown, so every href/src
// is untrusted. Only http/https/mailto and relative anchors are allowed through as clickable; anything
// else (javascript:, data:, file:, vbscript:, local filesystem paths) is neutralized to plain text.
const SAFE_PROTOCOLS = ['http:', 'https:', 'mailto:'];

function isLocalFilesystemHref(value: string): boolean {
  const trimmed = value.trim();
  if (/^file:/i.test(trimmed)) return true;
  if (/^~[\\/]/.test(trimmed)) return true; // ~/ home shorthand
  if (/^[a-z]:[\\/]/i.test(trimmed)) return true; // Windows drive path
  return /^\/(?:Users|home|tmp|var|private|Volumes|mnt|workspace|etc|root|opt)\//.test(trimmed);
}

// Returns the original href when safe to link, or null when it must be rendered as plain text.
function safeUrl(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const raw = String(value);
  const trimmed = raw.trim();
  if (trimmed.startsWith('#')) return raw; // relative anchor
  if (isLocalFilesystemHref(trimmed)) return null;
  try {
    const url = new URL(trimmed, 'http://localhost/');
    return SAFE_PROTOCOLS.includes(url.protocol) ? raw : null;
  } catch {
    return null;
  }
}

// Neutralizes unsafe markdown links to plain text: a link_open whose href fails the allowlist is
// flagged (with its paired link_close) so the render rules emit no <a> wrapper, leaving the link text
// inline. Runs as a core rule so it also applies through renderInline (which runs core.process).
function sanitizeLinksPlugin(md: MarkdownItInstance): void {
  md.core.ruler.after('inline', 'diffdad_safe_links', (state) => {
    for (const tok of state.tokens) {
      if (tok.type !== 'inline' || !tok.children) continue;
      const neutralized: boolean[] = [];
      for (const child of tok.children) {
        if (child.type === 'link_open') {
          const safe = safeUrl(child.attrGet('href'));
          if (safe === null) {
            child.meta = { ...child.meta, neutralized: true };
            neutralized.push(true);
          } else {
            child.attrSet('href', safe);
            neutralized.push(false);
          }
        } else if (child.type === 'link_close') {
          if (neutralized.pop()) child.meta = { ...child.meta, neutralized: true };
        }
      }
    }
  });
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
    'width',
    'height',
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
  // The github variant parses raw PR-description HTML; DOMPurify with the html profile still allows
  // interactive/scripting elements this app never has a use for. Drop them like GitHub's sanitizer does.
  FORBID_TAGS: [
    'iframe',
    'video',
    'audio',
    'object',
    'embed',
    'form',
    'input',
    'button',
    'select',
    'textarea',
    'base',
    'frame',
    'frameset',
    'applet',
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

// `(^|\s)@([\w-]+)` — narration renders the handle as a chip; the `github` variant links it to the
// user's GitHub profile, which is a global (not repo-scoped) URL, so no repoUrl is needed.
// Registered before `text` so the `@` isn't swallowed by the text rule first; the whitespace/start
// guard matches the old regex and keeps `name@host` literal. The `linkLevel` guard skips link text so
// `[@user](url)` leaves the handle as plain text.
function mentionRule(state: StateInline, silent: boolean): boolean {
  const env = state.env as RenderEnv | undefined;
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
    token.content =
      env?.variant === 'github'
        ? `<a href="https://github.com/${encodeURIComponent(name)}" style="color:var(--brand);text-decoration:underline" target="_blank" rel="noopener noreferrer">@${escapeHtml(name)}</a>`
        : `<span style="background:var(--purple-a3);border-radius:3px;padding:1px 5px;color:var(--purple-11)">@${escapeHtml(name)}</span>`;
    token.markup = '@';
  }
  state.pos = end;
  return true;
}

// Cross-repo refs (`owner/repo#N`) and, on the `github` variant, bare issue refs (`#N`, only when the
// repo URL is known). Both link into GitHub's issue/PR space — `/issues/N` routes to a PR when N is a
// pull number, so one href shape covers both. Split from `text` tokens after the inline parse because
// the inline `text` rule consumes `owner/repo#123` in one gulp (unlike `@`, word chars and `/`/`#`
// don't stop it) — so an inline rule registered before `text` never gets a chance mid-paragraph. Code
// spans are `code_inline` tokens (no text children), so they're naturally skipped; link text is
// skipped via a link_open/link_close depth counter so the ref doesn't produce a nested `<a>`.
const GITHUB_ORIGIN = 'https://github.com';

function issueHref(repoUrl: string | undefined | null, ref: string): string | null {
  const cross = /^([\w-]+)\/([\w-]+)#/.exec(ref);
  // Cross-repo refs always resolve (the app is GitHub-only, so the origin is constant); a bare ref
  // needs the repo URL and stays plain text without one — never a dead link.
  if (cross) return `${GITHUB_ORIGIN}/${cross[1]}/${cross[2]}/issues/${ref.split('#')[1]!}`;
  return repoUrl ? `${repoUrl}/issues/${ref.slice(1)}` : null;
}

function splitRepoRefs(
  content: string,
  TokenCtor: typeof MarkdownIt.Token,
  out: Token[],
  github: boolean,
  repoUrl: string | undefined | null,
): void {
  const re = /(?:[\w-]+\/[\w-]+)?#\d+/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const ref = match[0];
    // Narration keeps today's behaviour verbatim (cross-repo ref with a dead `#` href); the github
    // variant emits real links, or plain text for a bare ref with no repo URL.
    const href = github ? issueHref(repoUrl, ref) : '#';
    const before = content.slice(last, match.index);
    if (before) {
      const text = new TokenCtor('text', '', 0);
      text.content = before;
      out.push(text);
    }
    if (href === null) {
      const text = new TokenCtor('text', '', 0);
      text.content = ref;
      out.push(text);
    } else {
      // Narration's output stays byte-identical to the pre-variant renderer (no target/rel on a dead
      // `#` href); the github variant opens real links in a new tab.
      const link = new TokenCtor('html_inline', '', 0);
      const attrs = github ? ' target="_blank" rel="noopener noreferrer"' : '';
      link.content = `<a href="${escapeHtml(href)}"${attrs} style="color:var(--brand);text-decoration:underline">${escapeHtml(ref)}</a>`;
      out.push(link);
    }
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
    const env = state.env as RenderEnv | undefined;
    const github = env?.variant === 'github';
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
          splitRepoRefs(child.content, state.Token, next, github, env?.repoUrl);
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

// --- markdown-it instances with diffdad's rendering ---------------------------

type MarkdownVariant = 'narration' | 'github';

type RenderEnv = {
  theme: 'light' | 'dark';
  svgCache: Record<string, string>;
  mermaidSources: string[];
  /** Which instance is rendering; absent = narration. Lets shared rules branch per surface. */
  variant?: MarkdownVariant;
  /** `https://github.com/owner/repo` — lets the github variant link bare `#N` refs. Absent in watch mode. */
  repoUrl?: string | null;
};

// GFM alerts: `> [!NOTE]` and friends. GitHub renders these as colored callouts with a title bar, and
// they are everywhere in modern PR descriptions. Detected at parse time: the blockquote's first
// paragraph must start with the marker; it is stripped and the type rides on `meta.alert` on BOTH the
// open token (renderer picks the callout shell) and its depth-matched close token (so `</div>` pairs
// with the right `</blockquote>` under nesting). github variant only — narration keeps plain quotes.
const ALERT_STYLES: Record<string, { bg: string; fg: string; border: string; label: string }> = {
  note: { bg: 'var(--blue-2)', fg: 'var(--blue-11)', border: 'var(--blue-6)', label: 'Note' },
  tip: { bg: 'var(--green-2)', fg: 'var(--green-11)', border: 'var(--green-6)', label: 'Tip' },
  important: { bg: 'var(--purple-2)', fg: 'var(--purple-11)', border: 'var(--purple-6)', label: 'Important' },
  warning: { bg: 'var(--amber-2)', fg: 'var(--amber-11)', border: 'var(--amber-6)', label: 'Warning' },
  caution: { bg: 'var(--red-2)', fg: 'var(--red-11)', border: 'var(--red-6)', label: 'Caution' },
};

function gfmAlertsPlugin(md: MarkdownItInstance): void {
  md.core.ruler.after('inline', 'diffdad_gfm_alerts', (state) => {
    if ((state.env as RenderEnv | undefined)?.variant !== 'github') return;
    for (let i = 0; i < state.tokens.length; i++) {
      const bq = state.tokens[i]!;
      if (bq.type !== 'blockquote_open') continue;
      const p = state.tokens[i + 1];
      const inline = state.tokens[i + 2];
      if (!p || p.type !== 'paragraph_open' || !inline || inline.type !== 'inline' || !inline.children?.length)
        continue;
      const m = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/.exec(inline.children[0]!.content);
      if (!m) continue;
      const kind = m[1]!.toLowerCase();
      bq.meta = { ...bq.meta, alert: kind };
      // Find this open's matching close (depth-count from itself) so the close renders `</div>`.
      let depth = 0;
      for (let j = i; j < state.tokens.length; j++) {
        const t = state.tokens[j]!;
        if (t.type === 'blockquote_open') depth++;
        else if (t.type === 'blockquote_close' && --depth === 0) {
          t.meta = { ...t.meta, alert: kind };
          break;
        }
      }
      // Strip the marker, then drop an emptied lead text and a now-leading softbreak (breaks:true
      // would render that as an empty first line inside the callout).
      const first = inline.children[0]!;
      first.content = first.content.slice(m[0].length);
      while (inline.children[0] && inline.children[0].type === 'text' && inline.children[0].content === '') {
        inline.children.shift();
      }
      if (inline.children[0]?.type === 'softbreak') inline.children.shift();
    }
  });
}

type MdOptions = { html: boolean; breaks: boolean; linkify: boolean };

const HEADING_SIZES: Record<number, string> = {
  1: 'text-[1.25em] font-bold',
  2: 'text-[1.15em] font-bold',
  3: 'text-[1.05em] font-semibold',
  4: 'text-[1em] font-semibold',
  5: 'text-[0.95em] font-semibold',
  6: 'text-[0.9em] font-semibold',
};

function createMd(opts: MdOptions): MarkdownItInstance {
  const md = new MarkdownIt({
    html: opts.html,
    breaks: opts.breaks,
    linkify: opts.linkify,
    typographer: false,
  });
  md.enable(['table', 'strikethrough']);
  // taskLists runs before repoRef (both are core rules after 'inline'); the checkbox prefix is stripped
  // from the first text child first, then repoRef splits any owner/repo#N that remains in that text.
  md.use(gfmAlertsPlugin);
  md.use(taskListsPlugin);
  md.use(repoRefPlugin);
  md.use(sanitizeLinksPlugin);
  md.inline.ruler.before('text', 'diffdad_mention', mentionRule);

  // markdown-it marks paragraph tokens `hidden` inside tight lists; the default renderer skips hidden
  // tokens, but a custom rule bypasses that check — so respect `hidden` to keep tight lists `<li>text</li>`.
  // The github variant matches GitHub's description typography (14px) instead of narration's 16px.
  md.renderer.rules.paragraph_open = (tokens, idx, _opts, env) =>
    tokens[idx]!.hidden
      ? ''
      : `<p class="mb-3 ${env?.variant === 'github' ? 'text-[14px] leading-[21px]' : 'text-base leading-relaxed'}" style="color:var(--fg-1)">`;
  md.renderer.rules.paragraph_close = (tokens, idx) => (tokens[idx]!.hidden ? '' : '</p>');

  md.renderer.rules.heading_open = (tokens, idx) => {
    const tag = tokens[idx]!.tag;
    const level = Number.parseInt(tag.slice(1), 10) || 6;
    return `<${tag} class="mt-4 mb-2 ${HEADING_SIZES[level] ?? ''}" style="color:var(--fg-1)">`;
  };
  md.renderer.rules.heading_close = (tokens, idx) => `</${tokens[idx]!.tag}>`;

  md.renderer.rules.hr = () => '<hr class="my-3 border-t" style="border-color:var(--gray-a4)" />';

  md.renderer.rules.blockquote_open = (tokens, idx, _opts, env) => {
    const alert = env?.variant === 'github' ? (tokens[idx]!.meta?.alert as string | undefined) : undefined;
    if (alert && ALERT_STYLES[alert]) {
      const a = ALERT_STYLES[alert]!;
      return `<div class="my-3 overflow-hidden rounded-md px-3.5 pb-2.5 pt-2" style="background:${a.bg};box-shadow:inset 0 0 0 1px ${a.border}"><div class="mb-1.5 text-[12px] font-bold uppercase tracking-[0.04em]" style="color:${a.fg}">${a.label}</div>`;
    }
    return '<blockquote class="my-2 border-l-[3px] pl-3 italic" style="border-color:var(--gray-a5);color:var(--fg-2)">';
  };
  md.renderer.rules.blockquote_close = (tokens, idx) => (tokens[idx]!.meta?.alert ? '</div>' : '</blockquote>');

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
    // sanitizeLinksPlugin flags links that failed the protocol allowlist — drop the <a> wrapper so the
    // link text renders as plain, non-clickable text.
    if (tokens[idx]!.meta?.neutralized) return '';
    const href = tokens[idx]!.attrGet('href') ?? '#';
    return `<a href="${escapeHtml(String(href))}" target="_blank" rel="noopener noreferrer" style="color:var(--brand);text-decoration:underline">`;
  };
  md.renderer.rules.link_close = (tokens, idx) => (tokens[idx]!.meta?.neutralized ? '' : '</a>');

  md.renderer.rules.image = (tokens, idx, _opts, env) => {
    const src = safeUrl(tokens[idx]!.attrGet('src'));
    const alt = tokens[idx]!.content;
    // Unsafe image src (data:, file:, javascript:, local path) — render the alt text as plain text.
    if (src === null) return escapeHtml(alt);
    // Narration inline images are chips beside prose; a PR description's images are content — natural
    // size, capped to the container (`.markdown-body img` in index.css).
    return env?.variant === 'github'
      ? `<img alt="${escapeHtml(alt)}" src="${escapeHtml(src)}" class="my-2 block h-auto max-w-full" />`
      : `<img alt="${escapeHtml(alt)}" src="${escapeHtml(src)}" class="inline-block max-h-[1.4em] align-text-bottom" />`;
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

  return md;
}

// Narration, comments, and AI answers: the original hardening posture — raw HTML is never parsed into
// tags (diffdad's own prose never needs it), single newlines stay soft breaks, bare URLs don't autolink.
const narrationMd = createMd({ html: false, breaks: false, linkify: false });

// PR descriptions as GitHub renders them: raw HTML is parsed (GitHub descriptions are full of
// <details>/<summary> blocks, <br>, <kbd>), single newlines hard-wrap like GitHub comments, and bare
// URLs autolink. DOMPurify still gates every emitted tag at the component boundary.
const githubMd = createMd({ html: true, breaks: true, linkify: true });

function mdFor(variant: MarkdownVariant | undefined): MarkdownItInstance {
  return variant === 'github' ? githubMd : narrationMd;
}

// Exported so the renderer can be tested as a pure string→string function — the component around it
// needs DOMPurify + mermaid + the zustand store, none of which exist in the node test environment.
export function renderInline(text: string): string {
  return narrationMd.renderInline(text);
}

type RenderResult = { html: string; mermaidSources: string[] };

type RenderOpts = { variant?: MarkdownVariant; repoUrl?: string | null };

export function renderMarkdown(
  src: string,
  theme: 'light' | 'dark',
  svgCache: Record<string, string>,
  opts?: RenderOpts,
): RenderResult {
  const cleaned = src.replace(HTML_COMMENT_RE, '');
  const env: RenderEnv = {
    theme,
    svgCache,
    mermaidSources: [],
    variant: opts?.variant ?? 'narration',
    repoUrl: opts?.repoUrl,
  };
  return { html: mdFor(env.variant).render(cleaned, env), mermaidSources: env.mermaidSources };
}

let mermaidUid = 0;
let mermaidTheme: string | null = null;

export function Markdown({ source, variant = 'narration' }: Props) {
  const theme = useResolvedTheme();
  // The github variant autolinks bare `#N` issue refs against the PR's repo; narration ignores it.
  const repoUrl = useReviewStore((s) => s.repoUrl);
  useHighlighter();
  const [svgCache, setSvgCache] = useState<Record<string, string>>({});

  const { html: rawHtml, mermaidSources } = useMemo(
    () => renderMarkdown(source, theme, svgCache, { variant, repoUrl }),
    [source, theme, svgCache, variant, repoUrl],
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
