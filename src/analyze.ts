import type { Db } from './store/db.ts';
import {
  estimatedAmount,
  type Analysis,
  type FlaggedAmount,
  type LineItem,
  type MarketEstimate,
} from './types.ts';
import { getLot, getLineItems, getCompsForLot } from './store/lots.ts';
import { getProfile } from './store/profile.ts';
import { getRecoveryRates, getSegmentOverride } from './store/rates.ts';
import { listSegmentOutcomes } from './store/outcomes.ts';
import { resolveFreight } from './ingest/freight.ts';
import { valueLot } from './valuation/valuation.ts';
import { predictClosingRange } from './valuation/calibration.ts';
import { computeBidFlagged } from './calc/bid.ts';
import { decideVerdict } from './calc/verdict.ts';
import { buildRationale } from './reasoning/rationale.ts';

export const FREIGHT_MISSING_REASON = 'freight-missing';

/** Lot's dominant category by extended MSRP (must match listSegmentOutcomes' SQL). */
export function dominantCategory(items: LineItem[]): string {
  const byCat = new Map<string, number>();
  for (const i of items) {
    if (i.category === null) continue;
    byCat.set(i.category, (byCat.get(i.category) ?? 0) + i.quantity * (i.unitMsrp ?? 0));
  }
  if (byCat.size === 0) return 'uncategorized';
  return [...byCat.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export async function analyzeLot(db: Db, lotId: number, now: Date = new Date()): Promise<Analysis> {
  const [lot, items, profile, rates, compsForLot] = await Promise.all([
    getLot(db, lotId),
    getLineItems(db, lotId),
    getProfile(db),
    getRecoveryRates(db),
    getCompsForLot(db, lotId),
  ]);
  if (!lot) throw new Error(`No lot with id ${lotId}`);

  const category = dominantCategory(items);
  const override = await getSegmentOverride(db, lot.seller.trim().toLowerCase(), category);

  const soldPricesByItemId = new Map<number, number[]>();
  for (const [itemId, comps] of compsForLot) {
    soldPricesByItemId.set(itemId, comps.map((c) => c.soldPrice));
  }

  const valuation = valueLot({
    items,
    soldPricesByItemId,
    rates,
    segmentMultiplier: override?.multiplier ?? 1,
    conservativeFloorRate: profile.conservativeFloorRate,
    sellThroughProbability: profile.sellThroughProbability,
  });

  // Freight: quote (hard) > zip estimate (flagged) > missing ($0, flagged —
  // downstream numbers must never look trustworthy with no freight entered).
  const freight: FlaggedAmount =
    resolveFreight(lot.context, profile.homeZip) ?? estimatedAmount(0, FREIGHT_MISSING_REASON);

  // Conservative by default: with grail risk flagged, the recommended bid is
  // computed from the grails-excluded valuation.
  const revenueForBid = valuation.hasGrailRisk
    ? valuation.breadAndButterRevenue
    : valuation.expectedRevenue;

  const bid = computeBidFlagged({
    expectedRevenue: revenueForBid,
    sellingFeeRate: profile.sellingFeeRate,
    requiredProfit: profile.requiredProfit,
    freight,
    buyersPremiumRate: lot.context.buyersPremiumRate,
    totalUnits: valuation.totalUnits,
  });

  const verdict = decideVerdict({
    bid,
    valuation,
    profile,
    currentBid: lot.context.currentBid,
  });

  let marketEstimate: MarketEstimate | null = null;
  if (valuation.extendedRetail > 0) {
    const range = predictClosingRange(await listSegmentOutcomes(db), lot.seller, category);
    if (range) {
      marketEstimate = {
        low: Math.round(range.lowPctOfRetail * valuation.extendedRetail),
        high: Math.round(range.highPctOfRetail * valuation.extendedRetail),
        lowPctOfRetail: range.lowPctOfRetail,
        highPctOfRetail: range.highPctOfRetail,
        sampleSize: range.sampleSize,
        label: 'market estimate',
      };
    }
  }

  return {
    lotId,
    valuation,
    bid,
    verdict,
    rationale: buildRationale({
      valuation,
      bid,
      context: lot.context,
      category: category === 'uncategorized' ? null : category,
      now,
    }),
    marketEstimate,
  };
}
