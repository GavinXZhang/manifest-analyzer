import type {
  BidBreakdown,
  ListingContext,
  LotValuation,
  RationaleSection,
} from '../types.ts';

/**
 * Template-driven v1 deal rationale. Deterministic given its inputs — the
 * clock is injected, never read.
 */

const pct = (x: number): string => `${Math.round(x * 100)}%`;
const usd = (x: number): string =>
  `$${x.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

type Season = { peakMonths: number[]; label: string };
/** month numbers are 0-based (Jan = 0) */
const SEASONS: Record<string, Season> = {
  outdoor: { peakMonths: [3, 4, 5, 6, 7], label: 'spring/summer outdoor season' },
  garden: { peakMonths: [3, 4, 5, 6, 7], label: 'spring/summer garden season' },
  patio: { peakMonths: [3, 4, 5, 6, 7], label: 'spring/summer patio season' },
  sports: { peakMonths: [3, 4, 5, 6, 7], label: 'spring/summer sports season' },
  toys: { peakMonths: [9, 10, 11], label: 'holiday toy season' },
  games: { peakMonths: [9, 10, 11], label: 'holiday season' },
  electronics: { peakMonths: [10, 11], label: 'holiday electronics season' },
  holiday: { peakMonths: [9, 10, 11], label: 'holiday season' },
};

export interface RationaleInputs {
  valuation: LotValuation;
  bid: BidBreakdown;
  context: ListingContext;
  /** Dominant category of the lot by value (null when uncategorized). */
  category: string | null;
  now: Date;
}

export function buildRationale(input: RationaleInputs): RationaleSection[] {
  return [
    valueComposition(input),
    location(input),
    seasonality(input),
    competition(input),
    confidence(input),
  ];
}

function valueComposition({ valuation }: RationaleInputs): RationaleSection {
  const total = valuation.expectedRevenue.amount;
  if (total <= 0) {
    return {
      topic: 'value-composition',
      title: 'Where the money is',
      text: 'No resale value could be estimated for this lot yet — add comps or check the manifest.',
    };
  }
  const top = [...valuation.items].sort((a, b) => b.extendedResale - a.extendedResale).slice(0, 3);
  const parts = top
    .filter((t) => t.extendedResale > 0)
    .map((t) => `${t.description} (${usd(t.extendedResale)}, ${pct(t.extendedResale / total)})`);
  let text = `Top value drivers: ${parts.join('; ')}.`;
  if (valuation.hasGrailRisk) {
    text +=
      ` Grail risk: ${valuation.grailItemIds.length} item(s) hold over 40% of the estimated value.` +
      ` If they are missing or misgraded the lot math collapses, so the recommended max bid uses the` +
      ` grails-excluded valuation of ${usd(valuation.breadAndButterRevenue.amount)} (full valuation ${usd(total)}).`;
  }
  return { topic: 'value-composition', title: 'Where the money is', text };
}

function location({ bid, context }: RationaleInputs): RationaleSection {
  const freight = bid.freight.amount;
  if (freight <= 0 && !bid.freight.isEstimate) {
    return {
      topic: 'location',
      title: 'Location & freight',
      text:
        context.shippingType === 'pickup'
          ? 'Local pickup — no freight drag on this lot.'
          : 'Freight is $0 for this lot.',
    };
  }
  const budget = bid.totalBudget.amount;
  const share = budget > 0 ? ` — ${pct(freight / budget)} of your total budget` : '';
  let text = `Freight is ${usd(freight)}${share}. Every freight dollar comes straight out of your auction budget (${usd(freight)} of freight lowers your max bid by about ${usd(Math.round(freight / (1 + bid.buyersPremiumRate)))}).`;
  if (bid.freight.isEstimate) {
    text += ' This freight number is an estimate — get a real quote before bidding.';
  }
  return { topic: 'location', title: 'Location & freight', text };
}

function seasonality({ category, now }: RationaleInputs): RationaleSection {
  const key = category === null ? null : Object.keys(SEASONS).find((k) => category.toLowerCase().includes(k));
  if (key === undefined || key === null) {
    return {
      topic: 'seasonality',
      title: 'Seasonality',
      text: 'No strong seasonal pattern for this category — demand should be steady year-round.',
    };
  }
  const season = SEASONS[key];
  const month = now.getMonth();
  const inSeason = season.peakMonths.includes(month);
  const text = inSeason
    ? `This category is in its ${season.label} right now — expect faster sell-through, but also more bidders who know it.`
    : `This category is off-season (peak is the ${season.label}). Off-season lots often close cheaper — a discount opportunity — but plan for longer holding time and storage until demand returns.`;
  return { topic: 'seasonality', title: 'Seasonality', text };
}

const LOW_BID_COUNT = 2;
const NEAR_CLOSE_HOURS = 24;

function competition({ context, now }: RationaleInputs): RationaleSection {
  const { bidCount, endTime } = context;
  if (bidCount === null && endTime === null) {
    return {
      topic: 'competition',
      title: 'Competition',
      text: 'No bid count or end time entered — add them from the listing page to read demand.',
    };
  }
  const hoursLeft =
    endTime !== null ? (new Date(endTime).getTime() - now.getTime()) / 3_600_000 : null;
  const timePhrase =
    hoursLeft === null
      ? ''
      : hoursLeft <= 0
        ? ' The auction has ended.'
        : hoursLeft < NEAR_CLOSE_HOURS
          ? ` About ${Math.max(1, Math.round(hoursLeft))}h remain.`
          : ` About ${Math.round(hoursLeft / 24)} day(s) remain.`;

  let text: string;
  if (bidCount !== null && bidCount <= LOW_BID_COUNT && hoursLeft !== null && hoursLeft > 0 && hoursLeft < NEAR_CLOSE_HOURS) {
    text =
      `Only ${bidCount} bid(s) with under ${NEAR_CLOSE_HOURS}h remaining — low competition is a favorable signal for closing near your number.` +
      ` But quiet auctions can also mean other buyers spotted a problem you missed: re-check the manifest (conditions, grail items, freight) before bidding.` +
      timePhrase;
  } else if (bidCount !== null && bidCount <= LOW_BID_COUNT) {
    text = `Only ${bidCount} bid(s) so far, but there is plenty of time left — most action on B-Stock arrives near close, so this is weak evidence either way.${timePhrase}`;
  } else if (bidCount !== null && bidCount >= 8) {
    text = `${bidCount} bids is strong demand — expect the close to run up. Your walk-away number does not move because others are excited.${timePhrase}`;
  } else if (bidCount !== null) {
    text = `${bidCount} bids — moderate interest.${timePhrase}`;
  } else {
    text = `No bid count entered.${timePhrase}`;
  }
  return { topic: 'competition', title: 'Competition', text };
}

function confidence({ valuation }: RationaleInputs): RationaleSection {
  const s = valuation.confidenceShares;
  const withComps = valuation.items.filter((i) => i.compCount > 0).length;
  let text = `${pct(s.high)} of the valuation is high-confidence (≥3 sold comps), ${pct(s.medium)} medium (1–2 comps), ${pct(s.low)} low (MSRP-floor guesses). ${withComps} of ${valuation.items.length} line items have comps.`;
  if (valuation.unverifiedValueShare > 0) {
    text += ` ${pct(valuation.unverifiedValueShare)} of the value sits in rows with no identifier at all — unverifiable until you inspect.`;
  }
  return { topic: 'confidence', title: 'Valuation confidence', text };
}
