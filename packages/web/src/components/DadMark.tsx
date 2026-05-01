export type DadMarkShape = 'circle' | 'squircle' | 'none';
export type DadMarkGlasses = 'round' | 'rect' | 'aviator-clear';

export type DadMarkProps = {
  size?: number;
  bg?: string;
  ink?: string;
  skin?: string;
  blush?: string;
  shape?: DadMarkShape;
  glasses?: DadMarkGlasses;
  showBadge?: boolean;
  showWink?: boolean;
  strokeW?: number;
  className?: string;
};

const DEFAULTS = {
  size: 32,
  bg: '#6565ec',
  ink: '#15233F',
  skin: '#FFF6E6',
  blush: '#FFC2A0',
  shape: 'circle' as DadMarkShape,
  glasses: 'round' as DadMarkGlasses,
  showBadge: false,
  showWink: false,
  strokeW: 8,
};

/**
 * Builds the inner SVG markup string for the DadMark.
 *
 * Shared between the React component (`DadMark`) and the pure
 * `renderDadMarkSVG` helper used to build a data URI for the dynamic
 * favicon.
 */
function dadMarkPaths(opts: Required<Omit<DadMarkProps, 'size' | 'className'>>): string {
  const { bg, ink, skin, blush, shape, glasses, showBadge, showWink, strokeW } = opts;
  const S = 320;
  const cx = 160;
  const cy = 168;
  const glassY = cy + 4;
  const glassDX = 38;
  const lensW = glasses === 'rect' ? 56 : 52;
  const lensH = glasses === 'rect' ? 38 : 40;
  const lensR = glasses === 'rect' ? 8 : 22;

  const parts: string[] = [];

  // Badge shape
  if (shape === 'circle') {
    parts.push(`<circle cx="${S / 2}" cy="${S / 2}" r="150" fill="${bg}"/>`);
  } else if (shape === 'squircle') {
    parts.push(`<rect x="10" y="10" width="300" height="300" rx="68" ry="68" fill="${bg}"/>`);
  }

  parts.push('<g>');

  // Hair (under face)
  const hairPath = `M ${cx - 78} ${cy - 36} C ${cx - 88} ${cy - 92}, ${cx - 30} ${cy - 118}, ${cx + 10} ${cy - 110} C ${cx + 70} ${cy - 102}, ${cx + 92} ${cy - 70}, ${cx + 86} ${cy - 36} C ${cx + 70} ${cy - 70}, ${cx + 30} ${cy - 78}, ${cx - 10} ${cy - 58} C ${cx - 30} ${cy - 48}, ${cx - 50} ${cy - 50}, ${cx - 78} ${cy - 36} Z`;
  parts.push(`<path d="${hairPath}" fill="${ink}"/>`);

  // Face
  parts.push(
    `<circle cx="${cx}" cy="${cy}" r="94" fill="${skin}" stroke="${ink}" stroke-width="${strokeW}"/>`,
  );

  // Hair re-clip on top of stroked face
  parts.push(`<path d="${hairPath}" fill="${ink}"/>`);

  // Ears
  parts.push(
    `<ellipse cx="${cx - 92}" cy="${cy + 8}" rx="9" ry="14" fill="${skin}" stroke="${ink}" stroke-width="${strokeW}"/>`,
  );
  parts.push(
    `<ellipse cx="${cx + 92}" cy="${cy + 8}" rx="9" ry="14" fill="${skin}" stroke="${ink}" stroke-width="${strokeW}"/>`,
  );

  // Cheeks
  parts.push(`<circle cx="${cx - 56}" cy="${cy + 28}" r="11" fill="${blush}" opacity="0.7"/>`);
  parts.push(`<circle cx="${cx + 56}" cy="${cy + 28}" r="11" fill="${blush}" opacity="0.7"/>`);

  // Eyebrows
  parts.push(
    `<path d="M ${cx - 52} ${glassY - 26} Q ${cx - 38} ${glassY - 34} ${cx - 22} ${glassY - 26}" stroke="${ink}" stroke-width="6" stroke-linecap="round" fill="none"/>`,
  );
  parts.push(
    `<path d="M ${cx + 22} ${glassY - 26} Q ${cx + 38} ${glassY - 34} ${cx + 52} ${glassY - 26}" stroke="${ink}" stroke-width="6" stroke-linecap="round" fill="none"/>`,
  );

  // Glasses group
  parts.push('<g>');

  // Bridge
  parts.push(
    `<line x1="${cx - (glassDX - lensW / 2)}" y1="${glassY}" x2="${cx + (glassDX - lensW / 2)}" y2="${glassY}" stroke="${ink}" stroke-width="6" stroke-linecap="round"/>`,
  );

  // Left lens
  if (glasses === 'round') {
    parts.push(
      `<circle cx="${cx - glassDX}" cy="${glassY}" r="26" fill="white" stroke="${ink}" stroke-width="6"/>`,
    );
  } else if (glasses === 'rect') {
    parts.push(
      `<rect x="${cx - glassDX - lensW / 2}" y="${glassY - lensH / 2}" width="${lensW}" height="${lensH}" rx="${lensR}" fill="white" stroke="${ink}" stroke-width="6"/>`,
    );
  } else if (glasses === 'aviator-clear') {
    parts.push(
      `<path d="M ${cx - glassDX - 28} ${glassY - 16} Q ${cx - glassDX - 30} ${glassY + 22} ${cx - glassDX} ${glassY + 22} Q ${cx - glassDX + 28} ${glassY + 22} ${cx - glassDX + 26} ${glassY - 18} Z" fill="white" stroke="${ink}" stroke-width="6"/>`,
    );
  }

  // Right lens
  if (glasses === 'round') {
    parts.push(
      `<circle cx="${cx + glassDX}" cy="${glassY}" r="26" fill="white" stroke="${ink}" stroke-width="6"/>`,
    );
  } else if (glasses === 'rect') {
    parts.push(
      `<rect x="${cx + glassDX - lensW / 2}" y="${glassY - lensH / 2}" width="${lensW}" height="${lensH}" rx="${lensR}" fill="white" stroke="${ink}" stroke-width="6"/>`,
    );
  } else if (glasses === 'aviator-clear') {
    parts.push(
      `<path d="M ${cx + glassDX - 26} ${glassY - 18} Q ${cx + glassDX - 28} ${glassY + 22} ${cx + glassDX} ${glassY + 22} Q ${cx + glassDX + 30} ${glassY + 22} ${cx + glassDX + 28} ${glassY - 16} Z" fill="white" stroke="${ink}" stroke-width="6"/>`,
    );
  }

  // Pupils (or wink)
  if (!showWink) {
    parts.push(`<circle cx="${cx - glassDX + 2}" cy="${glassY + 2}" r="4" fill="${ink}"/>`);
    parts.push(`<circle cx="${cx + glassDX + 2}" cy="${glassY + 2}" r="4" fill="${ink}"/>`);
  } else {
    parts.push(`<circle cx="${cx - glassDX + 2}" cy="${glassY + 2}" r="4" fill="${ink}"/>`);
    parts.push(
      `<path d="M ${cx + glassDX - 12} ${glassY + 2} Q ${cx + glassDX} ${glassY - 6} ${cx + glassDX + 12} ${glassY + 2}" stroke="${ink}" stroke-width="5" stroke-linecap="round" fill="none"/>`,
    );
  }

  // Temple tips
  const templeOffset = glasses === 'rect' ? lensW / 2 : 26;
  parts.push(
    `<line x1="${cx - glassDX - templeOffset}" y1="${glassY - 2}" x2="${cx - glassDX - templeOffset - 12}" y2="${glassY - 8}" stroke="${ink}" stroke-width="6" stroke-linecap="round"/>`,
  );
  parts.push(
    `<line x1="${cx + glassDX + templeOffset}" y1="${glassY - 2}" x2="${cx + glassDX + templeOffset + 12}" y2="${glassY - 8}" stroke="${ink}" stroke-width="6" stroke-linecap="round"/>`,
  );

  parts.push('</g>'); // end glasses group

  // Nose
  parts.push(
    `<path d="M ${cx - 6} ${cy + 30} Q ${cx} ${cy + 38} ${cx + 6} ${cy + 30}" stroke="${ink}" stroke-width="5" stroke-linecap="round" fill="none"/>`,
  );

  // Mustache
  const mustachePath = `M ${cx} ${cy + 44} C ${cx - 14} ${cy + 40}, ${cx - 28} ${cy + 42}, ${cx - 44} ${cy + 52} C ${cx - 60} ${cy + 60}, ${cx - 76} ${cy + 64}, ${cx - 86} ${cy + 56} C ${cx - 78} ${cy + 76}, ${cx - 56} ${cy + 84}, ${cx - 38} ${cy + 78} C ${cx - 22} ${cy + 74}, ${cx - 10} ${cy + 68}, ${cx} ${cy + 64} C ${cx + 10} ${cy + 68}, ${cx + 22} ${cy + 74}, ${cx + 38} ${cy + 78} C ${cx + 56} ${cy + 84}, ${cx + 78} ${cy + 76}, ${cx + 86} ${cy + 56} C ${cx + 76} ${cy + 64}, ${cx + 60} ${cy + 60}, ${cx + 44} ${cy + 52} C ${cx + 28} ${cy + 42}, ${cx + 14} ${cy + 40}, ${cx} ${cy + 44} Z`;
  parts.push(`<path d="${mustachePath}" fill="${ink}"/>`);

  // Mustache highlight
  parts.push(
    `<path d="M ${cx} ${cy + 48} Q ${cx} ${cy + 60} ${cx - 2} ${cy + 66}" stroke="${skin}" stroke-width="2" stroke-linecap="round" fill="none" opacity="0.4"/>`,
  );

  // Chin tuft
  parts.push(
    `<path d="M ${cx - 14} ${cy + 80} Q ${cx} ${cy + 92} ${cx + 14} ${cy + 80}" stroke="${ink}" stroke-width="5" stroke-linecap="round" fill="none"/>`,
  );

  parts.push('</g>'); // end face group

  // Diff badge
  if (showBadge) {
    parts.push(`<g transform="translate(${S - 78}, 36)">`);
    parts.push(`<rect x="0" y="0" width="56" height="56" rx="14" fill="white" stroke="${ink}" stroke-width="5"/>`);
    parts.push(`<line x1="10" y1="20" x2="18" y2="20" stroke="#1F9D55" stroke-width="5" stroke-linecap="round"/>`);
    parts.push(`<line x1="14" y1="16" x2="14" y2="24" stroke="#1F9D55" stroke-width="5" stroke-linecap="round"/>`);
    parts.push(`<line x1="24" y1="20" x2="46" y2="20" stroke="#1F9D55" stroke-width="5" stroke-linecap="round"/>`);
    parts.push(`<line x1="10" y1="38" x2="18" y2="38" stroke="#D64545" stroke-width="5" stroke-linecap="round"/>`);
    parts.push(`<line x1="24" y1="38" x2="42" y2="38" stroke="#D64545" stroke-width="5" stroke-linecap="round"/>`);
    parts.push('</g>');
  }

  return parts.join('');
}

function resolveOpts(props: DadMarkProps): Required<Omit<DadMarkProps, 'size' | 'className'>> {
  return {
    bg: props.bg ?? DEFAULTS.bg,
    ink: props.ink ?? DEFAULTS.ink,
    skin: props.skin ?? DEFAULTS.skin,
    blush: props.blush ?? DEFAULTS.blush,
    shape: props.shape ?? DEFAULTS.shape,
    glasses: props.glasses ?? DEFAULTS.glasses,
    showBadge: props.showBadge ?? DEFAULTS.showBadge,
    showWink: props.showWink ?? DEFAULTS.showWink,
    strokeW: props.strokeW ?? DEFAULTS.strokeW,
  };
}

/**
 * Pure function returning a complete `<svg>...</svg>` markup string.
 * Useful for building data URIs (favicons, og-images) outside of React.
 */
export function renderDadMarkSVG(props: Omit<DadMarkProps, 'className'> = {}): string {
  const size = props.size ?? DEFAULTS.size;
  const inner = dadMarkPaths(resolveOpts(props));
  return `<svg viewBox="0 0 320 320" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
}

/**
 * React component rendering the DadMark inline.
 *
 * Shares geometry with `renderDadMarkSVG`. All content is generated from
 * hardcoded geometry plus numeric/color props — no user input flows in,
 * so injecting the inner markup is safe.
 */
export function DadMark(props: DadMarkProps) {
  const size = props.size ?? DEFAULTS.size;
  const inner = dadMarkPaths(resolveOpts(props));
  return (
    <svg
      viewBox="0 0 320 320"
      width={size}
      height={size}
      xmlns="http://www.w3.org/2000/svg"
      className={props.className}
      aria-hidden="true"
      // SAFE: `inner` is built only from hardcoded geometry and the typed
      // numeric/color props above — no untrusted strings reach this point.
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  );
}
