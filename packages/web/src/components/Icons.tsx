type IconProps = { className?: string };

const baseProps = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function IconSun({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8h1.5M13 8h1.5M3.4 3.4l1.06 1.06M11.54 11.54l1.06 1.06M3.4 12.6l1.06-1.06M11.54 4.46l1.06-1.06" />
    </svg>
  );
}

export function IconMoon({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z" />
    </svg>
  );
}

export function IconSpark({ className }: IconProps) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <path d="M8 1.5l1.4 4.1 4.1 1.4-4.1 1.4L8 12.5 6.6 8.4 2.5 7l4.1-1.4z" />
    </svg>
  );
}

export function IconCheck({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M3 8.5l3 3 7-7" />
    </svg>
  );
}

export function IconChat({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M2.5 7.5a4.5 4.5 0 0 1 4.5-4.5h2a4.5 4.5 0 0 1 0 9H6l-3 2.5v-2.7a4.5 4.5 0 0 1-.5-4.3z" />
    </svg>
  );
}

export function IconRefresh({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M13.5 3.5v3h-3" />
      <path d="M13 6.5A5 5 0 1 0 13.5 11" />
    </svg>
  );
}

export function IconSend({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M2 8l12-5.5L9 14l-1.5-5L2 8z" />
    </svg>
  );
}

export function IconPlus({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className} strokeWidth={2}>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function IconChevron({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M6 3l5 5-5 5" />
    </svg>
  );
}

export function IconGitHub({ className }: IconProps) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="currentColor" aria-hidden className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

export function IconFiles({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M9.5 1.5H4a1 1 0 0 0-1 1V13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5l-3.5-3.5z" />
      <path d="M9.5 1.5V5H13" />
    </svg>
  );
}

export function IconX({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />
    </svg>
  );
}

export function IconKeyboard({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <rect x="1.5" y="4" width="13" height="8" rx="1.5" />
      <path d="M4 7h.5M7 7h.5M10 7h.5M4 9.5h8" />
    </svg>
  );
}

export function IconCode({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M5.5 4L1.5 8l4 4M10.5 4l4 4-4 4" />
    </svg>
  );
}

export function IconGear({ className }: IconProps) {
  // Toothed cog, not the sun-like tick ring — drawn on a 24 grid; strokeWidth 2.25 here renders at the
  // same visual weight as the sibling icons' 1.5 on the 16 grid.
  return (
    <svg {...baseProps} viewBox="0 0 24 24" strokeWidth={2.25} className={className}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function IconArrowRight({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

export function IconFile({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M9.5 1.5H4a1 1 0 0 0-1 1V13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5l-3.5-3.5z" />
      <path d="M9.5 1.5V5H13" />
    </svg>
  );
}

export function IconReply({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <path d="M6 8L2 5l4-3" />
      <path d="M2 5h7a4 4 0 0 1 4 4v2" />
    </svg>
  );
}

export function IconMonitor({ className }: IconProps) {
  return (
    <svg {...baseProps} className={className}>
      <rect x="2" y="2" width="12" height="9" rx="1" />
      <path d="M5.5 14h5M8 11v3" />
    </svg>
  );
}
