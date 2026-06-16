import { useReviewStore } from '../state/review-store';
import type { TriageFlag, TriageSeverity } from '../state/types';

const SEV: Record<TriageSeverity, { color: string; bg: string; label: string }> = {
  risk: { color: 'var(--red-11)', bg: 'var(--red-3)', label: 'risk' },
  warn: { color: 'var(--amber-11)', bg: 'var(--gray-3)', label: 'warn' },
  info: { color: 'var(--gray-11)', bg: 'var(--gray-3)', label: 'info' },
};

function TriageRow({ flag }: { flag: TriageFlag }) {
  const sev = SEV[flag.severity];
  return (
    <li className="flex items-start gap-2.5 text-[13px] leading-[1.5]">
      <span
        className="mt-[2px] shrink-0 rounded-[4px] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em]"
        style={{ background: sev.bg, color: sev.color }}
      >
        {sev.label}
      </span>
      <span className="text-[var(--fg-1)]">
        {flag.message}{' '}
        <span className="font-mono text-[11.5px] text-[var(--fg-3)]">
          {flag.file}
          {flag.line != null ? `:${flag.line}` : ''}
        </span>
      </span>
    </li>
  );
}

/**
 * Watch mode's "look here first" strip: the cheap, non-blocking triage pass pointing attention at
 * agent-era failure modes. This is what makes watch more than a diff view. The diff renders without
 * waiting on it; flags fill in a beat later and stay out of the way when the pass comes back clean.
 */
export function TriageStrip() {
  const flags = useReviewStore((s) => s.triageFlags);
  const status = useReviewStore((s) => s.triageStatus);

  // A completed pass with nothing to say should not take up space.
  if (flags.length === 0 && status !== 'running') return null;

  return (
    <section className="mx-auto max-w-[1100px] px-6 pt-4">
      <div className="rounded-[8px] bg-[var(--bg-panel)] p-3" style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a5)' }}>
        <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.05em] text-[var(--fg-3)]">
          <span>Look here first</span>
          {status === 'running' && <span className="font-normal normal-case text-[var(--fg-3)]">· analyzing…</span>}
          {status === 'error' && <span className="font-normal normal-case text-[var(--red-11)]">· unavailable</span>}
        </div>
        {flags.length === 0 ? (
          <p className="text-[13px] text-[var(--fg-3)]">Scanning the diff for things worth a look…</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {flags.map((f, i) => (
              <TriageRow key={`${f.file}-${f.line ?? 'x'}-${i}`} flag={f} />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
