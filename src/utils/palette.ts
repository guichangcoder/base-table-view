/** 分组配色预设（避免随意取色，保证浅色白底下的可读性） */
export const GROUP_COLORS = [
  '#3370ff',
  '#2ea121',
  '#f59a23',
  '#f54a45',
  '#7f3bf5',
  '#14c0ff',
  '#646a73',
  '#d83931',
];

/** 强调字体颜色预设 */
export const EMPHASIS_COLORS = ['#d83931', '#f59a23', '#2ea121', '#3370ff', '#7f3bf5', '#1f2329'];

export interface GroupTone {
  /** 色条 / 标题色 */
  color: string;
  /** 区块浅底色 */
  bg: string;
  /** 区块边框 */
  border: string;
}

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return `rgba(51, 112, 255, ${alpha})`;
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function toneOf(color: string): GroupTone {
  const c = color || '#3370ff';
  return { color: c, bg: hexToRgba(c, 0.045), border: hexToRgba(c, 0.22) };
}