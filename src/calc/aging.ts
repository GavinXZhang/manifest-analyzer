/**
 * Shelf time and what it costs. Pure functions; the store decides which dates
 * and which recurring expenses feed them.
 */

const DAY_MS = 86_400_000;

/** Whole days between two YYYY-MM-DD (or ISO) dates, never negative. */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(fromIso.length === 10 ? `${fromIso}T00:00:00Z` : fromIso);
  const to = Date.parse(toIso.length === 10 ? `${toIso}T00:00:00Z` : toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.floor((to - from) / DAY_MS));
}

/**
 * Storage cost of holding one unit for one day: this month's storage burn,
 * spread over the days in the month and the units on hand.
 */
export function carryingRatePerItemDay(monthlyStorage: number, daysInMonth: number, unitsOnHand: number): number {
  if (monthlyStorage <= 0 || daysInMonth <= 0 || unitsOnHand <= 0) return 0;
  return monthlyStorage / daysInMonth / unitsOnHand;
}

export function accruedCarryingCost(days: number, ratePerItemDay: number): number {
  return Math.round(days * ratePerItemDay * 100) / 100;
}

export type AgingLevel = 'ok' | 'warn' | 'cut';

export function agingLevel(days: number, warnDays: number, cutDays: number): AgingLevel {
  if (days >= cutDays) return 'cut';
  if (days >= warnDays) return 'warn';
  return 'ok';
}

export function daysInMonth(iso: string): number {
  const [y, m] = iso.slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
