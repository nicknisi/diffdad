import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";

let highlighter: HighlighterCore | null = null;
let loading: Promise<HighlighterCore> | null = null;

const COMMON_LANGS = [
  import("shiki/langs/typescript"),
  import("shiki/langs/javascript"),
  import("shiki/langs/tsx"),
  import("shiki/langs/jsx"),
  import("shiki/langs/json"),
  import("shiki/langs/css"),
  import("shiki/langs/html"),
  import("shiki/langs/python"),
  import("shiki/langs/ruby"),
  import("shiki/langs/go"),
  import("shiki/langs/rust"),
  import("shiki/langs/yaml"),
  import("shiki/langs/markdown"),
  import("shiki/langs/bash"),
  import("shiki/langs/sql"),
  import("shiki/langs/diff"),
];

export async function getHighlighter(): Promise<HighlighterCore> {
  if (highlighter) return highlighter;
  if (loading) return loading;

  loading = createHighlighterCore({
    themes: [import("shiki/themes/github-light"), import("shiki/themes/github-dark")],
    langs: COMMON_LANGS,
    engine: createOnigurumaEngine(import("shiki/wasm")),
  });

  highlighter = await loading;
  return highlighter;
}

export function highlightLine(
  code: string,
  lang: string,
  theme: "light" | "dark",
): string | null {
  if (!highlighter) return null;
  const themeName = theme === "dark" ? "github-dark" : "github-light";

  try {
    const tokens = highlighter.codeToTokens(code, { lang, theme: themeName });
    if (!tokens.tokens[0]) return null;

    return tokens.tokens[0]
      .map((t) => {
        const style = t.color ? ` style="color:${t.color}"` : "";
        return `<span${style}>${escapeHtml(t.content)}</span>`;
      })
      .join("");
  } catch {
    return null;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function guessLang(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
    json: "json", css: "css", html: "html", py: "python",
    rb: "ruby", go: "go", rs: "rust", yml: "yaml", yaml: "yaml",
    md: "markdown", sh: "bash", bash: "bash", sql: "sql",
  };
  return map[ext] ?? "typescript";
}
