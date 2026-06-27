import { useEffect, useState } from 'react';
import { getAccentMeta } from '../lib/accents';
import { copy } from '../lib/microcopy';
import { useReviewStore } from '../state/review-store';
import { postDecision, removeUnit, retryUnit, useUnits } from '../hooks/useUnits';
import { AccentPicker } from './AccentPicker';
import { DadMark } from './DadMark';
import { ThemeToggle } from './ThemeToggle';
import { UnitRow } from './UnitRow';
import type { Unit } from '../state/types';

const LIVE: Record<string, { label: string; dot: string; fg: string }> = {
  connected: { label: 'Live', dot: 'var(--green-10)', fg: 'var(--green-11)' },
  connecting: { label: 'Reconnecting…', dot: 'var(--amber-10)', fg: 'var(--amber-11)' },
  disconnected: { label: 'Offline', dot: 'var(--gray-9)', fg: 'var(--fg-3)' },
};

function GroupLabel({ title, count }: { title: string; count: number }) {
  return (
    <div className="mb-2 mt-6 flex items-baseline gap-2 px-1">
      <h2 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--fg-2)]">{title}</h2>
      <span className="text-[12px] tabular-nums text-[var(--fg-3)]">{count}</span>
    </div>
  );
}

/** A bordered panel with hairline separators between rows. */
function Panel({ children }: { children: React.ReactNode[] }) {
  return (
    <div
      className="overflow-hidden rounded-xl bg-[var(--bg-panel)]"
      style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a4)' }}
    >
      {children.map((row, i) => (
        <div key={i} style={i > 0 ? { boxShadow: 'inset 0 1px 0 var(--gray-a3)' } : undefined}>
          {row}
        </div>
      ))}
    </div>
  );
}

/**
 * The daemon's cross-repo home (self-contained shell, like WatchView — no PR-review chrome).
 * Status-grouped: Needs you (your queue) · In flight (agent/worker owns it) · Cleared (digest).
 * Live via the shared SSE stream; a row click drills into that unit's review.
 */
export function CommandCenter() {
  const { groups, repos, repoFilter, setRepoFilter, total, loaded } = useUnits();
  const navigate = useReviewStore((s) => s.navigate);
  const liveStatus = useReviewStore((s) => s.liveStatus);
  const accent = useReviewStore((s) => s.accent);
  const { markBg } = getAccentMeta(accent);
  const [now, setNow] = useState(() => Date.now());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCleared, setShowCleared] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const open = (unit: Unit) => navigate({ name: 'unit', unitId: unit.unitId });

  async function decide(unit: Unit, kind: 'approved' | 'changes_requested') {
    setBusyId(unit.unitId);
    setError(null);
    try {
      // The SSE `units` event moves the unit out of needs-you once recorded — no manual refetch.
      await postDecision(unit.unitId, {
        kind,
        concerns: kind === 'changes_requested' ? unit.narrative?.concerns : undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Decision failed');
    } finally {
      setBusyId(null);
    }
  }

  async function remove(unit: Unit) {
    setBusyId(unit.unitId);
    setError(null);
    try {
      await removeUnit(unit.unitId); // SSE `units` repaints the queue without it
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Remove failed');
    } finally {
      setBusyId(null);
    }
  }

  async function retry(unit: Unit) {
    setBusyId(unit.unitId);
    setError(null);
    try {
      const r = await retryUnit(unit.unitId);
      if (r.ok === false) {
        setError(
          r.reason === 'clean-tree' ? 'Nothing to re-review — that working tree is clean now.' : 'Could not retry.',
        );
      }
      // else: the unit flips back to reviewing via SSE and the worker picks it up again
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Retry failed');
    } finally {
      setBusyId(null);
    }
  }

  const live = LIVE[liveStatus] ?? LIVE.disconnected!;
  const rowProps = (unit: Unit) => ({ unit, now, busy: busyId === unit.unitId });

  return (
    <div className="min-h-screen bg-[var(--bg-page)] pb-20 text-[var(--fg-1)]">
      <header
        className="sticky top-0 z-30 flex items-center gap-3 bg-[var(--bg-panel)] px-6 py-3"
        style={{ boxShadow: 'inset 0 -1px 0 var(--gray-a4)' }}
      >
        {/* Brand mark — the daemon surface gets the same dad as the PR review UI. */}
        <DadMark size={24} bg={markBg} shape="circle" showBadge={false} />
        <span aria-hidden className="mx-1 inline-block h-5 w-px" style={{ background: 'var(--gray-a4)' }} />
        <span className="text-[15px] font-bold tracking-tight">
          Diff Dad <span className="font-medium text-[var(--fg-3)]">· command center</span>
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: live.fg }}>
          <span
            className={`inline-block h-2 w-2 rounded-full ${liveStatus === 'connected' ? 'live-ping-dot' : ''}`}
            style={{ background: live.dot }}
          />
          {live.label}
        </span>
        {repos.length > 1 && (
          <select
            value={repoFilter ?? ''}
            onChange={(e) => setRepoFilter(e.target.value || null)}
            className="rounded-md bg-[var(--bg-page)] px-2 py-1 text-[12.5px] text-[var(--fg-1)]"
            style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a5)' }}
            aria-label="Filter by repo"
          >
            <option value="">all repos</option>
            {repos.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        )}
        <AccentPicker />
        <ThemeToggle />
      </header>

      <main className="mx-auto max-w-[1100px] px-6">
        {error && (
          <div
            className="mt-4 flex items-center justify-between rounded-lg px-3.5 py-2.5 text-[13px]"
            style={{ background: 'var(--red-3)', color: 'var(--red-11)', boxShadow: 'inset 0 0 0 1px var(--red-a6)' }}
          >
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="font-semibold" aria-label="Dismiss">
              ✕
            </button>
          </div>
        )}

        {!loaded && total === 0 ? (
          <div className="pt-24 text-center">
            <div className="mx-auto mb-4 w-fit" style={{ animation: 'generating-bob 2s ease-in-out infinite' }}>
              <DadMark size={64} bg={markBg} shape="circle" showBadge={false} showWink />
            </div>
            <div className="flex items-center justify-center gap-3">
              <div className="flex gap-1">
                {[0, 0.2, 0.4].map((d) => (
                  <span
                    key={d}
                    className="h-1.5 w-1.5 rounded-full"
                    style={{
                      background: 'var(--purple-9)',
                      animation: `generating-dot 1.4s ease-in-out ${d}s infinite`,
                    }}
                  />
                ))}
              </div>
              <p
                className="text-[14px] italic text-[var(--fg-2)]"
                style={{ animation: 'generating-fade 2.5s ease-in-out infinite' }}
              >
                {copy.queueLoading}
              </p>
            </div>
          </div>
        ) : total === 0 ? (
          <div className="pt-24 text-center">
            <DadMark size={64} bg={markBg} shape="circle" showBadge className="mx-auto mb-4 opacity-90" />
            <p className="text-[15px] font-medium text-[var(--fg-2)]">All clear, champ. Nothing in the queue.</p>
            <p className="mt-1.5 text-[13px] text-[var(--fg-3)]">
              Point an agent at this daemon and have it call{' '}
              <code className="font-mono text-[12px] text-[var(--fg-2)]">submit_for_review</code> — finished work shows
              up here, grouped by what needs you.
            </p>
          </div>
        ) : (
          <>
            <GroupLabel title="Needs you" count={groups.needsYou.length} />
            {groups.needsYou.length === 0 ? (
              <p className="px-1 text-[13px] text-[var(--fg-3)]">Nothing waiting on you. 🎉</p>
            ) : (
              <Panel>
                {groups.needsYou.map((u) => (
                  <UnitRow
                    key={u.unitId}
                    {...rowProps(u)}
                    onOpen={open}
                    onApprove={(unit) => decide(unit, 'approved')}
                    onRequestChanges={(unit) => decide(unit, 'changes_requested')}
                    onRetry={retry}
                    onRemove={remove}
                  />
                ))}
              </Panel>
            )}

            {groups.inFlight.length > 0 && (
              <>
                <GroupLabel title="In flight" count={groups.inFlight.length} />
                <Panel>
                  {groups.inFlight.map((u) => (
                    <UnitRow key={u.unitId} {...rowProps(u)} onOpen={open} onRemove={remove} />
                  ))}
                </Panel>
              </>
            )}

            {groups.cleared.length > 0 && (
              <>
                <div className="mb-2 mt-6 flex items-baseline gap-2 px-1">
                  <h2 className="text-[12px] font-semibold uppercase tracking-[0.06em] text-[var(--fg-2)]">Cleared</h2>
                  <span className="text-[12px] tabular-nums text-[var(--fg-3)]">{groups.cleared.length}</span>
                  <button
                    type="button"
                    onClick={() => setShowCleared((v) => !v)}
                    className="ml-1 text-[12px] font-medium text-[var(--blue-11)]"
                  >
                    {showCleared ? 'hide' : 'show'}
                  </button>
                </div>
                {showCleared && (
                  <Panel>
                    {groups.cleared.map((u) => (
                      <UnitRow key={u.unitId} {...rowProps(u)} onOpen={open} onRemove={remove} />
                    ))}
                  </Panel>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
