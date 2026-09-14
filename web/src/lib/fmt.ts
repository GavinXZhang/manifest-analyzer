/** Formatting helpers shared by every screen. */

export const money = (n: number | null | undefined, opts: { cents?: boolean; sign?: boolean } = {}): string => {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  const s = abs.toLocaleString('en-US', { minimumFractionDigits: opts.cents ? 2 : 0, maximumFractionDigits: opts.cents ? 2 : 0 });
  const prefix = n < 0 ? '−$' : opts.sign && n > 0 ? '+$' : '$';
  return `${prefix}${s}`;
};

/** "~$42 *" for estimates, per the app's conservatism rule. */
export const est = (n: number | null | undefined, isEstimate: boolean, cents = false): string =>
  n === null || n === undefined ? '—' : `${isEstimate ? '~' : ''}${money(n, { cents })}${isEstimate ? ' *' : ''}`;

export const pct = (f: number | null | undefined, digits = 0): string =>
  f === null || f === undefined || !Number.isFinite(f) ? '—' : `${(f * 100).toFixed(digits)}%`;

export const hours = (h: number): string => {
  if (h < 1) return `${Math.round(h * 60)}m`;
  const whole = Math.floor(h);
  const m = Math.round((h - whole) * 60);
  return m === 0 ? `${whole}h` : `${whole}h ${m}m`;
};

export const shortDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

export const longDate = (iso: string): string => {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
};

export const dayName = (iso: string): string => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' });

export const timeOf = (iso: string): string => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

export const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const relTime = (iso: string): string => {
  const ms = Date.parse(iso) - Date.now();
  const abs = Math.abs(ms);
  const h = Math.round(abs / 3600_000);
  const d = Math.round(abs / 86_400_000);
  const s = h < 1 ? `${Math.max(1, Math.round(abs / 60_000))}m` : h < 36 ? `${h}h` : `${d}d`;
  return ms < 0 ? `${s} ago` : `in ${s}`;
};

/** Parse "95, 110, 120" into numbers, ignoring junk. */
export const parseNumbers = (s: string): number[] =>
  s.split(/[,\s;]+/).map((t) => Number(t.replace(/[$]/g, ''))).filter((n) => Number.isFinite(n) && n >= 0);

export const numOrNull = (v: string): number | null => {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t.replace(/[$,%]/g, ''));
  return Number.isFinite(n) ? n : null;
};
