import { test } from 'node:test';
import assert from 'node:assert/strict';
import { valueLot, GRAIL_SHARE_THRESHOLD } from './valuation.ts';
import { median, topValueItems } from './comps.ts';
import { effectiveRate } from './recovery.ts';
import { DEFAULT_RECOVERY_RATES, type LineItem } from '../types.ts';

let nextId = 1;
const item = (over: Partial<LineItem> = {}): LineItem => ({
  id: nextId++,
  lotId: 1,
  description: `Item ${nextId}`,
  identifierType: 'UPC',
  identifier: '012345678905',
  quantity: 1,
  unitMsrp: 100,
  conditionRaw: 'Customer Returns',
  conditionGrade: 'customer-returns',
  category: 'electronics',
  unverifiable: false,
  ...over,
});

const value = (items: LineItem[], comps: Map<number, number[]> = new Map()) =>
  valueLot({
    items,
    soldPricesByItemId: comps,
    rates: DEFAULT_RECOVERY_RATES,
    conservativeFloorRate: 0.1,
    sellThroughProbability: 0.9,
  });

test('median: odd, even, and singleton', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 10]), 2.5);
  assert.equal(median([7]), 7);
  assert.throws(() => median([]));
});

test('≥3 comps: median × recovery × sell-through, high confidence', () => {
  const it = item({ conditionGrade: 'customer-returns' });
  const v = value([it], new Map([[it.id, [40, 50, 60]]]));
  // 50 × 0.35 × 0.9 = 15.75
  assert.equal(v.items[0].unitResale, 15.75);
  assert.equal(v.items[0].confidence, 'high');
  assert.equal(v.items[0].compCount, 3);
  assert.equal(v.expectedRevenue.isEstimate, false);
});

test('1–2 comps: medium confidence', () => {
  const it = item();
  const v = value([it], new Map([[it.id, [40, 60]]]));
  assert.equal(v.items[0].confidence, 'medium');
});

test('no comps: MSRP × floor rate, low confidence, revenue flagged', () => {
  const it = item({ unitMsrp: 200, quantity: 3 });
  const v = value([it]);
  assert.equal(v.items[0].unitResale, 20);
  assert.equal(v.items[0].extendedResale, 60);
  assert.equal(v.items[0].confidence, 'low');
  assert.equal(v.items[0].flooredValuation, true);
  assert.equal(v.expectedRevenue.isEstimate, true);
  assert.ok(v.expectedRevenue.estimateReasons.includes('floor-valuations'));
});

test('no comps and no MSRP: item valued at zero', () => {
  const it = item({ unitMsrp: null, unverifiable: true, identifierType: 'none', identifier: null });
  const v = value([it]);
  assert.equal(v.items[0].unitResale, 0);
  assert.equal(v.items[0].flooredValuation, false, 'nothing to floor from');
});

test('unverified-value share computed over estimated value', () => {
  const good = item({ unitMsrp: 300 });        // floor: 30
  const shady = item({ unitMsrp: 100, unverifiable: true, identifierType: 'none', identifier: null }); // floor: 10
  const v = value([good, shady]);
  assert.equal(v.unverifiedValueShare, 0.25); // 10 / 40
  assert.ok(v.expectedRevenue.estimateReasons.includes('unverified-rows'));
});

test('grail risk: top items >40% of value flagged, bread-and-butter excludes them', () => {
  const grail = item({ unitMsrp: 5000, quantity: 1 });   // floor: 500
  const rest = [
    item({ unitMsrp: 1000 }),  // 100
    item({ unitMsrp: 1000 }),  // 100
    item({ unitMsrp: 1000 }),  // 100
    item({ unitMsrp: 1000 }),  // 100
  ];
  const v = value([grail, ...rest]);
  // total 900; grail 500/900 = 55.6% > 40%
  assert.equal(v.hasGrailRisk, true);
  assert.deepEqual(v.grailItemIds, [grail.id]);
  assert.equal(v.items.find((i) => i.itemId === grail.id)?.grailRisk, true);
  assert.equal(v.expectedRevenue.amount, 900);
  assert.equal(v.breadAndButterRevenue.amount, 400);
});

test('grail risk: evenly spread lot is not flagged', () => {
  const items = Array.from({ length: 10 }, () => item({ unitMsrp: 100 }));
  const v = value(items);
  assert.equal(v.hasGrailRisk, false);
  assert.equal(v.breadAndButterRevenue.amount, v.expectedRevenue.amount);
});

test('grail risk: tiny lots (≤3 items) are exempt', () => {
  const v = value([item({ unitMsrp: 900 }), item({ unitMsrp: 100 })]);
  assert.equal(v.hasGrailRisk, false, 'a 2-item lot is all "grails" by definition — not flagged');
});

test('confidence shares sum over value, threshold constant exported', () => {
  const a = item({ unitMsrp: 100 });
  const b = item({ unitMsrp: 100 });
  const c = item({ unitMsrp: 100 });
  const d = item({ unitMsrp: 100 });
  const comps = new Map([
    [a.id, [100, 100, 100]], // high: 100×0.35×0.9 = 31.5
    [b.id, [100]],           // medium: 31.5
  ]);
  const v = value([a, b, c, d], comps);
  // c,d floor: 10 each. total = 83
  assert.equal(v.confidenceShares.high, Math.round((31.5 / 83) * 100) / 100);
  assert.equal(v.confidenceShares.medium, Math.round((31.5 / 83) * 100) / 100);
  assert.equal(v.confidenceShares.low, Math.round((20 / 83) * 100) / 100);
  assert.equal(GRAIL_SHARE_THRESHOLD, 0.4);
});

test('effectiveRate: segment multiplier scales and clamps', () => {
  assert.equal(effectiveRate('customer-returns', DEFAULT_RECOVERY_RATES), 0.35);
  assert.equal(effectiveRate('customer-returns', DEFAULT_RECOVERY_RATES, 1.2), 0.42);
  assert.equal(effectiveRate('new', DEFAULT_RECOVERY_RATES, 3), 1, 'clamped at 1');
});

test('topValueItems: sorted by extended MSRP', () => {
  const small = item({ unitMsrp: 10, quantity: 100 });  // 1000
  const big = item({ unitMsrp: 500, quantity: 4 });     // 2000
  const tiny = item({ unitMsrp: 5, quantity: 1 });
  const top = topValueItems([small, big, tiny], 2);
  assert.deepEqual(top.map((i) => i.id), [big.id, small.id]);
});

test('empty lot: zero revenue, 100% unverified', () => {
  const v = value([]);
  assert.equal(v.expectedRevenue.amount, 0);
  assert.equal(v.unverifiedValueShare, 1);
  assert.equal(v.totalUnits, 0);
});
