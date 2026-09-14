import {
  estimatedAmount,
  hardAmount,
  type FlaggedAmount,
  type ListingContext,
  type WeightClass,
} from '../types.ts';

/**
 * Static zone/weight freight table (v1). Seed data only — deliberately coarse.
 * Zone is derived from the first digit of origin/destination zips (USPS-style
 * national zones); rates are per pallet. Every output is flagged as an
 * estimate: the UI must nag "get a real quote before bidding".
 */
const PER_PALLET_BY_ZONE = [80, 105, 130, 155, 180, 210, 240, 270, 300, 330];

const WEIGHT_MULTIPLIER: Record<WeightClass, number> = {
  light: 0.85,
  standard: 1,
  heavy: 1.3,
};

/** Additional pallets on the same truck cost less than the first. */
const ADDITIONAL_PALLET_FACTOR = 0.85;

export const FREIGHT_ESTIMATE_REASON = 'freight-estimate';

const ZIP_RE = /^\d{5}(-\d{4})?$/;

export function estimateFreight(input: {
  originZip: string;
  destZip: string;
  palletCount: number;
  weightClass: WeightClass;
}): FlaggedAmount {
  if (!ZIP_RE.test(input.originZip)) throw new Error(`Invalid origin zip: ${input.originZip}`);
  if (!ZIP_RE.test(input.destZip)) throw new Error(`Invalid destination zip: ${input.destZip}`);
  if (!Number.isFinite(input.palletCount) || input.palletCount < 1) {
    throw new Error(`palletCount must be >= 1, got ${input.palletCount}`);
  }

  const zone = Math.min(
    Math.abs(Number(input.originZip[0]) - Number(input.destZip[0])),
    PER_PALLET_BY_ZONE.length - 1,
  );
  const perPallet = PER_PALLET_BY_ZONE[zone] * WEIGHT_MULTIPLIER[input.weightClass];
  const pallets = Math.round(input.palletCount);
  const raw = perPallet + perPallet * ADDITIONAL_PALLET_FACTOR * (pallets - 1);
  const rounded = Math.round(raw / 5) * 5;
  return estimatedAmount(rounded, FREIGHT_ESTIMATE_REASON);
}

/**
 * Resolves freight for a lot: a real quote wins and is a hard number; without
 * one we estimate from seller zip + lot size (flagged); with neither, null.
 */
export function resolveFreight(
  context: ListingContext,
  homeZip: string | null,
): FlaggedAmount | null {
  if (context.shippingType === 'free' || context.shippingType === 'pickup') return hardAmount(0);
  if (context.freightQuote !== null && Number.isFinite(context.freightQuote)) {
    return hardAmount(context.freightQuote);
  }
  if (
    context.sellerZip !== null &&
    homeZip !== null &&
    ZIP_RE.test(context.sellerZip) &&
    ZIP_RE.test(homeZip) &&
    context.palletCount !== null &&
    context.palletCount >= 1
  ) {
    return estimateFreight({
      originZip: context.sellerZip,
      destZip: homeZip,
      palletCount: context.palletCount,
      weightClass: context.weightClass ?? 'standard',
    });
  }
  return null;
}
