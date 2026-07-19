export function fmtLapTime(s: number | null | undefined): string {
  if (s == null || !isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(3).padStart(6, '0')}`;
}

export function fmtSector(s: number | null | undefined): string {
  if (s == null || !isFinite(s)) return '—';
  return s.toFixed(3);
}

export function fmtGap(s: number | null | undefined): string {
  if (s == null || !isFinite(s)) return '—';
  if (s < 0.05) return '—';
  return `+${s.toFixed(1)}`;
}

export function fmtClock(s: number): string {
  const sign = s < 0 ? '-' : '';
  s = Math.abs(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const mm = String(m).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${sign}${h}:${mm}:${ss}` : `${sign}${mm}:${ss}`;
}

export const COMPOUND_COLORS: Record<string, string> = {
  S: '#ff2d2d',
  M: '#ffd12e',
  H: '#f0f0f0',
  I: '#3dd05f',
  W: '#3d9bff',
  '?': '#888888',
};

export function compoundColor(c: string): string {
  return COMPOUND_COLORS[c] ?? '#888888';
}
