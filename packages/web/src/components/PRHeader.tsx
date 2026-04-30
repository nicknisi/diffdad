import { useMemo, useState } from 'react';
import { copy } from '../lib/microcopy';
import { useReviewStore } from '../state/review-store';
import type { CheckRun } from '../state/types';
import { IconCheck } from './Icons';
import { SubmitDialog } from './SubmitDialog';
import { Toast } from './Toast';

type CheckSummary = {
  passing: number;
  failing: number;
  pending: number;
  neutral: number;
  total: number;
};

function summarizeChecks(checks: CheckRun[]): CheckSummary {
  let passing = 0;
  let failing = 0;
  let pending = 0;
  let neutral = 0;
  for (const c of checks) {
    if (c.status !== 'completed') {
      pending++;
      continue;
    }
    switch (c.conclusion) {
      case 'success':
        passing++;
        break;
      case 'failure':
      case 'timed_out':
      case 'action_required':
      case 'cancelled':
        failing++;
        break;
      case 'neutral':
      case 'skipped':
        neutral++;
        break;
      default:
        pending++;
    }
  }
  return { passing, failing, pending, neutral, total: checks.length };
}

function checkIcon(c: CheckRun): { icon: string; color: string; label: string } {
  if (c.status !== 'completed') {
    return {
      icon: '◯',
      color: 'text-amber-600 dark:text-amber-400',
      label: c.status,
    };
  }
  switch (c.conclusion) {
    case 'success':
      return {
        icon: '✓',
        color: 'text-green-700 dark:text-green-400',
        label: 'success',
      };
    case 'failure':
    case 'timed_out':
    case 'action_required':
    case 'cancelled':
      return {
        icon: '✗',
        color: 'text-red-700 dark:text-red-400',
        label: c.conclusion ?? 'failure',
      };
    case 'neutral':
    case 'skipped':
      return {
        icon: '⋯',
        color: 'text-gray-500 dark:text-gray-400',
        label: c.conclusion ?? 'neutral',
      };
    default:
      return {
        icon: '◯',
        color: 'text-amber-600 dark:text-amber-400',
        label: c.conclusion ?? 'pending',
      };
  }
}

function timeAgo(iso: string | undefined | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, Date.now() - then);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}

export function PRHeader() {
  const pr = useReviewStore((s) => s.pr);
  const repoUrl = useReviewStore((s) => s.repoUrl);
  const checkRuns = useReviewStore((s) => s.checkRuns);
  const reviews = useReviewStore((s) => s.reviews);
  const view = useReviewStore((s) => s.view);
  const setView = useReviewStore((s) => s.setView);
  const clearDrafts = useReviewStore((s) => s.clearDrafts);
  const [open, setOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const summary = useMemo(() => summarizeChecks(checkRuns), [checkRuns]);

  if (!pr) return null;

  const prUrl = repoUrl ? `${repoUrl}/pull/${pr.number}` : null;

  const baseBtn =
    'h-[26px] inline-flex items-center gap-1 px-2.5 text-[12.5px] font-medium rounded-[5px] transition-colors';
  const activeBtn = 'bg-[var(--bg-panel)] text-[var(--fg-1)]';
  const activeBtnStyle: React.CSSProperties = {
    boxShadow: '0 1px 2px rgba(3,2,13,0.06), inset 0 0 0 1px var(--gray-a5)',
  };
  const inactiveBtn = 'bg-transparent text-[var(--fg-2)] hover:text-[var(--fg-1)]';

  let checksLabel: { text: string; className: string } | null = null;
  if (summary.total > 0) {
    if (summary.failing > 0) {
      checksLabel = {
        text: `✗ ${summary.failing} failing`,
        className:
          'text-red-700 dark:text-red-400 border-red-300 dark:border-red-800/60 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50',
      };
    } else if (summary.pending > 0) {
      checksLabel = {
        text: `◯ ${summary.pending} pending`,
        className:
          'text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 hover:bg-amber-100 dark:hover:bg-amber-950/50',
      };
    } else {
      checksLabel = {
        text: `${summary.passing} checks passing`,
        className:
          'text-green-700 dark:text-green-400 border-green-300 dark:border-green-800/60 bg-green-50 dark:bg-green-950/30 hover:bg-green-100 dark:hover:bg-green-950/50',
      };
    }
  }

  async function handleSubmit(resolution: string, summary: string) {
    try {
      const res = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: resolution, body: summary }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const msg = data?.error ?? `HTTP ${res.status}`;
        setToast(msg);
        return;
      }
      setSubmitOpen(false);
      clearDrafts();
      const toastMsg =
        resolution === 'approve'
          ? copy.approvalToast
          : resolution === 'request_changes'
            ? copy.requestChangesToast
            : copy.commentToast;
      setToast(toastMsg);
    } catch {
      setToast(copy.errorGeneric);
    }
  }

  const authorUrl = pr.author?.login ? `https://github.com/${pr.author.login}` : null;

  return (
    <section
      className="sticky top-[52px] z-20 bg-[var(--bg-panel)] px-6 pt-[18px] pb-3.5"
      style={{ boxShadow: 'inset 0 -1px 0 var(--gray-a4)' }}
    >
      <div className="flex items-start gap-3">
        <h1 className="m-0 flex-1 text-[22px] font-bold leading-[27px] tracking-[-0.0125em] text-[var(--fg-1)]">
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
        <div className="flex shrink-0 items-center gap-2">
          <div
            role="tablist"
            aria-label="View mode"
            className="inline-flex items-center rounded-[7px] bg-[var(--gray-2)] p-[2px]"
            style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a4)' }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={view === 'story'}
              onClick={() => setView('story')}
              className={`${baseBtn} ${view === 'story' ? activeBtn : inactiveBtn}`}
              style={view === 'story' ? activeBtnStyle : undefined}
            >
              Story
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'files'}
              onClick={() => setView('files')}
              className={`${baseBtn} ${view === 'files' ? activeBtn : inactiveBtn}`}
              style={view === 'files' ? activeBtnStyle : undefined}
            >
              Files
            </button>
          </div>
          <button
            type="button"
            onClick={() => setSubmitOpen(true)}
            className="inline-flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-[6px] bg-[var(--bg-panel)] px-3 text-[12.5px] font-bold text-[var(--fg-1)] hover:bg-[var(--gray-2)]"
            style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a6)' }}
          >
            Submit review
          </button>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-[var(--fg-2)]">
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-[2px] text-[11.5px] font-bold uppercase tracking-[0.04em]"
          style={
            pr.state === 'merged'
              ? { background: 'var(--purple-3)', color: 'var(--purple-11)' }
              : pr.state === 'closed'
                ? { background: 'var(--red-3)', color: 'var(--red-11)' }
                : pr.draft
                  ? { background: 'var(--gray-3)', color: 'var(--fg-2)' }
                  : { background: 'var(--green-3)', color: 'var(--green-11)' }
          }
        >
          {pr.state === 'merged' ? 'Merged' : pr.state === 'closed' ? 'Closed' : pr.draft ? 'Draft' : 'Open'}
        </span>
        <span className="rounded-[4px] bg-[var(--gray-3)] px-[7px] py-[2px] font-mono text-[12.5px] text-[var(--fg-2)]">
          <b className="font-medium text-[var(--fg-1)]">{pr.branch}</b> <span className="text-[var(--fg-3)]">→</span>{' '}
          <b className="font-medium text-[var(--fg-1)]">{pr.base}</b>
        </span>
        {authorUrl ? (
          <a
            href={authorUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[var(--fg-1)] hover:text-[var(--brand)]"
          >
            {pr.author.login}
          </a>
        ) : (
          <span className="font-medium text-[var(--fg-1)]">{pr.author?.login ?? 'unknown'}</span>
        )}
        <span className="text-[var(--fg-2)]">
          opened {timeAgo(pr.createdAt)} · updated {timeAgo(pr.updatedAt)}
        </span>
        <span className="text-[var(--fg-3)]">·</span>
        <span>
          <span className="font-medium" style={{ color: 'var(--green-11)' }}>
            +{pr.additions}
          </span>{' '}
          <span className="font-medium" style={{ color: 'var(--red-11)' }}>
            −{pr.deletions}
          </span>{' '}
          <span className="text-[var(--fg-2)]">
            across {pr.changedFiles} {pr.changedFiles === 1 ? 'file' : 'files'}
          </span>
        </span>
        {checksLabel ? (
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              title={summary.failing > 0 ? copy.blocker : undefined}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-sm font-medium transition-colors ${checksLabel.className}`}
            >
              {summary.failing === 0 && summary.pending === 0 ? <IconCheck className="h-3.5 w-3.5" /> : null}
              <span>{checksLabel.text}</span>
              <span className="text-xs opacity-70">{open ? '▲' : '▼'}</span>
            </button>
            {open ? (
              <div className="absolute left-0 top-full z-20 mt-2 w-96 max-w-[90vw] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg dark:border-gray-700 dark:bg-gray-800">
                <div className="max-h-96 overflow-y-auto">
                  {checkRuns.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-gray-500 dark:text-gray-400">No checks reported.</div>
                  ) : (
                    <ul className="divide-y divide-gray-100 dark:divide-gray-700">
                      {checkRuns.map((cr) => {
                        const ico = checkIcon(cr);
                        const failed =
                          cr.status === 'completed' &&
                          (cr.conclusion === 'failure' ||
                            cr.conclusion === 'timed_out' ||
                            cr.conclusion === 'action_required' ||
                            cr.conclusion === 'cancelled');
                        return (
                          <li key={cr.id} className="flex flex-col gap-1 px-3 py-2 text-sm">
                            <div className="flex items-center gap-2">
                              <span className={`shrink-0 font-bold ${ico.color}`} aria-label={ico.label}>
                                {ico.icon}
                              </span>
                              <span className="flex-1 truncate font-medium text-gray-800 dark:text-gray-100">
                                {cr.name}
                              </span>
                              {cr.detailsUrl ? (
                                <a
                                  href={cr.detailsUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="shrink-0 text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
                                >
                                  View
                                </a>
                              ) : null}
                            </div>
                            {failed && cr.output?.title ? (
                              <div className="pl-6 text-xs text-red-700 dark:text-red-400">
                                {cr.output.title}
                                {cr.output.summary ? (
                                  <div className="mt-0.5 whitespace-pre-wrap text-red-600/80 dark:text-red-400/80">
                                    {cr.output.summary.slice(0, 240)}
                                    {cr.output.summary.length > 240 ? '…' : ''}
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        {reviews.length > 0 && (
          <>
            <span className="text-[var(--fg-3)]">·</span>
            <div className="inline-flex items-center gap-1.5">
              {reviews.map((r) => {
                const stateStyle =
                  r.state === 'APPROVED'
                    ? { border: '2px solid var(--green-9)' }
                    : r.state === 'CHANGES_REQUESTED'
                      ? { border: '2px solid var(--red-9)' }
                      : r.state === 'COMMENTED'
                        ? { border: '2px solid var(--gray-9)' }
                        : { border: '2px solid var(--gray-a4)' };
                const stateIcon =
                  r.state === 'APPROVED'
                    ? '✓'
                    : r.state === 'CHANGES_REQUESTED'
                      ? '✗'
                      : null;
                const stateColor =
                  r.state === 'APPROVED'
                    ? 'var(--green-11)'
                    : r.state === 'CHANGES_REQUESTED'
                      ? 'var(--red-11)'
                      : 'var(--fg-3)';
                return (
                  <span key={r.id} className="relative" title={`${r.user}: ${r.state.toLowerCase().replace('_', ' ')}`}>
                    {r.avatarUrl ? (
                      <img
                        src={r.avatarUrl}
                        alt={r.user}
                        className="h-[24px] w-[24px] rounded-full"
                        style={stateStyle}
                      />
                    ) : (
                      <span
                        className="inline-flex h-[24px] w-[24px] items-center justify-center rounded-full bg-[var(--gray-3)] text-[10px] font-bold text-[var(--fg-2)]"
                        style={stateStyle}
                      >
                        {r.user.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    {stateIcon && (
                      <span
                        className="absolute -bottom-0.5 -right-0.5 flex h-[14px] w-[14px] items-center justify-center rounded-full bg-[var(--bg-panel)] text-[9px] font-bold"
                        style={{ color: stateColor }}
                      >
                        {stateIcon}
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          </>
        )}
      </div>
      <SubmitDialog open={submitOpen} onClose={() => setSubmitOpen(false)} onSubmit={handleSubmit} />
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </section>
  );
}
