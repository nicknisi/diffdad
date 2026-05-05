import { useEffect, useState } from 'react';
import { useReviewStore } from '../state/review-store';
import { useRecapLazy } from '../hooks/useRecapLazy';
import type { Blocker, BlockerType, Decision, DecisionSourceType } from '../state/recap-types';
import { DadMark } from './DadMark';
import { getAccentMeta } from '../lib/accents';

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

// Source phases mined as the recap is built. Timings drive the "magical" feel
// of the loading screen — the LLM doesn't actually report phase progress, but
// the GitHub fetches really do happen in this order, and the LLM synthesis is
// the long pole. The last phase sticks until the response arrives.
type Phase = { id: string; label: string; flavor: string[]; minMs: number };

const PHASES: Phase[] = [
  {
    id: 'description',
    label: 'Reading the PR description',
    flavor: ['What did past-you say this was for?', 'Looking for the why.'],
    minMs: 1500,
  },
  {
    id: 'commits',
    label: 'Walking the commit history',
    flavor: ['Reading the trail you left.', 'Some of these commits I will not unsee.', 'Following the breadcrumbs.'],
    minMs: 2500,
  },
  {
    id: 'force-pushes',
    label: 'Tracing force-pushes',
    flavor: ['Spotting redirections, ignoring rebases.', 'What did you try first?'],
    minMs: 1800,
  },
  {
    id: 'threads',
    label: 'Listening in on review threads',
    flavor: ['Reviewer asked. Author replied. Then what?', 'Catching the conversation drift.'],
    minMs: 2200,
  },
  {
    id: 'issues',
    label: 'Pulling linked issues',
    flavor: ['Going back to the source.', 'Why are we here, again?'],
    minMs: 1500,
  },
  {
    id: 'synthesis',
    label: 'Synthesizing decisions',
    flavor: [
      'Connecting the dots.',
      'Putting the pieces together.',
      'Finding the story you forgot you were telling.',
      'Hold on, son, this is good.',
    ],
    minMs: 99999, // sticks until the response arrives
  },
];

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="mb-3 mt-8 font-semibold tracking-tight"
      style={{ fontSize: '13px', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-3)' }}
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

function PhaseRow({
  phase,
  state,
  flavorIndex,
}: {
  phase: Phase;
  state: 'pending' | 'active' | 'done';
  flavorIndex: number;
}) {
  const flavor = phase.flavor[flavorIndex % phase.flavor.length] ?? '';
  return (
    <li className="recap-phase-in flex items-start gap-3">
      <span className="mt-[7px] flex h-3 w-3 shrink-0 items-center justify-center" aria-hidden>
        {state === 'done' ? (
          <svg viewBox="0 0 12 12" className="h-3 w-3" style={{ color: 'var(--green-11)' }}>
            <path
              d="M2 6 L5 9 L10 3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : state === 'active' ? (
          <span className="recap-pulse h-2 w-2 rounded-full" style={{ background: 'var(--purple-9)' }} />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: 'var(--gray-a5)' }} />
        )}
      </span>
      <div className="flex-1">
        <div
          className="text-[14px] font-medium"
          style={{
            color: state === 'pending' ? 'var(--fg-3)' : 'var(--fg-1)',
            fontWeight: state === 'active' ? 600 : 500,
          }}
        >
          {phase.label}
        </div>
        {state === 'active' && (
          <div
            className="mt-0.5 text-[12.5px] italic text-[var(--fg-3)]"
            style={{ animation: 'generating-fade 2.5s ease-in-out infinite' }}
          >
            {flavor}
          </div>
        )}
      </div>
    </li>
  );
}

function MagicalLoading() {
  const accent = useReviewStore((s) => s.accent);
  const { markBg } = getAccentMeta(accent);
  const [activeIdx, setActiveIdx] = useState(0);
  const [flavorIdx, setFlavorIdx] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timeId = setInterval(() => setElapsedMs(Date.now() - startedAt), 500);
    return () => clearInterval(timeId);
  }, []);

  useEffect(() => {
    if (activeIdx >= PHASES.length - 1) return;
    const phase = PHASES[activeIdx]!;
    const t = setTimeout(() => setActiveIdx((i) => i + 1), phase.minMs);
    return () => clearTimeout(t);
  }, [activeIdx]);

  useEffect(() => {
    const id = setInterval(() => setFlavorIdx((i) => i + 1), 2800);
    return () => clearInterval(id);
  }, []);

  const elapsedLabel = (() => {
    const s = Math.floor(elapsedMs / 1000);
    const m = Math.floor(s / 60);
    return m > 0 ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
  })();

  return (
    <div
      className="overflow-hidden rounded-2xl"
      style={{
        background:
          'radial-gradient(circle at 18% 0%, var(--purple-3), transparent 55%), radial-gradient(circle at 100% 100%, var(--green-3), transparent 50%), var(--bg-panel)',
        boxShadow: 'inset 0 0 0 1px var(--gray-a4)',
      }}
    >
      <div className="flex flex-col items-center gap-4 px-6 pt-9 pb-2 text-center">
        <div style={{ animation: 'generating-bob 2.6s ease-in-out infinite' }}>
          <DadMark size={56} bg={markBg} shape="circle" showBadge={false} showWink />
        </div>
        <div>
          <div className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-[var(--fg-3)]">Recap</div>
          <h2 className="mt-1 text-[20px] font-bold tracking-tight text-[var(--fg-1)]">Digging through your branch</h2>
          <p className="mt-1 text-[13.5px] text-[var(--fg-2)]">
            Mining commits, force-pushes, and review threads for context.
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-[440px] px-6 pt-4 pb-6">
        <ol className="space-y-3">
          {PHASES.map((p, i) => (
            <PhaseRow
              key={p.id}
              phase={p}
              state={i < activeIdx ? 'done' : i === activeIdx ? 'active' : 'pending'}
              flavorIndex={flavorIdx}
            />
          ))}
        </ol>

        <div className="mt-6 space-y-2">
          <div className="recap-shimmer h-3 w-2/3 rounded-md" />
          <div className="recap-shimmer h-3 w-5/6 rounded-md" />
          <div className="recap-shimmer h-3 w-1/2 rounded-md" />
        </div>

        <div className="mt-4 text-center text-[11.5px] tabular-nums text-[var(--fg-3)]">
          {elapsedLabel} elapsed · usually 20–60s
        </div>
      </div>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div
      className="rounded-lg p-6 text-center"
      style={{ background: 'var(--bg-panel)', boxShadow: 'inset 0 0 0 1px var(--gray-a4)' }}
    >
      <p className="text-[14.5px] text-[var(--fg-1)]">Recap couldn&rsquo;t generate</p>
      <p className="mt-1 text-[13px] text-[var(--fg-3)]">{error}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 inline-flex items-center rounded-md px-3 py-1.5 text-[13px] font-medium text-[var(--fg-1)] hover:bg-[var(--gray-3)]"
        style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a5)' }}
      >
        Try again
      </button>
    </div>
  );
}

export function RecapView() {
  const recap = useReviewStore((s) => s.recap);
  const status = useReviewStore((s) => s.recapStatus);
  const error = useReviewStore((s) => s.recapError);
  const { retry } = useRecapLazy();

  if (status === 'error' && error) {
    return (
      <main className="mx-auto max-w-[820px] px-6 pt-8">
        <ErrorState error={error} onRetry={retry} />
      </main>
    );
  }

  if (!recap) {
    return (
      <main className="mx-auto max-w-[820px] px-6 pt-8">
        <MagicalLoading />
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[820px] px-6 pt-8">
      <section>
        <SectionHeader>Goal</SectionHeader>
        <p className="text-[16px] leading-relaxed text-[var(--fg-1)]">{recap.goal || '—'}</p>
      </section>

      <section>
        <SectionHeader>State of play</SectionHeader>
        <div className="grid gap-5 md:grid-cols-3">
          <div>
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--green-11)]">Done</div>
            <Bullets items={recap.stateOfPlay.done} />
          </div>
          <div>
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--amber-11)]">WIP</div>
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
        <SectionHeader>Decisions &amp; alternatives ruled out</SectionHeader>
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
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--fg-3)]">Core files</div>
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
    </main>
  );
}
