import { useReviewStore } from '../state/review-store';

export function MissingItems() {
  const narrative = useReviewStore((s) => s.narrative);
  if (!narrative?.missing?.length) return null;

  return (
    <section className="mb-[28px]">
      <div className="mb-[14px] flex items-start gap-2.5">
        <div
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-[7px] text-[13px]"
          style={{ background: 'var(--yellow-3)', color: 'var(--yellow-11)' }}
        >
          ?
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-[18px] font-bold leading-6 tracking-[-0.01em] text-[var(--fg-1)]">
            What's Not in This PR
          </h2>
          <p className="mt-[2px] text-[12.5px] text-[var(--fg-3)]">Potentially missing items flagged during analysis</p>
        </div>
      </div>
      <ul className="ml-[34px] list-none space-y-2 p-0">
        {narrative.missing.map((item, i) => (
          <li
            key={i}
            className="flex items-start gap-2 rounded-[8px] px-3.5 py-2.5 text-[13.5px] leading-[20px] text-[var(--fg-2)]"
            style={{
              background: 'var(--yellow-2)',
              boxShadow: 'inset 0 0 0 1px var(--yellow-a4)',
            }}
          >
            <span className="mt-[2px] flex-shrink-0 text-[12px]" style={{ color: 'var(--yellow-11)' }}>
              ●
            </span>
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
