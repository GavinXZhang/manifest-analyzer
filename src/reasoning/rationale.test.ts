import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRationale, type RationaleInputs } from './rationale.ts';
import { computeBidFlagged } from '../calc/bid.ts';
import { estimatedAmount, hardAmount, emptyListingContext, type LotValuation, type ItemValuation } from '../types.ts';

const iv = (over: Partial<ItemValuation> = {}): ItemValuation => ({
  itemId: 1,
  description: 'Widget',
  quantity: 10,
  unitMsrp: 50,
  conditionGrade: 'customer-returns',
  unitResale: 15,
  extendedResale: 150,
  confidence: 'high',
  flooredValuation: false,
  unverifiable: false,
  grailRisk: false,
  compCount: 3,
  ...over,
});

const valuation = (over: Partial<LotValuation> = {}): LotValuation => ({
  items: [iv()],
  expectedRevenue: hardAmount(150),
  breadAndButterRevenue: hardAmount(150),
  hasGrailRisk: false,
  grailItemIds: [],
  unverifiedValueShare: 0,
  confidenceShares: { high: 1, medium: 0, low: 0 },
  extendedRetail: 500,
  totalUnits: 10,
  ...over,
});

const inputs = (over: Partial<RationaleInputs> = {}): RationaleInputs => ({
  valuation: valuation(),
  bid: computeBidFlagged({
    expectedRevenue: hardAmount(150),
    sellingFeeRate: 0.15,
    requiredProfit: { kind: 'absolute', amount: 30 },
    freight: hardAmount(40),
    buyersPremiumRate: 0.1,
    totalUnits: 10,
  }),
  context: emptyListingContext(),
  category: 'electronics',
  now: new Date('2026-08-22T12:00:00Z'),
  ...over,
});

test('rationale covers all five topics in order', () => {
  const sections = buildRationale(inputs());
  assert.deepEqual(
    sections.map((s) => s.topic),
    ['value-composition', 'location', 'seasonality', 'competition', 'confidence'],
  );
  assert.ok(sections.every((s) => s.text.length > 0));
});

test('few-bids-near-close: favorable AND problem-warning dual reading', () => {
  const now = new Date('2026-08-22T12:00:00Z');
  const end = new Date('2026-08-22T20:00:00Z'); // 8h remaining
  const sections = buildRationale(
    inputs({ context: { ...emptyListingContext(), bidCount: 2, endTime: end.toISOString() }, now }),
  );
  const comp = sections.find((s) => s.topic === 'competition')!;
  assert.ok(/low competition/i.test(comp.text), 'flags the favorable signal');
  assert.ok(/re-check the manifest/i.test(comp.text), 'warns it can mean others spotted a problem');
});

test('many bids reads as demand, walk-away framing holds', () => {
  const comp = buildRationale(
    inputs({ context: { ...emptyListingContext(), bidCount: 12 } }),
  ).find((s) => s.topic === 'competition')!;
  assert.ok(/strong demand/i.test(comp.text));
  assert.ok(/does not move/i.test(comp.text), 'no "bid more to win" framing');
});

test('seasonality: outdoor category analyzed in fall reads off-season', () => {
  const season = buildRationale(
    inputs({ category: 'Outdoor & Garden', now: new Date('2026-10-15T12:00:00Z') }),
  ).find((s) => s.topic === 'seasonality')!;
  assert.ok(/off-season/i.test(season.text));
  assert.ok(/longer holding/i.test(season.text));
});

test('seasonality: toys near the holidays reads in-season', () => {
  const season = buildRationale(
    inputs({ category: 'Toys', now: new Date('2026-11-10T12:00:00Z') }),
  ).find((s) => s.topic === 'seasonality')!;
  assert.ok(/in its holiday/i.test(season.text));
});

test('location: freight share of budget plus estimate nag when flagged', () => {
  const bid = computeBidFlagged({
    expectedRevenue: hardAmount(2400),
    sellingFeeRate: 0.15,
    requiredProfit: { kind: 'absolute', amount: 800 },
    freight: estimatedAmount(340, 'freight-estimate'),
    buyersPremiumRate: 0.1,
    totalUnits: 200,
  });
  const loc = buildRationale(inputs({ bid })).find((s) => s.topic === 'location')!;
  assert.ok(loc.text.includes('27%'), 'freight share of total budget (340/1240)');
  assert.ok(/get a real quote/i.test(loc.text));
});

test('value composition: grail note explains which valuation drives the bid', () => {
  const v = valuation({
    items: [iv({ extendedResale: 800, description: 'PS5 Console', grailRisk: true }), iv({ itemId: 2, extendedResale: 200 })],
    expectedRevenue: hardAmount(1000),
    breadAndButterRevenue: hardAmount(200),
    hasGrailRisk: true,
    grailItemIds: [1],
  });
  const comp = buildRationale(inputs({ valuation: v })).find((s) => s.topic === 'value-composition')!;
  assert.ok(/grail risk/i.test(comp.text));
  assert.ok(comp.text.includes('$200'), 'names the grails-excluded valuation');
});

test('confidence: shares and unverifiable share surfaced', () => {
  const v = valuation({
    confidenceShares: { high: 0.6, medium: 0.1, low: 0.3 },
    unverifiedValueShare: 0.2,
  });
  const conf = buildRationale(inputs({ valuation: v })).find((s) => s.topic === 'confidence')!;
  assert.ok(conf.text.includes('60%'));
  assert.ok(conf.text.includes('20%'));
});
