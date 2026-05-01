import DOMPurify from 'dompurify';
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

function renderInline(text: string): string {
  let out = text;
  // Images: ![alt](url)
  out = out.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    '<img alt="$1" src="$2" class="inline-block max-h-[1.4em] align-text-bottom" />',
  );
  // Links: [text](url)
  out = out.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" style="color:var(--brand);text-decoration:underline">$1</a>',
  );
  // Bold
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  // Inline code
  out = out.replace(
    /`([^`]+)`/g,
    '<code style="background:var(--gray-a3);border-radius:3px;padding:1px 5px;font-size:0.9em">$1</code>',
  );
  // @mentions
  out = out.replace(
    /(^|\s)@([\w-]+)/g,
    '$1<span style="background:var(--purple-a3);border-radius:3px;padding:1px 5px;color:var(--purple-11)">@$2</span>',
  );
  // Repo refs: owner/repo#123
  out = out.replace(/([\w-]+\/[\w-]+#\d+)/g, '<a href="#" style="color:var(--brand);text-decoration:underline">$1</a>');
  return out;
}

function highlightBlock(code: string, lang: string, theme: 'light' | 'dark'): string {
  const lines = code.split('\n');
  return lines.map((line) => highlightLine(line, lang, theme) ?? escapeHtml(line)).join('\n');
}

function escapeNonHtml(text: string): string {
  const parts: string[] = [];
  let last = 0;
  const tagRe = /<\/?[a-zA-Z][^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(escapeHtml(text.slice(last, m.index)));
    }
    parts.push(m[0]);
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    parts.push(escapeHtml(text.slice(last)));
  }
  return parts.join('');
}

function processInline(text: string): string {
  return renderInline(escapeNonHtml(text));
}

const HTML_BLOCK_RE =
  /^<\/?(?:h[1-6]|p|div|details|summary|table|thead|tbody|tr|th|td|ul|ol|li|hr|br|pre|blockquote|section|article|aside|nav|header|footer|sub|sup|dl|dt|dd)[\s>/]/i;
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

function renderMarkdown(src: string, theme: 'light' | 'dark' = 'light'): string {
  const cleaned = src.replace(HTML_COMMENT_RE, '');
  const lines = cleaned.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  let para: string[] = [];

  function flushPara() {
    if (para.length === 0) return;
    const joined = para.join(' ').trim();
    if (!joined) {
      para = [];
      return;
    }
    out.push(`<p class="mb-3 text-base leading-relaxed" style="color:var(--fg-1)">${processInline(joined)}</p>`);
    para = [];
  }

  while (i < lines.length) {
    const line = lines[i] ?? '';

    // Fenced code blocks
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      flushPara();
      const lang = fence[1] ?? '';
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? '')) {
        buf.push(lines[i] ?? '');
        i++;
      }
      i++;
      const langLabel = lang
        ? `<div class="mb-1 text-xs font-mono uppercase" style="color:var(--fg-3)">${escapeHtml(lang)}</div>`
        : '';
      const codeContent = lang ? highlightBlock(buf.join('\n'), lang, theme) : escapeHtml(buf.join('\n'));
      out.push(
        `<pre class="my-2 overflow-x-auto rounded-[6px] p-3 font-mono text-sm leading-snug" style="background:var(--gray-2);border:1px solid var(--gray-a4)">${langLabel}<code>${codeContent}</code></pre>`,
      );
      continue;
    }

    // HTML block tags — pass through verbatim (DOMPurify sanitizes)
    if (HTML_BLOCK_RE.test(line.trim())) {
      flushPara();
      const htmlBuf: string[] = [];
      let depth = 0;
      while (i < lines.length) {
        const cur = lines[i] ?? '';
        htmlBuf.push(cur);
        i++;
        const opens = cur.match(/<(?:details|div|table|ul|ol|section|article|blockquote)[\s>]/gi);
        const closes = cur.match(/<\/(?:details|div|table|ul|ol|section|article|blockquote)>/gi);
        if (opens) depth += opens.length;
        if (closes) depth -= closes.length;
        if (depth <= 0 && htmlBuf.length > 0) {
          if (cur.trim() === '' || /<\/\w+>/.test(cur) || /<[^/][^>]*\/>/.test(cur)) break;
        }
        if (htmlBuf.length > 200) break;
      }
      out.push(htmlBuf.join('\n'));
      continue;
    }

    // Headings
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushPara();
      const level = heading[1]!.length;
      const sizes: Record<number, string> = {
        1: 'text-[1.25em] font-bold',
        2: 'text-[1.15em] font-bold',
        3: 'text-[1.05em] font-semibold',
        4: 'text-[1em] font-semibold',
        5: 'text-[0.95em] font-semibold',
        6: 'text-[0.9em] font-semibold',
      };
      out.push(
        `<h${level} class="mt-4 mb-2 ${sizes[level] ?? ''}" style="color:var(--fg-1)">${processInline(heading[2]!)}</h${level}>`,
      );
      i++;
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}\s*$/.test(line)) {
      flushPara();
      out.push('<hr class="my-3 border-t" style="border-color:var(--gray-a4)" />');
      i++;
      continue;
    }

    // Blockquotes
    const bq = line.match(/^>\s?(.*)$/);
    if (bq) {
      flushPara();
      const buf: string[] = [bq[1] ?? ''];
      i++;
      while (i < lines.length) {
        const m = (lines[i] ?? '').match(/^>\s?(.*)$/);
        if (!m) break;
        buf.push(m[1] ?? '');
        i++;
      }
      out.push(
        `<blockquote class="my-2 border-l-[3px] pl-3 italic" style="border-color:var(--gray-a5);color:var(--fg-2)">${processInline(buf.join(' '))}</blockquote>`,
      );
      continue;
    }

    // Tables
    if (line.includes('|') && line.trim().startsWith('|')) {
      flushPara();
      const tableRows: string[][] = [];
      let hasSeparator = false;
      while (i < lines.length) {
        const cur = (lines[i] ?? '').trim();
        if (!cur.startsWith('|')) break;
        const cells = cur
          .split('|')
          .slice(1, -1)
          .map((c) => c.trim());
        if (/^[-:|]+$/.test(cells.join(''))) {
          hasSeparator = true;
          i++;
          continue;
        }
        tableRows.push(cells);
        i++;
      }
      if (tableRows.length > 0) {
        let tableHtml = '<table class="my-2 w-full text-sm" style="border-collapse:collapse">';
        const headerRow = hasSeparator ? tableRows.shift() : null;
        if (headerRow) {
          tableHtml += '<thead><tr>';
          for (const cell of headerRow) {
            tableHtml += `<th class="px-3 py-1.5 text-left font-semibold" style="color:var(--fg-1);border-bottom:2px solid var(--gray-a4)">${processInline(cell)}</th>`;
          }
          tableHtml += '</tr></thead>';
        }
        tableHtml += '<tbody>';
        for (const row of tableRows) {
          tableHtml += '<tr>';
          for (const cell of row) {
            tableHtml += `<td class="px-3 py-1.5" style="color:var(--fg-2);border-bottom:1px solid var(--gray-a3)">${processInline(cell)}</td>`;
          }
          tableHtml += '</tr>';
        }
        tableHtml += '</tbody></table>';
        out.push(tableHtml);
      }
      continue;
    }

    // Unordered/ordered lists and checklists
    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      flushPara();
      const isOrdered = /^\d+\./.test(listMatch[2]!);
      const tag = isOrdered ? 'ol' : 'ul';
      const listClass = isOrdered ? 'my-2 list-decimal pl-6 space-y-1' : 'my-2 list-disc pl-6 space-y-1';
      const items: string[] = [];
      while (i < lines.length) {
        const cur = lines[i] ?? '';
        const m = cur.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
        if (!m) break;
        let content = m[3] ?? '';
        const checkbox = content.match(/^\[([ xX])\]\s*(.*)/);
        if (checkbox) {
          const checked = checkbox[1] !== ' ';
          content = `<span class="inline-flex items-center gap-1.5">${checked ? '<span style="color:var(--green-11)">&#9745;</span>' : '<span style="color:var(--fg-3)">&#9744;</span>'} ${processInline(checkbox[2] ?? '')}</span>`;
        } else {
          content = processInline(content);
        }
        items.push(`<li>${content}</li>`);
        i++;
      }
      out.push(`<${tag} class="${listClass}" style="color:var(--fg-1)">${items.join('')}</${tag}>`);
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      flushPara();
      i++;
      continue;
    }

    // Regular text paragraph
    para.push(line);
    i++;
  }
  flushPara();

  return out.join('');
}

export function Markdown({ source }: Props) {
  const theme = useResolvedTheme();
  useHighlighter();

  const rawHtml = renderMarkdown(source, theme);
  const safeHtml = DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    ADD_TAGS: ['details', 'summary', 'sub', 'sup'],
    ADD_ATTR: ['style', 'class', 'open', 'align'],
  });
  return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: safeHtml }} />;
}
