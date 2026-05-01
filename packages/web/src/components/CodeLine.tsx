import { useMemo } from 'react';
import { useResolvedTheme, useReviewStore } from '../state/review-store';
import type { DiffLine } from '../state/types';
import { highlightLine } from '../lib/shiki';
import { IconPlus } from './Icons';

type Props = {
  line: DiffLine;
  lineKey: string;
  lang: string;
  dimmed?: boolean;
  highlighterReady?: boolean;
};

export function CodeLine({ line, lineKey, lang, dimmed, highlighterReady }: Props) {
  const setOpenLine = useReviewStore((s) => s.setOpenLine);
  const theme = useResolvedTheme();

  const isAdd = line.type === 'add';
  const isRem = line.type === 'remove';

  const sign = isAdd ? '+' : isRem ? '−' : '';

  // Shiki output
  const highlighted = useMemo(
    () => highlightLine(line.content, lang, theme),
    [line.content, lang, theme, highlighterReady],
  );

  // Row background tints (matching design CSS: rgba(41,163,131,0.08) / rgba(229,70,102,0.08))
  const rowBg = isAdd ? 'rgba(41, 163, 131, 0.08)' : isRem ? 'rgba(229, 70, 102, 0.08)' : 'var(--bg-panel)';

  // Line number tints (slightly more saturated)
  const lnBg = isAdd ? 'rgba(41, 163, 131, 0.16)' : isRem ? 'rgba(229, 70, 102, 0.16)' : 'var(--gray-1)';

  const lnColor = isAdd ? 'var(--green-11)' : isRem ? 'var(--red-11)' : 'var(--gray-9)';

  // Sigil glyph color
  const sigilColor = isAdd ? 'var(--green-11)' : isRem ? 'var(--red-11)' : 'var(--fg-3)';

  return (
    <div
      className={`code-line group relative grid items-stretch font-mono text-[12.75px] leading-[19px] hover:bg-[var(--gray-2)]${
        dimmed ? ' opacity-40' : ''
      }`}
      style={{
        gridTemplateColumns: '36px 36px 14px 1fr',
        background: rowBg,
        color: 'var(--gray-12)',
      }}
    >
      <span
        className="select-none px-2 text-right font-mono text-[11.5px]"
        style={{
          background: lnBg,
          color: lnColor,
          boxShadow: 'inset -1px 0 0 var(--gray-a3)',
          lineHeight: '19px',
        }}
      >
        {line.lineNumber.old ?? ''}
      </span>
      <span
        className="select-none px-2 text-right font-mono text-[11.5px]"
        style={{
          background: lnBg,
          color: lnColor,
          boxShadow: 'inset -1px 0 0 var(--gray-a3)',
          lineHeight: '19px',
        }}
      >
        {line.lineNumber.new ?? ''}
      </span>
      <span className="select-none text-center font-mono text-[12.5px] font-bold" style={{ color: sigilColor }}>
        {sign}
      </span>
      {highlighted ? (
        <pre
          className="m-0 overflow-x-hidden whitespace-pre px-3"
          style={{ lineHeight: '19px' }}
          dangerouslySetInnerHTML={{ __html: highlighted }}
        />
      ) : (
        <pre className="m-0 overflow-x-hidden whitespace-pre px-3" style={{ lineHeight: '19px' }}>
          {line.content}
        </pre>
      )}
      {line.lineNumber.new !== undefined && (
        <button
          type="button"
          aria-label="Comment on line"
          onClick={() => setOpenLine(lineKey)}
          className="ln-comment absolute z-10 flex h-[17px] w-[17px] items-center justify-center rounded-[4px] text-white"
          style={{
            left: '76px',
            top: '1px',
            background: 'var(--purple-9)',
          }}
        >
          <IconPlus className="h-[10px] w-[10px]" />
        </button>
      )}
    </div>
  );
}
