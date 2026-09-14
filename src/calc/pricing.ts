/**
 * Per-item resale pricing bounds for the inventory view. Pure functions.
 *
 *   floor  = the least you can sell for and not lose money after selling fees:
 *            P − P·fee = cost  →  P = cost / (1 − fee)
 *   target = the price that also clears your required profit margin
 *            (margin as a share of the sale price):
 *            P − P·fee − P·margin = cost  →  P = cost / (1 − fee − margin)
 *
 * The ceiling is not computed — it is the current retail price the user
 * copied from the retailer's site; nobody pays more than "new" costs.
 */

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function floorPrice(cost: number, feeRate: number): number | null {
  if (!Number.isFinite(cost) || cost < 0 || feeRate < 0 || feeRate >= 1) return null;
  return round2(cost / (1 - feeRate));
}

export function targetPrice(cost: number, feeRate: number, marginRate: number): number | null {
  if (!Number.isFinite(cost) || cost < 0 || marginRate < 0) return null;
  const denom = 1 - feeRate - marginRate;
  if (denom <= 0) return null;
  return round2(cost / denom);
}
