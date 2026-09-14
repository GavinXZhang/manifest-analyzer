/**
 * Core domain types for the manifest analyzer.
 *
 * Compliance invariant: nothing in this codebase fetches from bstock.com or
 * any B-Stock-powered marketplace. All B-Stock data enters via user-downloaded
 * manifest files and the manual listing-context form.
 */

export type IdentifierType = 'UPC' | 'ASIN' | 'model' | 'none';

/** Normalized condition grades. Raw manifest condition text is preserved separately. */
export type ConditionGrade = 'new' | 'like-new' | 'customer-returns' | 'salvage' | 'unknown';

export const CONDITION_GRADES: ConditionGrade[] = [
  'new',
  'like-new',
  'customer-returns',
  'salvage',
  'unknown',
];

/** Canonical line-item schema every manifest normalizes into. */
export interface CanonicalItem {
  description: string;
  identifierType: IdentifierType;
  identifier: string | null;
  quantity: number;
  unitMsrp: number | null;
  conditionRaw: string;
  conditionGrade: ConditionGrade;
  category: string | null;
  /** True when the row has no usable identifier (or no MSRP) and cannot be verified against comps. */
  unverifiable: boolean;
}

export interface LineItem extends CanonicalItem {
  id: number;
  lotId: number;
  /**
   * Today's listed retail price, entered by the user from the retailer's site
   * (manifest MSRP goes stale; this is the "compare at" price for resale listings).
   */
  currentRetail?: number | null;
}

/** Canonical column keys a manifest column can map onto. */
export type CanonicalField =
  | 'description'
  | 'upc'
  | 'asin'
  | 'model'
  | 'quantity'
  | 'unit_msrp'
  | 'condition'
  | 'category';

export const CANONICAL_FIELDS: CanonicalField[] = [
  'description',
  'upc',
  'asin',
  'model',
  'quantity',
  'unit_msrp',
  'condition',
  'category',
];

/** Fields that must be mapped for an analysis to be meaningful. */
export const REQUIRED_FIELDS: CanonicalField[] = ['description', 'quantity', 'unit_msrp'];

/** header text (as it appears in the file) -> canonical field */
export type ColumnMapping = Partial<Record<CanonicalField, string>>;

export interface MappingProposal {
  mapping: ColumnMapping;
  /** Per-field match score in [0,1]. */
  fieldConfidence: Partial<Record<CanonicalField, number>>;
  /** Overall confidence: min score across REQUIRED_FIELDS (0 when a required field is unmapped). */
  confidence: number;
  /** True when confidence is below the auto-accept threshold and the user must confirm. */
  needsConfirmation: boolean;
  /** Where the proposal came from. */
  source: 'saved-seller-mapping' | 'auto';
}

export type WeightClass = 'light' | 'standard' | 'heavy';
export type ShippingType = 'buyer-freight' | 'seller-flat-rate' | 'free' | 'pickup';

/** A dollar amount that knows whether it is a hard number or an estimate. */
export interface FlaggedAmount {
  amount: number;
  isEstimate: boolean;
  /** Why this is an estimate (empty when isEstimate is false). */
  estimateReasons: string[];
}

export function hardAmount(amount: number): FlaggedAmount {
  return { amount, isEstimate: false, estimateReasons: [] };
}

export function estimatedAmount(amount: number, reason: string): FlaggedAmount {
  return { amount, isEstimate: true, estimateReasons: [reason] };
}

/** Manually entered per-lot listing context (never scraped). */
export interface ListingContext {
  currentBid: number | null;
  bidCount: number | null;
  /** ISO-8601 auction end time. */
  endTime: string | null;
  shippingType: ShippingType | null;
  /** A real freight quote if the user has one. */
  freightQuote: number | null;
  /** For estimation when no quote: seller zip + lot size. */
  sellerZip: string | null;
  palletCount: number | null;
  weightClass: WeightClass | null;
  marketplace: string | null;
  /** Buyer's premium rate, default 0.10. */
  buyersPremiumRate: number;
}

export const DEFAULT_BUYERS_PREMIUM = 0.1;

export function emptyListingContext(): ListingContext {
  return {
    currentBid: null,
    bidCount: null,
    endTime: null,
    shippingType: null,
    freightQuote: null,
    sellerZip: null,
    palletCount: null,
    weightClass: null,
    marketplace: null,
    buyersPremiumRate: DEFAULT_BUYERS_PREMIUM,
  };
}

export type RequiredProfit =
  | { kind: 'absolute'; amount: number }
  | { kind: 'percent'; percent: number };

/** Buyer constraints, applied automatically to every analysis. */
export interface Profile {
  homeZip: string | null;
  maxSpendPerLot: number | null;
  requiredProfit: RequiredProfit;
  acceptableConditions: ConditionGrade[];
  categoriesOfInterest: string[];
  preferredSellers: string[];
  sellingFeeRate: number;
  defaultBuyersPremiumRate: number;
  conservativeFloorRate: number;
  sellThroughProbability: number;
  /** User's estimated federal marginal income-tax rate (for the MA set-aside estimator). */
  estimatedFederalRate: number;
  /** Revenue target per month; drives the goal ghost-bar on the Money chart (null = no goal). */
  monthlyRevenueGoal: number | null;
  /** Days on shelf before an item is flagged. */
  agingWarnDays: number;
  /** Days on shelf before a price cut is suggested. */
  agingCutDays: number;
  /** Fraction taken off every active ask by "Cut price" (0.1 = 10%). */
  priceCutFraction: number;
  /** Days a won lot may sit unchecked before it is flagged. */
  checkinOverdueDays: number;
  /** $/hour used to cost labor per lot; null = trailing profit per hour. */
  hourlyValue: number | null;
  /** IANA zone for day bucketing (time card, due dates). */
  timeZone: string;
}

export function defaultProfile(): Profile {
  return {
    homeZip: null,
    maxSpendPerLot: null,
    requiredProfit: { kind: 'percent', percent: 0.3 },
    acceptableConditions: ['new', 'like-new', 'customer-returns', 'unknown'],
    categoriesOfInterest: [],
    preferredSellers: [],
    sellingFeeRate: 0.15,
    defaultBuyersPremiumRate: DEFAULT_BUYERS_PREMIUM,
    conservativeFloorRate: 0.1,
    sellThroughProbability: 0.9,
    estimatedFederalRate: 0.12,
    monthlyRevenueGoal: null,
    agingWarnDays: 21,
    agingCutDays: 30,
    priceCutFraction: 0.1,
    checkinOverdueDays: 7,
    hourlyValue: null,
    timeZone: 'America/New_York',
  };
}

export type RecoveryRates = Record<ConditionGrade, number>;

export const DEFAULT_RECOVERY_RATES: RecoveryRates = {
  'new': 0.55,
  'like-new': 0.45,
  'customer-returns': 0.35,
  'salvage': 0.1,
  'unknown': 0.2,
};

export type MappingStatus = 'pending' | 'confirmed';

export interface Lot {
  id: number;
  name: string;
  seller: string;
  unmanifested: boolean;
  mappingStatus: MappingStatus;
  context: ListingContext;
  createdAt: string;
}

export interface Outcome {
  lotId: number;
  won: boolean;
  finalPrice: number | null;
  grossRecovered: number | null;
  /** Snapshot of predictions at the time the outcome was recorded. */
  predictedRevenue: number | null;
  predictedMaxBid: number | null;
  recordedAt: string;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface ItemValuation {
  itemId: number;
  description: string;
  quantity: number;
  unitMsrp: number | null;
  conditionGrade: ConditionGrade;
  /** Per-unit resale estimate. */
  unitResale: number;
  /** unitResale × quantity. */
  extendedResale: number;
  confidence: Confidence;
  /** True when valued via the conservative MSRP floor (no comps). */
  flooredValuation: boolean;
  unverifiable: boolean;
  grailRisk: boolean;
  compCount: number;
}

export interface LotValuation {
  items: ItemValuation[];
  /** Full expected revenue including grail items. */
  expectedRevenue: FlaggedAmount;
  /** Expected revenue excluding grail-risk items ("bread and butter"). */
  breadAndButterRevenue: FlaggedAmount;
  hasGrailRisk: boolean;
  grailItemIds: number[];
  /** Share (0..1) of expected revenue from unverifiable rows. */
  unverifiedValueShare: number;
  /** Share of expected revenue by confidence tier. */
  confidenceShares: Record<Confidence, number>;
  extendedRetail: number;
  totalUnits: number;
}

export interface BidBreakdown {
  expectedRevenue: FlaggedAmount;
  sellingCosts: FlaggedAmount;
  requiredProfit: FlaggedAmount;
  totalBudget: FlaggedAmount;
  freight: FlaggedAmount;
  auctionBudget: FlaggedAmount;
  /** Floored to whole dollars. */
  maxBid: FlaggedAmount;
  /** null when the lot has zero units. */
  landedUnitPrice: FlaggedAmount | null;
  buyersPremiumRate: number;
  sellingFeeRate: number;
  totalUnits: number;
}

export type VerdictDecision = 'BID' | 'PASS';

export interface Verdict {
  decision: VerdictDecision;
  /** Walk-away number (null when PASS makes bidding moot). */
  maxBid: FlaggedAmount | null;
  /** Named reasons for a PASS (violated constraint, current bid above walk-away, ...). */
  passReasons: string[];
  /** Human-readable estimate warnings that must accompany any estimated number. */
  estimateWarnings: string[];
}

export interface MarketEstimate {
  /** Predicted closing range in dollars for this lot. */
  low: number;
  high: number;
  /** The underlying range as a share of extended retail. */
  lowPctOfRetail: number;
  highPctOfRetail: number;
  sampleSize: number;
  label: 'market estimate';
}

export interface Analysis {
  lotId: number;
  valuation: LotValuation;
  bid: BidBreakdown;
  verdict: Verdict;
  rationale: RationaleSection[];
  marketEstimate: MarketEstimate | null;
}

export interface RationaleSection {
  topic: 'value-composition' | 'location' | 'seasonality' | 'competition' | 'confidence';
  title: string;
  text: string;
}
