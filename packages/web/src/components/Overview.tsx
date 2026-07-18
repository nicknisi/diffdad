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

/**
 * One unanchored-finding row: severity dot · observation · resolve toggle. Only `missing`-style
 * items render here — anchored findings live inline at their hunks, never in the pane.
 */
function FindingRow({ id, question, severity }: { id: string; question: string; severity: ResolveItem['severity'] }) {
  const resolved = useReviewStore((s) => !!s.resolved[id]);
  const setResolved = useReviewStore((s) => s.setResolved);
  const sev = SEVERITY[severity];

  return (
    <li className="flex items-start gap-2.5 py-[5px]" style={{ opacity: resolved ? 0.55 : 1 }}>
      <span className="mt-[6px] h-[7px] w-[7px] flex-shrink-0 rounded-full" style={{ background: sev.color }} />
      <span
        className={`min-w-0 flex-1 text-[13.5px] leading-[19px] text-[var(--fg-1)] ${resolved ? 'line-through' : ''}`}
      >
        {question}
      </span>
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
 * verdict + tldr (plain text, never collapsible), an open-findings COUNT, and the chapter table,
 * which IS the reading plan (planner order = risk descending). Everything below is drill-down.
 *
 * Anchored findings deliberately do NOT list here: a Socratic question is meaningless away from
 * its hunk (and a toggle up here would invite resolving without reading the code), so they render
 * only inline at their anchors — the Overview carries their aggregate signal (count + per-chapter
 * dots). Unanchored `missing` items are the exception: self-contained observations about absence
 * with no inline home, so they stay listed.
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

  // Unanchored `missing` entries — the only findings listed in the pane (see docblock).
  type DigestItem = { id: string; question: string; severity: ResolveItem['severity'] };
  const missingItems: DigestItem[] = [];
  const seenIds = new Set<string>();
  for (const text of narrative.missing ?? []) {
    // Suffix duplicates so React keys stay unique even if the LLM repeats a missing item.
    let id = findingKey(undefined, text);
    for (let n = 2; seenIds.has(id); n++) id = `${findingKey(undefined, text)}~${n}`;
    seenIds.add(id);
    missingItems.push({ id, question: text, severity: 'info' });
  }

  // Aggregate signal for the anchored findings that render inline at their hunks.
  const anchoredItems = (walkthrough?.beats ?? []).flatMap((b) => b.resolve);
  const openAnchored = anchoredItems.filter((i) => !resolved[i.id]);
  const orphanOpen = openAnchored.filter((i) => i.chapterIndex < 0).length;
  const maxOpenSeverity = openAnchored.reduce<ResolveItem['severity']>(
    (max, i) => (SEVERITY_RANK[i.severity] > SEVERITY_RANK[max] ? i.severity : max),
    'info',
  );

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

      {anchoredItems.length > 0 &&
        (openAnchored.length > 0 ? (
          <p className="m-0 mt-2 flex items-center gap-2 text-[13px] font-medium text-[var(--fg-1)]">
            <span
              className="h-[7px] w-[7px] flex-shrink-0 rounded-full"
              style={{ background: SEVERITY[maxOpenSeverity].color }}
            />
            {openAnchored.length} to resolve
            <span className="font-normal text-[var(--fg-3)]">— flagged inline at the code</span>
          </p>
        ) : (
          <p className="m-0 mt-2 text-[13px] text-[var(--fg-3)]">
            <span style={{ color: 'var(--green-11)' }}>✓</span> all {anchoredItems.length}{' '}
            {anchoredItems.length === 1 ? 'finding' : 'findings'} resolved
          </p>
        ))}

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
            {orphanOpen > 0 && (
              <li>
                <button
                  type="button"
                  onClick={() => jumpTo('other', setActiveChapter)}
                  className="flex w-full cursor-pointer items-baseline gap-2.5 rounded-md bg-transparent px-1.5 py-[5px] text-left transition-colors hover:bg-[var(--gray-2)]"
                >
                  <span className="w-4 flex-shrink-0 text-right font-mono text-[11px] text-[var(--fg-3)]">·</span>
                  <span className="flex-shrink-0 text-[13.5px] font-semibold text-[var(--fg-2)]">Other</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--fg-3)]">
                    concerns not tied to a chapter
                  </span>
                  <span
                    className="flex-shrink-0 text-[11.5px] font-semibold tabular-nums"
                    style={{ color: SEVERITY.info.color }}
                  >
                    ● {orphanOpen}
                  </span>
                  <span className="w-3 flex-shrink-0" />
                </button>
              </li>
            )}
          </ol>
        </div>
      )}

      {missingItems.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--fg-3)]">Also flagged</div>
          <ul className="m-0 list-none p-0">
            {missingItems.map((item) => (
              <FindingRow key={item.id} {...item} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
