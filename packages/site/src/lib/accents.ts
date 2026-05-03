export type AccentId = 'classic' | 'paprika' | 'tomato' | 'forest' | 'plum' | 'sky' | 'dadcore';

export interface AccentMeta {
  id: AccentId;
  name: string;
  dot: string;
}

export const ACCENTS: AccentMeta[] = [
  { id: 'classic', name: 'Iris', dot: '#6565ec' },
  { id: 'paprika', name: 'Paprika', dot: '#FF7A45' },
  { id: 'tomato', name: 'Tomato', dot: '#E05E4B' },
  { id: 'forest', name: 'Forest', dot: '#3F7D5C' },
  { id: 'plum', name: 'Plum', dot: '#7C5BA0' },
  { id: 'sky', name: 'Sky', dot: '#4A8EC2' },
  { id: 'dadcore', name: 'Dadcore', dot: '#FF7A45' },
];

export const DEFAULT_ACCENT: AccentId = 'dadcore';
