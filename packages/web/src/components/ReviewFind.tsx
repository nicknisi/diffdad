import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useReviewStore } from '../state/review-store';
import {
  compileFindQuery,
  findInNarrative,
  regexMatches,
  wrapIndex,
  type FindMatch,
  type FindOptions,
} from '../lib/find';

const HIGHLIGHT_ALL = 'diffdad-find';
const HIGHLIGHT_ACTIVE = 'diffdad-find-active';
const FALLBACK_CLASS = 'diffdad-find-fallback';

type HighlightRegistry = {
  set(name: string, value: unknown): void;
  delete(name: string): void;
};

/** The CSS Custom Highlight API, or null when the browser (or test env) lacks it. */
function highlightApi(): { registry: HighlightRegistry; Highlight: new (...ranges: Range[]) => unknown } | null {
  const view = window as Window & {
    CSS?: { highlights?: HighlightRegistry };
    Highlight?: new (...ranges: Range[]) => unknown;
  };
  const registry = view.CSS?.highlights;
  return registry && view.Highlight ? { registry, Highlight: view.Highlight } : null;
}

function clearHighlights() {
  const api = highlightApi();
  api?.registry.delete(HIGHLIGHT_ALL);
  api?.registry.delete(HIGHLIGHT_ACTIVE);
  document.querySelectorAll(`.${FALLBACK_CLASS}`).forEach((el) => el.classList.remove(FALLBACK_CLASS));
}

/** Build DOM Ranges for every `expression` hit inside `root`, mapping char offsets back to text nodes. */
function rangesInElement(root: Element, expression: RegExp): Range[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number; end: number }[] = [];
  let text = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n as Text;
    const value = t.data;
    nodes.push({ node: t, start: text.length, end: text.length + value.length });
    text += value;
  }
  const pointAt = (offset: number): { node: Text; offset: number } | null => {
    for (const seg of nodes) {
      if (offset >= seg.start && offset <= seg.end) return { node: seg.node, offset: offset - seg.start };
    }
    return null;
  };
  const ranges: Range[] = [];
  for (const { start, end } of regexMatches(text, expression)) {
    const from = pointAt(start);
    const to = pointAt(end);
    if (!from || !to) continue;
    const range = document.createRange();
    range.setStart(from.node, from.offset);
    range.setEnd(to.node, to.offset);
    ranges.push(range);
  }
  return ranges;
}

function ToggleButton({
  label,
  active,
  error,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  error?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded-[5px] font-mono text-[11px] font-semibold transition-colors"
      style={
        active
          ? {
              background: error ? 'var(--red-3)' : 'var(--purple-3)',
              color: error ? 'var(--red-11)' : 'var(--purple-11)',
              boxShadow: `inset 0 0 0 1px ${error ? 'var(--red-a4)' : 'var(--purple-a4)'}`,
            }
          : { color: 'var(--fg-3)' }
      }
    >
      {children}
    </button>
  );
}

function ActionButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded-[5px] text-[13px] leading-none text-[var(--fg-3)] transition-colors hover:bg-[var(--gray-a3)] hover:text-[var(--fg-1)] disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function ReviewFind() {
  const narrative = useReviewStore((s) => s.narrative);
  const files = useReviewStore((s) => s.files);
  const revealChapter = useReviewStore((s) => s.revealChapter);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [regex, setRegex] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement | null>(null);

  const opts: FindOptions = useMemo(() => ({ matchCase, wholeWord, regex }), [matchCase, wholeWord, regex]);

  const { matches, error } = useMemo<{ matches: FindMatch[]; error: string | null }>(
    () => (open ? findInNarrative(narrative, files, query, opts) : { matches: [], error: null }),
    [open, narrative, files, query, opts],
  );

  // Compiled expression for the DOM highlighter (only when the query is valid and non-empty).
  const highlightExpr = useMemo(() => {
    if (!query) return null;
    const compiled = compileFindQuery(query, opts);
    return 'error' in compiled ? null : compiled.expression;
  }, [query, opts]);

  const close = useCallback(() => {
    setOpen(false);
    clearHighlights();
  }, []);

  // Global Cmd/Ctrl-F opens the widget when a narrative is loaded; preventDefault stops the browser's
  // own find, which would miss collapsed chapters.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'f' || e.key === 'F')) {
        if (!narrative) return;
        e.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        });
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [narrative]);

  // A fresh result set starts at the first match.
  useEffect(() => {
    setActiveIndex(0);
  }, [query, opts, narrative, files]);

  // Reveal + scroll + highlight the active match. Expanding a collapsed chapter is a store request the
  // Chapter reacts to; the scroll + highlight run on the next frame so the expanded DOM exists.
  useEffect(() => {
    if (!open) return;
    clearHighlights();
    const match = matches[activeIndex];
    if (!match || !highlightExpr) return;

    revealChapter(match.chid);
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector(`[data-chid="${match.chid}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });

      const api = highlightApi();
      if (!api) {
        // No Custom Highlight API: fall back to a temporary outline on the chapter element.
        el.classList.add(FALLBACK_CLASS);
        return;
      }
      // Highlight every match inside the visible active chapter; a second, brighter highlight marks the
      // single active one when it can be resolved to a specific range.
      const ranges = rangesInElement(el, highlightExpr);
      if (ranges.length === 0) return;
      api.registry.set(HIGHLIGHT_ALL, new api.Highlight(...ranges));
      // Position of the active match among this chapter's matches → which range to spotlight.
      const localRank = matches.filter((m, i) => m.chid === match.chid && i < activeIndex).length;
      const activeRange = ranges[localRank] ?? ranges[0]!;
      api.registry.set(HIGHLIGHT_ACTIVE, new api.Highlight(activeRange));
    });
    return () => cancelAnimationFrame(raf);
  }, [open, matches, activeIndex, highlightExpr, revealChapter]);

  // Clear highlights whenever the widget is closed or unmounts.
  useEffect(() => {
    if (!open) clearHighlights();
    return () => clearHighlights();
  }, [open]);

  const navigate = useCallback(
    (delta: number) => {
      if (matches.length === 0) return;
      setActiveIndex((i) => wrapIndex(i + delta, matches.length));
    },
    [matches.length],
  );

  if (!open || !narrative) return null;

  const total = matches.length;
  const countLabel = error
    ? 'Invalid regex'
    : !query
      ? ''
      : total === 0
        ? 'No results'
        : `${activeIndex + 1} of ${total}`;

  return (
    <div
      role="search"
      aria-label="Find in review"
      className="fixed right-4 top-[76px] z-50 flex items-center gap-1.5 rounded-[10px] px-2 py-1.5"
      style={{
        background: 'var(--bg-panel)',
        boxShadow: 'var(--shadow-elevated), inset 0 0 0 1px var(--gray-a5)',
      }}
    >
      <input
        ref={inputRef}
        aria-label="Find"
        aria-invalid={error ? 'true' : undefined}
        title={error ?? undefined}
        value={query}
        placeholder="Find in review"
        onChange={(e) => setQuery(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            close();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            navigate(e.shiftKey ? -1 : 1);
          }
        }}
        className="h-6 w-[180px] bg-transparent px-1.5 text-[13px] text-[var(--fg-1)] outline-none placeholder:text-[var(--fg-3)]"
        style={{ boxShadow: `inset 0 0 0 1px ${error ? 'var(--red-a4)' : 'var(--gray-a4)'}`, borderRadius: 6 }}
      />
      <div className="flex items-center gap-0.5">
        <ToggleButton label="Match case" active={matchCase} onClick={() => setMatchCase((v) => !v)}>
          Aa
        </ToggleButton>
        <ToggleButton label="Whole word" active={wholeWord} onClick={() => setWholeWord((v) => !v)}>
          ab
        </ToggleButton>
        <ToggleButton label="Use regular expression" active={regex} error={!!error} onClick={() => setRegex((v) => !v)}>
          .*
        </ToggleButton>
      </div>
      <span
        aria-live="polite"
        className="min-w-[60px] px-1 text-right text-[11.5px] tabular-nums"
        style={{ color: error ? 'var(--red-11)' : 'var(--fg-3)' }}
      >
        {countLabel}
      </span>
      <div className="flex items-center gap-0.5">
        <ActionButton label="Previous match (Shift+Enter)" disabled={total === 0} onClick={() => navigate(-1)}>
          ↑
        </ActionButton>
        <ActionButton label="Next match (Enter)" disabled={total === 0} onClick={() => navigate(1)}>
          ↓
        </ActionButton>
        <ActionButton label="Close (Esc)" onClick={close}>
          ✕
        </ActionButton>
      </div>
    </div>
  );
}
