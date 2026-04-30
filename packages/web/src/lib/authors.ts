const PALETTE = [
  "#6565EC",
  "#208368",
  "#CA244D",
  "#D97706",
  "#0EA5E9",
  "#7C3AED",
  "#059669",
  "#DC2626",
];

export type AuthorInfo = {
  initials: string;
  color: string;
  displayName: string;
  isBot: boolean;
};

export function getAuthorInfo(login: string): AuthorInfo {
  const isBot = login.endsWith("[bot]");
  const cleaned = isBot ? login.replace(/\[bot\]$/, "") : login;

  let hash = 0;
  for (let i = 0; i < login.length; i++) {
    hash = (hash * 31 + login.charCodeAt(i)) | 0;
  }
  const color = PALETTE[Math.abs(hash) % PALETTE.length] ?? PALETTE[0]!;

  const initials = cleaned.slice(0, 2).toUpperCase();
  const displayName = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);

  return { initials, color, displayName, isBot };
}
