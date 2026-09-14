import type {
  Confidence,
  FlaggedAmount,
  ItemValuation,
  LineItem,
  LotValuation,
  RecoveryRates,
} from '../types.ts';
import { effectiveRate } from './recovery.ts';
import { median } from './comps.ts';

export const FLOOR_VALUATION_REASON = 'floor-valuations';
export const UNVERIFIED_ROWS_REASON = 'unverified-rows';

/** Value share that ≤3 items must exceed to be flagged grail risk. */
export const GRAIL_SHARE_THRESHOLD = 0.4;
/** Grail flagging only makes sense for lots with more line items than the grail cap. */
const GRAIL_MIN_ITEMS = 4;

export interface ValuationInputs {
  items: LineItem[];
  /** Manually entered recent sold prices per line-item id. */
  soldPricesByItemId: Map<number, number[]>;
  rates: RecoveryRates;
  /** User-confirmed calibration multiplier for this seller/category segment. */
  segmentMultiplier?: number;
  /** Fallback rate on MSRP for items with no comps (profile, default 0.10). */
  conservativeFloorRate: number;
  /** Probability an item actually sells (profile, default 0.9). */
  sellThroughProbability: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Per-item resale estimate per spec:
 *   with comps:  median(sold) × condition_recovery_rate × sell_through_probability
 *   without:     unit_msrp × conservative_floor_rate     (low confidence)
 * ≥3 comps → high confidence; 1–2 → medium; none → low.
 */
export function valueLot(inputs: ValuationInputs): LotValuation {
  const {
    items,
    soldPricesByItemId,
    rates,
    segmentMultiplier = 1,
    conservativeFloorRate,
    sellThroughProbability,
  } = inputs;

  const valuations: ItemValuation[] = items.map((item) => {
    const comps = soldPricesByItemId.get(item.id) ?? [];
    let unitResale: number;
    let confidence: Confidence;
    let flooredValuation: boolean;
    if (comps.length > 0) {
      const compPrice = median(comps);
      unitResale =
        compPrice * effectiveRate(item.conditionGrade, rates, segmentMultiplier) * sellThroughProbability;
      confidence = comps.length >= 3 ? 'high' : 'medium';
      flooredValuation = false;
    } else {
      unitResale = (item.unitMsrp ?? 0) * conservativeFloorRate;
      confidence = 'low';
      flooredValuation = item.unitMsrp !== null;
    }
    return {
      itemId: item.id,
      description: item.description,
      quantity: item.quantity,
      unitMsrp: item.unitMsrp,
      conditionGrade: item.conditionGrade,
      unitResale: round2(unitResale),
      extendedResale: round2(unitResale * item.quantity),
      confidence,
      flooredValuation,
      unverifiable: item.unverifiable,
      grailRisk: false,
      compCount: comps.length,
    };
  });

  const total = valuations.reduce((s, v) => s + v.extendedResale, 0);

  // Grail risk: smallest k ≤ 3 top-value items holding > 40% of estimated value.
  let grailItemIds: number[] = [];
  if (items.length >= GRAIL_MIN_ITEMS && total > 0) {
    const sorted = [...valuations].sort((a, b) => b.extendedResale - a.extendedResale);
    let prefix = 0;
    for (let k = 0; k < 3; k++) {
      prefix += sorted[k].extendedResale;
      if (prefix > GRAIL_SHARE_THRESHOLD * total) {
        grailItemIds = sorted.slice(0, k + 1).map((v) => v.itemId);
        break;
      }
    }
  }
  const grailSet = new Set(grailItemIds);
  for (const v of valuations) v.grailRisk = grailSet.has(v.itemId);

  const sumWhere = (pred: (v: ItemValuation) => boolean): number =>
    round2(valuations.filter(pred).reduce((s, v) => s + v.extendedResale, 0));

  const unverifiedValue = sumWhere((v) => v.unverifiable);
  const flooredCount = valuations.filter((v) => v.flooredValuation).length;

  const makeRevenue = (amount: number): FlaggedAmount => {
    const reasons: string[] = [];
    if (flooredCount > 0) reasons.push(FLOOR_VALUATION_REASON);
    if (unverifiedValue > 0) reasons.push(UNVERIFIED_ROWS_REASON);
    return { amount: round2(amount), isEstimate: reasons.length > 0, estimateReasons: reasons };
  };

  const confidenceShares: Record<Confidence, number> = { high: 0, medium: 0, low: 0 };
  if (total > 0) {
    for (const tier of ['high', 'medium', 'low'] as const) {
      confidenceShares[tier] = round2(sumWhere((v) => v.confidence === tier) / total);
    }
  }

  return {
    items: valuations,
    expectedRevenue: makeRevenue(total),
    breadAndButterRevenue: makeRevenue(total - sumWhere((v) => v.grailRisk)),
    hasGrailRisk: grailItemIds.length > 0,
    grailItemIds,
    unverifiedValueShare: total > 0 ? round2(unverifiedValue / total) : items.length === 0 ? 1 : 0,
    confidenceShares,
    extendedRetail: round2(items.reduce((s, i) => s + i.quantity * (i.unitMsrp ?? 0), 0)),
    totalUnits: items.reduce((s, i) => s + i.quantity, 0),
  };
}
