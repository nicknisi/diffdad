export type AccentId = 'classic' | 'paprika' | 'tomato' | 'forest' | 'plum' | 'sky' | 'dadcore';

export type AccentMeta = {
  id: AccentId;
  name: string;
  dot: string;
  markBg: string;
};

export const ACCENTS: AccentMeta[] = [
  { id: 'classic', name: 'Classic', dot: '#6565ec', markBg: '#6565ec' },
  { id: 'paprika', name: 'Paprika', dot: '#FF7A45', markBg: '#FF7A45' },
  { id: 'tomato', name: 'Tomato', dot: '#E05E4B', markBg: '#E05E4B' },
  { id: 'forest', name: 'Forest', dot: '#3F7D5C', markBg: '#3F7D5C' },
  { id: 'plum', name: 'Plum', dot: '#7C5BA0', markBg: '#7C5BA0' },
  { id: 'sky', name: 'Sky', dot: '#4A8EC2', markBg: '#4A8EC2' },
  { id: 'dadcore', name: 'Dadcore', dot: '#FF7A45', markBg: '#FF7A45' },
];

export function getAccentMeta(id: AccentId): AccentMeta {
  return ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];
}
