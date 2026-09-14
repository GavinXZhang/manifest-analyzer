import type {
  BidBreakdown,
  FlaggedAmount,
  LotValuation,
  Profile,
  Verdict,
} from '../types.ts';
import { FLOOR_VALUATION_REASON, UNVERIFIED_ROWS_REASON } from '../valuation/valuation.ts';
import { FREIGHT_ESTIMATE_REASON } from '../ingest/freight.ts';

export const PASS_CURRENT_BID = 'current bid above your walk-away number';
export const PASS_MAX_SPEND = 'max spend per lot';
export const PASS_CONDITION = 'unacceptable condition';
export const PASS_NO_PROFITABLE_BID = 'no profitable bid at your required profit';

function estimateWarningsFor(amount: FlaggedAmount, valuation: LotValuation): string[] {
  const warnings: string[] = [];
  for (const reason of amount.estimateReasons) {
    if (reason === FREIGHT_ESTIMATE_REASON) {
      warnings.push('Freight is an estimate — get a real quote before bidding.');
    } else if (reason === 'freight-missing') {
      warnings.push('No freight entered — these numbers assume $0 freight. Add a quote or seller zip.');
    } else if (reason === FLOOR_VALUATION_REASON) {
      warnings.push('Some items are valued at the conservative MSRP floor (no comps entered).');
    } else if (reason === UNVERIFIED_ROWS_REASON) {
      warnings.push(
        `${Math.round(valuation.unverifiedValueShare * 100)}% of the valuation is unverifiable (rows without identifiers).`,
      );
    } else {
      warnings.push(`Estimated input: ${reason}.`);
    }
  }
  return warnings;
}

/**
 * Applies the buyer's hard constraints and the current-bid check to the
 * computed walk-away number. PASS verdicts name the violated constraint.
 */
export function decideVerdict(input: {
  bid: BidBreakdown;
  valuation: LotValuation;
  profile: Profile;
  currentBid: number | null;
}): Verdict {
  const { bid, valuation, profile, currentBid } = input;
  const passReasons: string[] = [];
  let maxBid: FlaggedAmount = { ...bid.maxBid };

  // Hard constraint: condition grades outside the acceptable set.
  const acceptable = new Set(profile.acceptableConditions);
  const badGrades = [...new Set(
    valuation.items.filter((i) => !acceptable.has(i.conditionGrade)).map((i) => i.conditionGrade),
  )];
  for (const grade of badGrades) {
    passReasons.push(
      `${PASS_CONDITION}: lot contains "${grade}" items, which is outside your acceptable conditions`,
    );
  }

  // Hard constraint: max spend per lot caps total outlay (bid × (1+premium) + freight).
  if (profile.maxSpendPerLot !== null) {
    const spendCappedBid = Math.floor(
      (profile.maxSpendPerLot - bid.freight.amount) / (1 + bid.buyersPremiumRate),
    );
    if (spendCappedBid <= 0) {
      passReasons.push(
        `${PASS_MAX_SPEND}: freight and premium alone exceed your $${profile.maxSpendPerLot} max spend`,
      );
      maxBid = { ...maxBid, amount: 0 };
    } else if (spendCappedBid < maxBid.amount) {
      maxBid = { ...maxBid, amount: spendCappedBid };
    }
  }

  if (maxBid.amount <= 0 && passReasons.length === 0) {
    passReasons.push(PASS_NO_PROFITABLE_BID);
  }

  // Current bid vs walk-away, with the gap shown.
  if (currentBid !== null && maxBid.amount > 0 && currentBid > maxBid.amount) {
    const gap = Math.round((currentBid - maxBid.amount) * 100) / 100;
    passReasons.push(
      `${PASS_CURRENT_BID}: current bid $${currentBid} is $${gap} above your walk-away $${maxBid.amount}`,
    );
  }

  return {
    decision: passReasons.length > 0 ? 'PASS' : 'BID',
    maxBid,
    passReasons,
    estimateWarnings: estimateWarningsFor(maxBid, valuation),
  };
}
