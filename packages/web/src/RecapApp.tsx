import { useEffect } from 'react';
import { useReviewStore } from './state/review-store';
import { useRecap } from './hooks/useRecap';
import type { Blocker, BlockerType, Decision, DecisionSourceType } from './state/recap-types';

const SOURCE_LABEL: Record<DecisionSourceType, string> = {
  commit: 'commit',
  thread: 'review thread',
  'pr-body': 'PR body',
  'force-push': 'force-push',
  issue: 'linked issue',
};

const BLOCKER_STYLE: Record<BlockerType, { dot: string; label: string; tone: string }> = {
  ci: { dot: 'var(--red-9)', label: 'CI', tone: 'var(--red-11)' },
  'review-question': { dot: 'var(--amber-9)', label: 'Review', tone: 'var(--amber-11)' },
  thrash: { dot: 'var(--amber-9)', label: 'Thrash', tone: 'var(--amber-11)' },
  todo: { dot: 'var(--gray-9)', label: 'TODO', tone: 'var(--fg-2)' },
};

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="mb-3 mt-8 font-semibold tracking-tight text-[var(--fg-1)]"
      style={{ fontSize: '15px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--fg-2)' }}
    >
      {children}
    </h2>
  );
}

function Bullets({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-[var(--fg-3)]">—</p>;
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2 text-[14.5px] text-[var(--fg-1)]">
          <span aria-hidden className="select-none text-[var(--fg-3)]">
            •
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function DecisionCard({ d }: { d: Decision }) {
  return (
    <li
      className="rounded-lg p-4"
      style={{ background: 'var(--bg-panel)', boxShadow: 'inset 0 0 0 1px var(--gray-a4)' }}
    >
      <div className="text-[15px] font-semibold text-[var(--fg-1)]">{d.decision}</div>
      {d.reason && <div className="mt-1 text-[14px] text-[var(--fg-2)]">{d.reason}</div>}
      {d.alternativesRuledOut && d.alternativesRuledOut.length > 0 && (
        <div className="mt-2 text-[13.5px] text-[var(--fg-2)]">
          <span className="text-[var(--fg-3)]">Ruled out: </span>
          {d.alternativesRuledOut.join(', ')}
        </div>
      )}
      <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-[var(--gray-3)] px-2 py-0.5 font-mono text-[11.5px] text-[var(--fg-2)]">
        <span className="text-[var(--fg-3)]">{SOURCE_LABEL[d.source.type]}</span>
        {d.source.ref && <span className="text-[var(--fg-1)]">{d.source.ref}</span>}
      </div>
    </li>
  );
}

function BlockerCard({ b }: { b: Blocker }) {
  const s = BLOCKER_STYLE[b.type];
  return (
    <li
      className="rounded-lg p-4"
      style={{ background: 'var(--bg-panel)', boxShadow: 'inset 0 0 0 1px var(--gray-a4)' }}
    >
      <div className="flex items-start gap-3">
        <span aria-hidden className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: s.dot }} />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[15px] font-semibold text-[var(--fg-1)]">{b.issue}</span>
            <span
              className="rounded-md px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wider"
              style={{ background: 'var(--gray-3)', color: s.tone }}
            >
              {s.label}
            </span>
          </div>
          {b.evidence && <div className="mt-1 text-[13.5px] text-[var(--fg-2)]">{b.evidence}</div>}
        </div>
      </div>
    </li>
  );
}

export default function RecapApp() {
  const theme = useReviewStore((s) => s.theme);
  const { recap, pr, repoUrl, loading, generating, error } = useRecap();

  useEffect(() => {
    if (pr) document.title = `Recap #${pr.number} — ${pr.title}`;
  }, [pr]);

  useEffect(() => {
    const applyTheme = () => {
      const resolved =
        theme === 'auto' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
      document.documentElement.classList.toggle('dark', resolved === 'dark');
    };
    applyTheme();
    if (theme === 'auto') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener('change', applyTheme);
      return () => mq.removeEventListener('change', applyTheme);
    }
  }, [theme]);

  if (loading && !pr) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--bg-page)] text-[var(--fg-2)]">
        <p className="text-base">Loading recap…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--bg-page)] text-[var(--fg-2)]">
        <div className="text-center">
          <p className="text-base">Could not load recap</p>
          <p className="mt-2 text-sm text-[var(--fg-3)]">{error}</p>
        </div>
      </main>
    );
  }

  const prUrl = pr && repoUrl ? `${repoUrl}/pull/${pr.number}` : null;

  return (
    <div className="min-h-screen bg-[var(--bg-page)] pb-20 text-[var(--fg-1)]">
      <header
        className="sticky top-0 z-20 bg-[var(--bg-panel)] px-6 py-4"
        style={{ boxShadow: 'inset 0 -1px 0 var(--gray-a4)' }}
      >
        <div className="mx-auto max-w-[820px]">
          <div className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-[var(--fg-3)]">Recap</div>
          {pr && (
            <h1 className="mt-1 text-[22px] font-bold leading-tight tracking-tight text-[var(--fg-1)]">
              {prUrl ? (
                <a
                  href={prUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mr-2 font-normal text-[var(--fg-3)] hover:text-[var(--brand)]"
                >
                  #{pr.number}
                </a>
              ) : (
                <span className="mr-2 font-normal text-[var(--fg-3)]">#{pr.number}</span>
              )}
              {pr.title}
            </h1>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-[820px] px-6 pt-8">
        {!recap || generating ? (
          <div className="rounded-lg p-6 text-center text-[var(--fg-2)]" style={{ background: 'var(--bg-panel)' }}>
            <p className="text-base">Gathering decisions and blockers from your branch…</p>
            <p className="mt-2 text-sm text-[var(--fg-3)]">
              Mining commits, force-pushes, review threads, and CI for context. This usually takes 20–60s.
            </p>
          </div>
        ) : (
          <>
            <section>
              <SectionHeader>Goal</SectionHeader>
              <p className="text-[16px] leading-relaxed text-[var(--fg-1)]">{recap.goal || '—'}</p>
            </section>

            <section>
              <SectionHeader>State of play</SectionHeader>
              <div className="grid gap-5 md:grid-cols-3">
                <div>
                  <div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--green-11)]">
                    Done
                  </div>
                  <Bullets items={recap.stateOfPlay.done} />
                </div>
                <div>
                  <div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--amber-11)]">
                    WIP
                  </div>
                  <Bullets items={recap.stateOfPlay.wip} />
                </div>
                <div>
                  <div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--fg-3)]">
                    Not started
                  </div>
                  <Bullets items={recap.stateOfPlay.notStarted} />
                </div>
              </div>
            </section>

            <section>
              <SectionHeader>Decisions & alternatives ruled out</SectionHeader>
              {recap.decisions.length === 0 ? (
                <p className="text-sm text-[var(--fg-3)]">
                  No surfaced decisions. The branch may not have meaningful redirections yet.
                </p>
              ) : (
                <ul className="space-y-3">
                  {recap.decisions.map((d, i) => (
                    <DecisionCard key={i} d={d} />
                  ))}
                </ul>
              )}
            </section>

            <section>
              <SectionHeader>Where it&rsquo;s stuck</SectionHeader>
              {recap.blockers.length === 0 ? (
                <p className="text-sm text-[var(--fg-3)]">No blockers detected.</p>
              ) : (
                <ul className="space-y-3">
                  {recap.blockers.map((b, i) => (
                    <BlockerCard key={i} b={b} />
                  ))}
                </ul>
              )}
            </section>

            <section>
              <SectionHeader>Mental model</SectionHeader>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--fg-3)]">
                    Core files
                  </div>
                  <Bullets items={recap.mentalModel.coreFiles} />
                </div>
                <div>
                  <div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--fg-3)]">
                    Touchpoints
                  </div>
                  <Bullets items={recap.mentalModel.touchpoints} />
                </div>
              </div>
              {recap.mentalModel.sketch && (
                <pre
                  className="mt-4 overflow-x-auto rounded-lg p-4 font-mono text-[12.5px] leading-relaxed text-[var(--fg-1)]"
                  style={{ background: 'var(--bg-panel)', boxShadow: 'inset 0 0 0 1px var(--gray-a4)' }}
                >
                  {recap.mentalModel.sketch}
                </pre>
              )}
            </section>

            <section>
              <SectionHeader>How to help</SectionHeader>
              {recap.howToHelp.length === 0 ? (
                <p className="text-sm text-[var(--fg-3)]">—</p>
              ) : (
                <ol className="space-y-3">
                  {recap.howToHelp.map((h, i) => (
                    <li
                      key={i}
                      className="rounded-lg p-4"
                      style={{ background: 'var(--bg-panel)', boxShadow: 'inset 0 0 0 1px var(--gray-a4)' }}
                    >
                      <div className="text-[15px] font-semibold text-[var(--fg-1)]">{h.suggestion}</div>
                      {h.why && <div className="mt-1 text-[14px] text-[var(--fg-2)]">{h.why}</div>}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
