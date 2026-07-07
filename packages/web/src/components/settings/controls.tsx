import type { ReactNode } from 'react';

/**
 * Shared, theme-aware form primitives for the settings page. All color comes from CSS custom
 * properties (per CLAUDE.md — never Tailwind color classes) so every control reads correctly in
 * both light and dark. The styling mirrors the existing controls in `SubmitDialog` / `CommandCenter`
 * (inset hairline borders, `--bg-page` fills) so the settings page looks native to the app.
 */

/** A grouped card of related settings. */
export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl bg-[var(--bg-panel)] p-5" style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a4)' }}>
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-[var(--fg-2)]">{title}</h2>
      {description && <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--fg-3)]">{description}</p>}
      <div className="mt-4 flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** A labeled row: label (+ optional hint) on the left, control on the right; inline error below. */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-[var(--fg-1)]">
          {label}
        </label>
        <div className="flex min-w-0 items-center gap-2">{children}</div>
      </div>
      {hint && <p className="text-[12px] leading-snug text-[var(--fg-3)]">{hint}</p>}
      {error && (
        <p role="alert" className="text-[12px] font-medium" style={{ color: 'var(--red-11)' }}>
          {error}
        </p>
      )}
    </div>
  );
}

const controlClass =
  'rounded-md bg-[var(--bg-page)] px-2.5 py-1.5 text-[13px] text-[var(--fg-1)] outline-none disabled:opacity-50';
const controlStyle = { boxShadow: 'inset 0 0 0 1px var(--gray-a5)' } as const;

export function Select<T extends string>({
  id,
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
}: {
  id?: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <select
      id={id}
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as T)}
      className={controlClass}
      style={controlStyle}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function TextInput({
  id,
  value,
  onChange,
  placeholder,
  disabled,
  type = 'text',
  ariaLabel,
  onKeyDown,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  type?: 'text' | 'password' | 'number';
  ariaLabel?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <input
      id={id}
      type={type}
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      className={`${controlClass} w-full min-w-[180px]`}
      style={controlStyle}
      autoComplete="off"
      spellCheck={false}
    />
  );
}

/** A compact pill toggle (on/off). */
export function Toggle({
  id,
  checked,
  onChange,
  disabled,
  ariaLabel,
}: {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-[22px] w-[38px] flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50"
      style={{ background: checked ? 'var(--green-9)' : 'var(--gray-a5)' }}
    >
      <span
        className="inline-block h-[16px] w-[16px] transform rounded-full bg-white transition-transform"
        style={{ transform: checked ? 'translateX(19px)' : 'translateX(3px)' }}
      />
    </button>
  );
}

/** The Save / Cancel bar for dirty-tracked text/secret sections. */
export function SaveBar({
  dirty,
  saving,
  onSave,
  onCancel,
}: {
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex items-center justify-end gap-2 pt-1">
      <button
        type="button"
        onClick={onCancel}
        disabled={!dirty || saving}
        className="inline-flex h-[28px] items-center rounded-[6px] px-3 text-[12.5px] font-semibold text-[var(--fg-2)] hover:bg-[var(--gray-a3)] hover:text-[var(--fg-1)] disabled:opacity-40"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={!dirty || saving}
        className="inline-flex h-[28px] items-center rounded-[6px] px-3.5 text-[12.5px] font-semibold text-white disabled:opacity-40"
        style={{ background: 'var(--brand)' }}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}

/** Inline pass/fail result for a Test-connection button. */
export function TestResultLine({ result }: { result: { ok: boolean; detail: string } | null }) {
  if (!result) return null;
  return (
    <p className="text-[12px] leading-snug" style={{ color: result.ok ? 'var(--green-11)' : 'var(--red-11)' }}>
      {result.ok ? '✓ ' : '✗ '}
      {result.detail}
    </p>
  );
}

/** A secondary (outline) button — Test connection, Replace…, etc. */
export function GhostButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-[28px] items-center gap-1.5 rounded-[6px] bg-[var(--bg-page)] px-2.5 text-[12.5px] font-medium text-[var(--fg-1)] hover:bg-[var(--gray-2)] disabled:opacity-50"
      style={{ boxShadow: 'inset 0 0 0 1px var(--gray-a5)' }}
    >
      {children}
    </button>
  );
}
