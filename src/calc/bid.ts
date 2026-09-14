import type { BidBreakdown, FlaggedAmount, RequiredProfit } from '../types.ts';

/**
 * The backwards bid math, per spec — pure and deterministic:
 *
 *   expected_revenue   = Σ item resale estimates
 *   selling_costs      = expected_revenue × selling_fee_rate
 *   total_budget       = expected_revenue − selling_costs − required_profit
 *   auction_budget     = total_budget − freight
 *   max_bid            = auction_budget / (1 + buyers_premium)   (floored to whole dollars)
 *   landed_unit_price  = total_budget / total_units
 */

export interface BidInputs {
  expectedRevenue: number;
  sellingFeeRate: number;
  requiredProfit: RequiredProfit;
  freight: number;
  buyersPremiumRate: number;
  totalUnits: number;
}

export interface BidNumbers {
  expectedRevenue: number;
  sellingCosts: number;
  requiredProfitAmount: number;
  totalBudget: number;
  freight: number;
  auctionBudget: number;
  /** Whole dollars, never negative — a negative walk-away means "never bid". */
  maxBid: number;
  /** null when the lot has zero units. */
  landedUnitPrice: number | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function requiredProfitAmount(profit: RequiredProfit, expectedRevenue: number): number {
  return profit.kind === 'absolute' ? profit.amount : profit.percent * expectedRevenue;
}

export function computeBid(i: BidInputs): BidNumbers {
  const sellingCosts = i.expectedRevenue * i.sellingFeeRate;
  const profit = requiredProfitAmount(i.requiredProfit, i.expectedRevenue);
  const totalBudget = i.expectedRevenue - sellingCosts - profit;
  const auctionBudget = totalBudget - i.freight;
  const maxBid = Math.max(0, Math.floor(auctionBudget / (1 + i.buyersPremiumRate)));
  return {
    expectedRevenue: round2(i.expectedRevenue),
    sellingCosts: round2(sellingCosts),
    requiredProfitAmount: round2(profit),
    totalBudget: round2(totalBudget),
    freight: round2(i.freight),
    auctionBudget: round2(auctionBudget),
    maxBid,
    landedUnitPrice: i.totalUnits > 0 ? round2(totalBudget / i.totalUnits) : null,
  };
}

/**
 * Estimate-flag propagation: every number derived from an estimated input is
 * itself marked as an estimate, carrying the union of upstream reasons.
 */
export function computeBidFlagged(input: {
  expectedRevenue: FlaggedAmount;
  sellingFeeRate: number;
  requiredProfit: RequiredProfit;
  freight: FlaggedAmount;
  buyersPremiumRate: number;
  totalUnits: number;
}): BidBreakdown {
  const n = computeBid({
    expectedRevenue: input.expectedRevenue.amount,
    sellingFeeRate: input.sellingFeeRate,
    requiredProfit: input.requiredProfit,
    freight: input.freight.amount,
    buyersPremiumRate: input.buyersPremiumRate,
    totalUnits: input.totalUnits,
  });

  const from = (amount: number, ...sources: FlaggedAmount[]): FlaggedAmount => {
    const reasons = [...new Set(sources.flatMap((s) => s.estimateReasons))];
    return { amount, isEstimate: reasons.length > 0, estimateReasons: reasons };
  };
  const rev = input.expectedRevenue;
  const fr = input.freight;

  return {
    expectedRevenue: from(n.expectedRevenue, rev),
    sellingCosts: from(n.sellingCosts, rev),
    requiredProfit: from(n.requiredProfitAmount, ...(input.requiredProfit.kind === 'percent' ? [rev] : [])),
    totalBudget: from(n.totalBudget, rev),
    freight: from(n.freight, fr),
    auctionBudget: from(n.auctionBudget, rev, fr),
    maxBid: from(n.maxBid, rev, fr),
    landedUnitPrice: n.landedUnitPrice === null ? null : from(n.landedUnitPrice, rev),
    buyersPremiumRate: input.buyersPremiumRate,
    sellingFeeRate: input.sellingFeeRate,
    totalUnits: input.totalUnits,
  };
}
