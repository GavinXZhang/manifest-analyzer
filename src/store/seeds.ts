/**
 * Seed rows for tables that must not start empty: selling channels (fee rules)
 * and the salvage parts book. Every number here is the owner's starting
 * estimate and is editable in Settings — nothing is fetched from anywhere.
 */

export interface ChannelSeed {
  name: string;
  feePercent: number;
  feeFixed: number;
  shippedFeePercent: number | null;
  shippedFeeFixed: number | null;
  categories: string[];
  draftStyle: string;
  enabled: boolean;
}

export const CHANNEL_SEEDS: ChannelSeed[] = [
  { name: 'eBay', feePercent: 0.1325, feeFixed: 0.3, shippedFeePercent: null, shippedFeeFixed: null, categories: [], draftStyle: 'ebay', enabled: true },
  { name: 'Facebook Marketplace', feePercent: 0, feeFixed: 0, shippedFeePercent: 0.05, shippedFeeFixed: 0, categories: [], draftStyle: 'casual', enabled: true },
  { name: 'OfferUp', feePercent: 0, feeFixed: 0, shippedFeePercent: 0.129, shippedFeeFixed: 0, categories: [], draftStyle: 'short', enabled: true },
  { name: 'Mercari', feePercent: 0.129, feeFixed: 0.5, shippedFeePercent: null, shippedFeeFixed: null, categories: [], draftStyle: 'short', enabled: false },
  { name: 'AptDeco', feePercent: 0.3, feeFixed: 0, shippedFeePercent: null, shippedFeeFixed: null, categories: ['furniture'], draftStyle: 'furniture', enabled: true },
  { name: 'Craigslist', feePercent: 0, feeFixed: 0, shippedFeePercent: null, shippedFeeFixed: null, categories: ['furniture'], draftStyle: 'plain', enabled: false },
];

export interface PartSeed {
  name: string;
  low: number;
  high: number;
}

export interface FamilySeed {
  family: string;
  /** Every keyword must appear (token-bounded) in the line's description/brand/vendor. */
  keywords: string[];
  parts: PartSeed[];
}

/** Order matters: the first family whose keywords all match wins. */
export const PARTS_BOOK_SEEDS: FamilySeed[] = [
  { family: 'Dyson Outsize', keywords: ['DYSON', 'OUTSIZE'], parts: [
    { name: 'XL battery', low: 60, high: 90 }, { name: 'XL cleaner head', low: 60, high: 90 }, { name: 'Motor body', low: 100, high: 150 },
  ] },
  { family: 'Dyson V11', keywords: ['DYSON', 'V11'], parts: [
    { name: 'Battery (click-in)', low: 40, high: 70 }, { name: 'High Torque head', low: 50, high: 80 }, { name: 'Motor body', low: 80, high: 120 },
    { name: 'Wand', low: 15, high: 25 }, { name: 'Bin', low: 15, high: 25 }, { name: 'Charger', low: 10, high: 15 },
  ] },
  { family: 'Dyson V10', keywords: ['DYSON', 'V10'], parts: [
    { name: 'Battery', low: 35, high: 55 }, { name: 'Torque Drive head', low: 40, high: 60 }, { name: 'Motor body', low: 60, high: 90 }, { name: 'Wand / bin', low: 15, high: 25 },
  ] },
  { family: 'Dyson V8', keywords: ['DYSON', 'V8'], parts: [
    { name: 'Battery', low: 25, high: 40 }, { name: 'Cleaner head', low: 30, high: 45 }, { name: 'Motor body', low: 40, high: 60 },
  ] },
  { family: 'Dyson V7', keywords: ['DYSON', 'V7'], parts: [
    { name: 'Battery', low: 20, high: 30 }, { name: 'Cleaner head', low: 25, high: 35 }, { name: 'Motor body', low: 30, high: 45 },
  ] },
  { family: 'Dyson upright', keywords: ['DYSON'], parts: [
    { name: 'Hose', low: 15, high: 25 }, { name: 'Cleaner head', low: 30, high: 50 }, { name: 'Wand', low: 10, high: 15 }, { name: 'Tools', low: 8, high: 12 },
  ] },
  { family: 'Ecovacs X2', keywords: ['ECOVACS', 'X2'], parts: [
    { name: 'OMNI station', low: 150, high: 250 }, { name: 'LiDAR / mainboard', low: 50, high: 100 }, { name: 'Battery', low: 30, high: 50 }, { name: 'Mop plate', low: 15, high: 30 },
  ] },
  { family: 'Ecovacs T8', keywords: ['ECOVACS', 'T8'], parts: [
    { name: 'Battery', low: 30, high: 50 }, { name: 'LDS sensor', low: 30, high: 50 }, { name: 'Mop plate', low: 10, high: 20 },
  ] },
  { family: 'LG CordZero', keywords: ['CORDZERO'], parts: [
    { name: 'Battery', low: 40, high: 60 }, { name: 'Charging tower', low: 50, high: 80 }, { name: 'Power nozzle', low: 40, high: 60 },
  ] },
  { family: 'Samsung Jet', keywords: ['SAMSUNG'], parts: [
    { name: 'Battery', low: 50, high: 80 }, { name: 'Brushes', low: 30, high: 50 },
  ] },
  { family: 'Tineco Pet Cyclone', keywords: ['TINECO', 'CYCLONE'], parts: [
    { name: 'Battery', low: 15, high: 25 }, { name: 'Filter', low: 5, high: 10 },
  ] },
  { family: 'Tineco Floor One', keywords: ['TINECO'], parts: [
    { name: 'Battery', low: 40, high: 70 }, { name: 'Clean water tank', low: 20, high: 30 }, { name: 'Dirty water tank', low: 20, high: 30 },
    { name: 'Brush roller', low: 15, high: 20 }, { name: 'Dock / charger', low: 20, high: 30 }, { name: 'Screen board', low: 25, high: 35 },
  ] },
  { family: 'Shark', keywords: ['SHARK'], parts: [
    { name: 'Floor nozzle', low: 25, high: 40 }, { name: 'Hose / wand', low: 10, high: 20 }, { name: 'Filters', low: 5, high: 10 },
  ] },
  { family: 'Bissell', keywords: ['BISSELL'], parts: [
    { name: 'Battery', low: 40, high: 60 }, { name: 'Tanks', low: 15, high: 25 },
  ] },
  { family: 'Hoover', keywords: ['HOOVER'], parts: [
    { name: 'Tanks / brush', low: 15, high: 30 },
  ] },
  { family: 'Eureka', keywords: ['EUREKA'], parts: [
    { name: 'Filters / hose', low: 10, high: 20 },
  ] },
  { family: 'Dupray', keywords: ['DUPRAY'], parts: [
    { name: 'Hose / accessories', low: 20, high: 40 },
  ] },
];
