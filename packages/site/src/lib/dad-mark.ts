export interface DadMarkOptions {
  bg?: string;
  ink?: string;
  skin?: string;
  blush?: string;
  shape?: 'circle' | 'squircle' | 'none';
  glasses?: 'round' | 'rect' | 'aviator-clear';
  showBadge?: boolean;
  showHat?: boolean;
  showWink?: boolean;
  strokeW?: number;
}

export interface RenderOptions extends DadMarkOptions {
  size?: number;
}

const S = 320;
const cx = 160;
const cy = 168;

export function dadMarkInner(opts: DadMarkOptions = {}): string {
  const {
    bg = '#FF7A45',
    ink = '#15233F',
    skin = '#FFF6E6',
    blush = '#FFC2A0',
    shape = 'circle',
    glasses = 'round',
    showBadge = true,
    showHat = false,
    showWink = false,
    strokeW = 8,
  } = opts;

  const glassY = cy + 4;
  const glassDX = 38;
  const lensW = glasses === 'rect' ? 56 : 52;
  const lensH = glasses === 'rect' ? 38 : 40;
  const lensR = glasses === 'rect' ? 8 : 22;

  const hairD = `M ${cx - 78} ${cy - 36} C ${cx - 88} ${cy - 92}, ${cx - 30} ${cy - 118}, ${cx + 10} ${cy - 110} C ${cx + 70} ${cy - 102}, ${cx + 92} ${cy - 70}, ${cx + 86} ${cy - 36} C ${cx + 70} ${cy - 70}, ${cx + 30} ${cy - 78}, ${cx - 10} ${cy - 58} C ${cx - 30} ${cy - 48}, ${cx - 50} ${cy - 50}, ${cx - 78} ${cy - 36} Z`;

  const mustacheD = `M ${cx} ${cy + 44} C ${cx - 14} ${cy + 40}, ${cx - 28} ${cy + 42}, ${cx - 44} ${cy + 52} C ${cx - 60} ${cy + 60}, ${cx - 76} ${cy + 64}, ${cx - 86} ${cy + 56} C ${cx - 78} ${cy + 76}, ${cx - 56} ${cy + 84}, ${cx - 38} ${cy + 78} C ${cx - 22} ${cy + 74}, ${cx - 10} ${cy + 68}, ${cx} ${cy + 64} C ${cx + 10} ${cy + 68}, ${cx + 22} ${cy + 74}, ${cx + 38} ${cy + 78} C ${cx + 56} ${cy + 84}, ${cx + 78} ${cy + 76}, ${cx + 86} ${cy + 56} C ${cx + 76} ${cy + 64}, ${cx + 60} ${cy + 60}, ${cx + 44} ${cy + 52} C ${cx + 28} ${cy + 42}, ${cx + 14} ${cy + 40}, ${cx} ${cy + 44} Z`;

  const lensRX = glasses === 'rect' ? lensW / 2 : 26;

  const lensLeft =
    glasses === 'rect'
      ? `<rect x="${cx - glassDX - lensW / 2}" y="${glassY - lensH / 2}" width="${lensW}" height="${lensH}" rx="${lensR}" fill="white" stroke="${ink}" stroke-width="6"/>`
      : `<circle cx="${cx - glassDX}" cy="${glassY}" r="26" fill="white" stroke="${ink}" stroke-width="6"/>`;
  const lensRight =
    glasses === 'rect'
      ? `<rect x="${cx + glassDX - lensW / 2}" y="${glassY - lensH / 2}" width="${lensW}" height="${lensH}" rx="${lensR}" fill="white" stroke="${ink}" stroke-width="6"/>`
      : `<circle cx="${cx + glassDX}" cy="${glassY}" r="26" fill="white" stroke="${ink}" stroke-width="6"/>`;

  const eyes = showWink
    ? `<circle cx="${cx - glassDX + 2}" cy="${glassY + 2}" r="4" fill="${ink}"/>` +
      `<path d="M ${cx + glassDX - 12} ${glassY + 2} Q ${cx + glassDX} ${glassY - 6} ${cx + glassDX + 12} ${glassY + 2}" stroke="${ink}" stroke-width="5" stroke-linecap="round" fill="none"/>`
    : `<circle cx="${cx - glassDX + 2}" cy="${glassY + 2}" r="4" fill="${ink}"/>` +
      `<circle cx="${cx + glassDX + 2}" cy="${glassY + 2}" r="4" fill="${ink}"/>`;

  const hat = showHat
    ? `<g><path d="M ${cx - 92} ${cy - 60} Q ${cx} ${cy - 140} ${cx + 92} ${cy - 60} L ${cx + 92} ${cy - 50} L ${cx - 92} ${cy - 50} Z" fill="${ink}"/><rect x="${cx - 110}" y="${cy - 54}" width="220" height="14" rx="4" fill="${ink}"/></g>`
    : '';

  const badge = showBadge
    ? `<g transform="translate(${S - 78}, 36)"><rect x="0" y="0" width="56" height="56" rx="14" fill="white" stroke="${ink}" stroke-width="5"/><line x1="10" y1="20" x2="18" y2="20" stroke="#1F9D55" stroke-width="5" stroke-linecap="round"/><line x1="14" y1="16" x2="14" y2="24" stroke="#1F9D55" stroke-width="5" stroke-linecap="round"/><line x1="24" y1="20" x2="46" y2="20" stroke="#1F9D55" stroke-width="5" stroke-linecap="round"/><line x1="10" y1="38" x2="18" y2="38" stroke="#D64545" stroke-width="5" stroke-linecap="round"/><line x1="24" y1="38" x2="42" y2="38" stroke="#D64545" stroke-width="5" stroke-linecap="round"/></g>`
    : '';

  const bgShape =
    shape === 'circle'
      ? `<circle cx="${S / 2}" cy="${S / 2}" r="150" fill="${bg}"/>`
      : shape === 'squircle'
        ? `<rect x="10" y="10" width="300" height="300" rx="68" ry="68" fill="${bg}"/>`
        : '';

  return [
    bgShape,
    `<g>`,
    `<path d="${hairD}" fill="${ink}"/>`,
    `<circle cx="${cx}" cy="${cy}" r="94" fill="${skin}" stroke="${ink}" stroke-width="${strokeW}"/>`,
    `<path d="${hairD}" fill="${ink}"/>`,
    `<ellipse cx="${cx - 92}" cy="${cy + 8}" rx="9" ry="14" fill="${skin}" stroke="${ink}" stroke-width="${strokeW}"/>`,
    `<ellipse cx="${cx + 92}" cy="${cy + 8}" rx="9" ry="14" fill="${skin}" stroke="${ink}" stroke-width="${strokeW}"/>`,
    hat,
    `<circle cx="${cx - 56}" cy="${cy + 28}" r="11" fill="${blush}" opacity="0.7"/>`,
    `<circle cx="${cx + 56}" cy="${cy + 28}" r="11" fill="${blush}" opacity="0.7"/>`,
    `<path d="M ${cx - 52} ${glassY - 26} Q ${cx - 38} ${glassY - 34} ${cx - 22} ${glassY - 26}" stroke="${ink}" stroke-width="6" stroke-linecap="round" fill="none"/>`,
    `<path d="M ${cx + 22} ${glassY - 26} Q ${cx + 38} ${glassY - 34} ${cx + 52} ${glassY - 26}" stroke="${ink}" stroke-width="6" stroke-linecap="round" fill="none"/>`,
    `<g>`,
    `<line x1="${cx - (glassDX - lensW / 2)}" y1="${glassY}" x2="${cx + (glassDX - lensW / 2)}" y2="${glassY}" stroke="${ink}" stroke-width="6" stroke-linecap="round"/>`,
    lensLeft,
    lensRight,
    eyes,
    `<line x1="${cx - glassDX - lensRX}" y1="${glassY - 2}" x2="${cx - glassDX - lensRX - 12}" y2="${glassY - 8}" stroke="${ink}" stroke-width="6" stroke-linecap="round"/>`,
    `<line x1="${cx + glassDX + lensRX}" y1="${glassY - 2}" x2="${cx + glassDX + lensRX + 12}" y2="${glassY - 8}" stroke="${ink}" stroke-width="6" stroke-linecap="round"/>`,
    `</g>`,
    `<path d="M ${cx - 6} ${cy + 30} Q ${cx} ${cy + 38} ${cx + 6} ${cy + 30}" stroke="${ink}" stroke-width="5" stroke-linecap="round" fill="none"/>`,
    `<path d="${mustacheD}" fill="${ink}"/>`,
    `<path d="M ${cx} ${cy + 48} Q ${cx} ${cy + 60} ${cx - 2} ${cy + 66}" stroke="${skin}" stroke-width="2" stroke-linecap="round" fill="none" opacity="0.4"/>`,
    `<path d="M ${cx - 14} ${cy + 80} Q ${cx} ${cy + 92} ${cx + 14} ${cy + 80}" stroke="${ink}" stroke-width="5" stroke-linecap="round" fill="none"/>`,
    `</g>`,
    badge,
  ].join('');
}

export function renderDadMarkSVG(opts: RenderOptions = {}): string {
  const { size = 320, ...rest } = opts;
  return `<svg viewBox="0 0 ${S} ${S}" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">${dadMarkInner(rest)}</svg>`;
}

export const ACCENT_BG: Record<string, string> = {
  classic: '#6565ec',
  paprika: '#FF7A45',
  tomato: '#E05E4B',
  forest: '#3F7D5C',
  plum: '#7C5BA0',
  sky: '#4A8EC2',
  dadcore: '#FF7A45',
};
