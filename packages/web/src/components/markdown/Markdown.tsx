import DOMPurify from "dompurify";
import { highlightLine } from "../../lib/shiki";
import { useReviewStore } from "../../state/review-store";
import { useHighlighter } from "../../hooks/useHighlighter";

type Props = {
  source: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(text: string): string {
  let out = text;
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  out = out.replace(
    /`([^`]+)`/g,
    '<code class="rounded bg-gray-100 px-1 py-0.5 font-mono text-[0.9em] dark:bg-gray-800">$1</code>',
  );
  out = out.replace(
    /(^|\s)@([\w-]+)/g,
    '$1<span class="rounded bg-brand/10 px-1.5 py-0.5 text-brand">@$2</span>',
  );
  out = out.replace(
    /([\w-]+\/[\w-]+#\d+)/g,
    '<a href="#" class="text-brand underline hover:no-underline">$1</a>',
  );
  return out;
}

function highlightBlock(code: string, lang: string, theme: "light" | "dark"): string {
  const lines = code.split("\n");
  return lines
    .map((line) => highlightLine(line, lang, theme) ?? escapeHtml(line))
    .join("\n");
}

function renderMarkdown(src: string, theme: "light" | "dark" = "light"): string {
  const lines = src.split(/\r?\n/);
  const out: string[] = [];
  let i = 0;
  let para: string[] = [];

  function flushPara() {
    if (para.length === 0) return;
    const joined = para.join(" ");
    out.push(
      `<p class="mb-3 text-base leading-relaxed text-gray-800 dark:text-gray-200">${renderInline(escapeHtml(joined))}</p>`,
    );
    para = [];
  }

  while (i < lines.length) {
    const line = lines[i] ?? "";
    const fence = line.match(/^```(\w*)\s*$/);
    if (fence) {
      flushPara();
      const lang = fence[1] ?? "";
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i] ?? "")) {
        buf.push(lines[i] ?? "");
        i++;
      }
      i++;
      const langLabel = lang
        ? `<div class="mb-1 text-xs font-mono uppercase text-gray-400">${escapeHtml(lang)}</div>`
        : "";
      const codeContent = lang
        ? highlightBlock(buf.join("\n"), lang, theme)
        : escapeHtml(buf.join("\n"));
      out.push(
        `<pre class="my-2 overflow-x-auto rounded-md border border-gray-200 bg-gray-50 p-3 font-mono text-sm leading-snug dark:border-gray-800 dark:bg-gray-900">${langLabel}<code>${codeContent}</code></pre>`,
      );
      continue;
    }

    const bq = line.match(/^>\s?(.*)$/);
    if (bq) {
      flushPara();
      const buf: string[] = [bq[1] ?? ""];
      i++;
      while (i < lines.length) {
        const m = (lines[i] ?? "").match(/^>\s?(.*)$/);
        if (!m) break;
        buf.push(m[1] ?? "");
        i++;
      }
      out.push(
        `<blockquote class="my-2 border-l-[3px] border-gray-300 pl-3 italic text-gray-600 dark:border-gray-600 dark:text-gray-400">${renderInline(escapeHtml(buf.join(" ")))}</blockquote>`,
      );
      continue;
    }

    if (line.trim() === "") {
      flushPara();
      i++;
      continue;
    }

    para.push(line);
    i++;
  }
  flushPara();

  return out.join("");
}

export function Markdown({ source }: Props) {
  const theme = useReviewStore((s) => s.theme);
  useHighlighter();

  const rawHtml = renderMarkdown(source, theme);
  const safeHtml = DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ["style"],
  });
  return (
    <div
      className="markdown-body"
      // eslint-disable-next-line react/no-danger -- safeHtml is sanitized via DOMPurify above
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
}
