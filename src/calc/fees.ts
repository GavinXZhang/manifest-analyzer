/** Fee rule of a selling channel; percentages are fractions (0.1325 = 13.25%). */
export interface FeeRule {
  feePercent: number;
  feeFixed: number;
  /** null → shipped sales use the same rule as local ones. */
  shippedFeePercent: number | null;
  shippedFeeFixed: number | null;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function feeFor(ask: number, rule: FeeRule, shipped = false): number {
  const pct = shipped && rule.shippedFeePercent !== null ? rule.shippedFeePercent : rule.feePercent;
  const fixed = shipped && rule.shippedFeeFixed !== null ? rule.shippedFeeFixed : rule.feeFixed;
  if (ask <= 0) return 0;
  return round2(ask * pct + fixed);
}

/** What the seller keeps after the channel's fee. */
export function netAfterFees(ask: number, rule: FeeRule, shipped = false): number {
  return round2(ask - feeFor(ask, rule, shipped));
}

export interface NetOption<T> {
  source: T;
  net: number;
}

/** The option that leaves the most money in hand (null when there are none). */
export function bestNet<T>(options: NetOption<T>[]): NetOption<T> | null {
  let best: NetOption<T> | null = null;
  for (const o of options) if (best === null || o.net > best.net) best = o;
  return best;
}
