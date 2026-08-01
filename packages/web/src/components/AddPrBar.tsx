import { useState } from 'react';
import { addPrUnit } from '../hooks/useUnits';
import { copy } from '../lib/microcopy';
import { useReviewStore } from '../state/review-store';

/**
 * The command center's second door: review ANY PR, not just the ones GitHub put on your plate. Takes
 * the same references `dad <pr>` does (URL or `owner/repo#123`), mints a unit, and drills straight
 * into it — the walkthrough then generates lazily on that screen, exactly as it does for a polled unit.
 *
 * A PR already in the queue navigates to the unit you already have rather than minting a second one
 * (the server dedupes), so pasting the same link twice is harmless.
 *
 * Sits above the queue rather than in the header: it's an action you take with intent (paste, Enter),
 * and the header's right cluster is already carrying live status, freshness, refresh, and settings.
 */
export function AddPrBar({ disabled, disabledHint }: { disabled?: boolean; disabledHint?: string }) {
  const navigate = useReviewStore((s) => s.navigate);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const pr = value.trim();
    if (!pr || busy || disabled) return;
    setBusy(true);
    setError(null);
    try {
      const { unitId } = await addPrUnit(pr);
      // Whether it was just minted or already queued, the ask was "review this" — go review it. The
      // drill-in hydrates on open, so the walkthrough starts generating the moment we land.
      navigate({ name: 'unit', unitId });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add that PR.');
      setBusy(false); // stay on the field with the reference intact so it can be corrected
    }
  }

  return (
    <form onSubmit={submit} className="mt-4">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null); // a fresh keystroke means the last failure is being addressed
          }}
          disabled={disabled || busy}
          placeholder={copy.addPrPlaceholder}
          title={disabled ? disabledHint : undefined}
          aria-label="PR to review"
          aria-invalid={error ? true : undefined}
          className="min-w-0 flex-1 rounded-md bg-[var(--bg-panel)] px-3 py-2 text-[13px] text-[var(--fg-1)] outline-none placeholder:text-[var(--fg-3)] disabled:opacity-50"
          style={{ boxShadow: `inset 0 0 0 1px ${error ? 'var(--red-9)' : 'var(--gray-a5)'}` }}
          autoComplete="off"
          spellCheck={false}
        />
        <button
          type="submit"
          disabled={disabled || busy || value.trim() === ''}
          title={disabled ? disabledHint : undefined}
          className="inline-flex h-[34px] shrink-0 items-center rounded-[6px] px-3.5 text-[12.5px] font-bold text-white transition-opacity disabled:opacity-40"
          style={{ background: 'var(--brand)', boxShadow: '0 1px 2px rgba(3,2,13,0.08)' }}
        >
          {busy ? copy.addPrBusy : copy.addPrLabel}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-1.5 px-0.5 text-[12px] font-medium" style={{ color: 'var(--red-11)' }}>
          {error}
        </p>
      )}
    </form>
  );
}
