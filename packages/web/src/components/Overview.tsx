import { useReviewStore } from '../state/review-store';
import { useWalkthrough } from '../hooks/useWalkthrough';
import { findingKey } from '../lib/walkthrough';
import type { ResolveItem } from '../lib/walkthrough';
import { SEVERITY } from '../lib/severity';

const VERDICT_CONFIG = {
  safe: { accent: 'var(--green-9)', textColor: 'var(--green-11)', label: 'Safe to merge', icon: '✓' },
  caution: { accent: 'var(--yellow-9)', textColor: 'var(--yellow-11)', label: 'Review with care', icon: '⚠' },
  risky: { accent: 'var(--red-9)', textColor: 'var(--red-11)', label: 'Risky — needs close review', icon: '✗' },
} as const;

const SEVERITY_RANK: Record<ResolveItem['severity'], number> = { risk: 2, warn: 1, info: 0 };

function firstSentence(text: string): string {
  const m = text.match(/^.*?[.!?](?=\s|$)/);
  return m ? m[0] : text;
}

function jumpTo(chid: string, setActiveChapter: (id: string) => void) {
  setActiveChapter(chid);
  const el = document.querySelector(`[data-chid="${chid}"]`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** One digest row: severity dot · question (click = jump to its chapter) · anchor · resolve toggle. */
function FindingRow({
  id,
  question,
  severity,
  anchor,
  jumpChid,
}: {
  id: string;
  question: string;
  severity: ResolveItem['severity'];
  anchor?: string;
  jumpChid?: string;
}) {
  const resolved = useReviewStore((s) => !!s.resolved[id]);
  const setResolved = useReviewStore((s) => s.setResolved);
  const setActiveChapter = useReviewStore((s) => s.setActiveChapter);
  const sev = SEVERITY[severity];

  return (
    <li className="flex items-start gap-2.5 py-[5px]" style={{ opacity: resolved ? 0.55 : 1 }}>
      <span className="mt-[6px] h-[7px] w-[7px] flex-shrink-0 rounded-full" style={{ background: sev.color }} />
      {jumpChid ? (
        <button
          type="button"
          onClick={() => jumpTo(jumpChid, setActiveChapter)}
          className={`min-w-0 flex-1 cursor-pointer bg-transparent text-left text-[13.5px] leading-[19px] text-[var(--fg-1)] hover:underline ${resolved ? 'line-through' : ''}`}
        >
          {question}
        </button>
      ) : (
        <span
          className={`min-w-0 flex-1 text-[13.5px] leading-[19px] text-[var(--fg-1)] ${resolved ? 'line-through' : ''}`}
        >
          {question}
        </span>
      )}
      {anchor && <span className="mt-[2px] flex-shrink-0 font-mono text-[11px] text-[var(--fg-3)]">{anchor}</span>}
      <button
        type="button"
        onClick={() => setResolved(id, !resolved)}
        title={resolved ? 'Undo' : 'Mark resolved'}
        aria-label={resolved ? `Undo resolving: ${question}` : `Mark resolved: ${question}`}
        className="mt-[1px] flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-full text-[11px] transition-colors"
        style={
          resolved
            ? { background: 'var(--green-9)', color: '#fff' }
            : { boxShadow: 'inset 0 0 0 1px var(--gray-a6)', color: 'transparent' }
        }
        onMouseEnter={(e) => {
          if (!resolved) e.currentTarget.style.color = 'var(--fg-3)';
        }}
        onMouseLeave={(e) => {
          if (!resolved) e.currentTarget.style.color = 'transparent';
        }}
      >
        ✓
      </button>
    </li>
  );
}

/**
 * The story's first screen — the 30-second orientation the reviewer reads before any prose:
 * verdict + tldr (plain text, never collapsible), the findings digest (every open question with
 * a resolve toggle and a jump to its chapter), and the chapter table, which IS the reading plan
 * (planner order = risk descending). Everything below it is drill-down.
 */
export function Overview() {
  const narrative = useReviewStore((s) => s.narrative);
  const chapterStates = useReviewStore((s) => s.chapterStates);
  const resolved = useReviewStore((s) => s.resolved);
  const setActiveChapter = useReviewStore((s) => s.setActiveChapter);
  const pendingChapterThemeIds = useReviewStore((s) => s.pendingChapterThemeIds);
  const walkthrough = useWalkthrough();

  if (!narrative || (!narrative.verdict && !narrative.tldr && narrative.chapters.length === 0)) return null;

  const config = VERDICT_CONFIG[narrative.verdict ?? 'caution'];
  const chapters = narrative.chapters;

  // Digest = every walkthrough resolve item (chapter order), severity-ranked, then the narrative's
  // `missing` entries as unanchored info rows. Open items sort above resolved ones.
  type DigestItem = {
    id: string;
    question: string;
    severity: ResolveItem['severity'];
    anchor?: string;
    jumpChid?: string;
  };
  const items: DigestItem[] = (walkthrough?.beats ?? []).flatMap((beat) =>
    beat.resolve.map((item) => ({
      id: item.id,
      question: item.question,
      severity: item.severity,
      anchor: item.file ? `${item.file}${item.line != null ? `:${item.line}` : ''}` : undefined,
      jumpChid: beat.id,
    })),
  );
  const seenIds = new Set(items.map((i) => i.id));
  for (const text of narrative.missing ?? []) {
    // Suffix duplicates so React keys stay unique even if the LLM repeats a missing item.
    let id = findingKey(undefined, text);
    for (let n = 2; seenIds.has(id); n++) id = `${findingKey(undefined, text)}~${n}`;
    seenIds.add(id);
    items.push({ id, question: text, severity: 'info' });
  }
  items.sort((a, b) => {
    const openDelta = Number(!!resolved[a.id]) - Number(!!resolved[b.id]);
    if (openDelta !== 0) return openDelta;
    return SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  });
  const openCount = items.filter((i) => !resolved[i.id]).length;

  // Per-chapter open-finding counts drive the table's severity dots.
  const openByChapter = new Map<number, { count: number; severity: ResolveItem['severity'] }>();
  for (const beat of walkthrough?.beats ?? []) {
    for (const item of beat.resolve) {
      if (resolved[item.id] || beat.chapterIndex < 0) continue;
      const cur = openByChapter.get(beat.chapterIndex);
      openByChapter.set(beat.chapterIndex, {
        count: (cur?.count ?? 0) + 1,
        severity: cur && SEVERITY_RANK[cur.severity] >= SEVERITY_RANK[item.severity] ? cur.severity : item.severity,
      });
    }
  }

  return (
    <section
      className="mb-7 rounded-[10px] bg-[var(--bg-panel)] px-5 py-4"
      style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a5)', borderTop: `3px solid ${config.accent}` }}
    >
      <div className="flex items-center gap-2">
        <span className="text-[15px]" style={{ color: config.textColor }}>
          {config.icon}
        </span>
        <b className="text-[14.5px] font-bold" style={{ color: config.textColor }}>
          {config.label}
        </b>
      </div>
      {narrative.tldr && (
        <p className="m-0 mt-1 text-[14px] leading-[21px] text-[var(--fg-1)]" style={{ textWrap: 'pretty' }}>
          {narrative.tldr}
        </p>
      )}

      {items.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--fg-3)]">
            Findings{openCount > 0 ? ` · ${openCount} open` : ' · all resolved'}
          </div>
          <ul className="m-0 list-none p-0">
            {items.map((item) => (
              <FindingRow key={item.id} {...item} />
            ))}
          </ul>
        </div>
      )}

      {chapters.length > 1 && (
        <div className="mt-4">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--fg-3)]">Chapters</div>
          <ol className="m-0 list-none p-0">
            {chapters.map((ch, idx) => {
              const chid = `ch-${idx}`;
              const reviewed = chapterStates[chid] === 'reviewed';
              const open = openByChapter.get(idx);
              const hunkCount = ch.sections.filter((s) => s.type === 'diff').length;
              const writing = !!ch.themeId && pendingChapterThemeIds.has(ch.themeId);
              return (
                <li key={chid}>
                  <button
                    type="button"
                    onClick={() => jumpTo(chid, setActiveChapter)}
                    className="flex w-full cursor-pointer items-baseline gap-2.5 rounded-md bg-transparent px-1.5 py-[5px] text-left transition-colors hover:bg-[var(--gray-2)]"
                  >
                    <span className="w-4 flex-shrink-0 text-right font-mono text-[11px] text-[var(--fg-3)]">
                      {idx + 1}
                    </span>
                    <span className="flex-shrink-0 text-[13.5px] font-semibold text-[var(--fg-1)]">{ch.title}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--fg-3)]">
                      {writing ? 'writing…' : firstSentence(ch.summary ?? '')}
                    </span>
                    {open && (
                      <span
                        className="flex-shrink-0 text-[11.5px] font-semibold tabular-nums"
                        style={{ color: SEVERITY[open.severity].color }}
                      >
                        ● {open.count}
                      </span>
                    )}
                    <span className="flex-shrink-0 font-mono text-[11px] text-[var(--fg-3)]">
                      {hunkCount > 0 ? `${hunkCount}h` : ''}
                    </span>
                    <span
                      className="w-3 flex-shrink-0 text-[12px]"
                      style={{ color: reviewed ? 'var(--green-11)' : 'transparent' }}
                    >
                      ✓
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </section>
  );
}
