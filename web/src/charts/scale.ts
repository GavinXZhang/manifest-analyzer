/** Shared geometry + axis helpers for the hand-rolled SVG charts. */

export const SERIES = '#2f7fb8';
export const SERIES_SOFT = 'rgba(47, 127, 184, 0.45)';
export const GHOST = '#eceef2';
export const SECONDARY = '#5f6b7a';

export interface Frame {
  w: number;
  h: number;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
}

export const FRAME: Frame = { w: 1120, h: 260, padL: 56, padR: 16, padT: 22, padB: 30 };

/** A "nice" axis max: 1/2/5 × 10^n at or above the value. */
export function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  const n = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return n * p;
}

export function ticks(max: number, count = 4): number[] {
  const out: number[] = [];
  for (let i = 0; i <= count; i += 1) out.push((max / count) * i);
  return out;
}

/** Evenly pick at most `max` label indexes from `n` slots (always first and last). */
export function labelIndexes(n: number, max = 5): Set<number> {
  const s = new Set<number>();
  if (n <= max) {
    for (let i = 0; i < n; i += 1) s.add(i);
    return s;
  }
  const step = (n - 1) / (max - 1);
  for (let i = 0; i < max; i += 1) s.add(Math.round(i * step));
  return s;
}

export const compact = (n: number): string => {
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1).replace(/\.0$/, '')}k`;
  return `${sign}$${Math.round(abs)}`;
};
