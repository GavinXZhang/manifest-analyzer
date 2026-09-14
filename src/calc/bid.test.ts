import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeBid, computeBidFlagged, requiredProfitAmount } from './bid.ts';
import { decideVerdict, PASS_CURRENT_BID, PASS_MAX_SPEND, PASS_CONDITION, PASS_NO_PROFITABLE_BID } from './verdict.ts';
import { estimatedAmount, hardAmount, defaultProfile, type LotValuation } from '../types.ts';

const WORKED_EXAMPLE = {
  expectedRevenue: 2400,
  sellingFeeRate: 0.15,
  requiredProfit: { kind: 'absolute', amount: 800 } as const,
  freight: 340,
  buyersPremiumRate: 0.1,
  totalUnits: 200,
};

test('worked example from the spec', () => {
  const n = computeBid(WORKED_EXAMPLE);
  assert.equal(n.sellingCosts, 360);
  assert.equal(n.totalBudget, 1240);
  assert.equal(n.auctionBudget, 900);
  assert.equal(n.maxBid, 818, 'floored to whole dollars');
  assert.equal(n.landedUnitPrice, 6.2);
});

test('required profit as percentage of expected revenue', () => {
  assert.equal(requiredProfitAmount({ kind: 'percent', percent: 0.25 }, 2000), 500);
  const n = computeBid({ ...WORKED_EXAMPLE, requiredProfit: { kind: 'percent', percent: 1 / 3 } });
  // 2400 − 360 − 800 = 1240: identical to the absolute case.
  assert.equal(n.totalBudget, 1240);
  assert.equal(n.maxBid, 818);
});

test('max bid never goes negative; zero units yields null unit price', () => {
  const n = computeBid({
    expectedRevenue: 100,
    sellingFeeRate: 0.15,
    requiredProfit: { kind: 'absolute', amount: 500 },
    freight: 200,
    buyersPremiumRate: 0.1,
    totalUnits: 0,
  });
  assert.equal(n.maxBid, 0);
  assert.equal(n.landedUnitPrice, null);
  assert.ok(n.totalBudget < 0, 'raw budget stays visible even when negative');
});

test('zero premium and zero freight degenerate cases', () => {
  const n = computeBid({
    expectedRevenue: 1000,
    sellingFeeRate: 0,
    requiredProfit: { kind: 'absolute', amount: 0 },
    freight: 0,
    buyersPremiumRate: 0,
    totalUnits: 10,
  });
  assert.equal(n.maxBid, 1000);
  assert.equal(n.landedUnitPrice, 100);
});

test('estimate flags propagate from freight and revenue to every derived number', () => {
  const bid = computeBidFlagged({
    expectedRevenue: estimatedAmount(2400, 'floor-valuations'),
    sellingFeeRate: 0.15,
    requiredProfit: { kind: 'absolute', amount: 800 },
    freight: estimatedAmount(340, 'freight-estimate'),
    buyersPremiumRate: 0.1,
    totalUnits: 200,
  });
  assert.equal(bid.maxBid.amount, 818);
  assert.equal(bid.maxBid.isEstimate, true);
  assert.deepEqual(new Set(bid.maxBid.estimateReasons), new Set(['floor-valuations', 'freight-estimate']));
  assert.equal(bid.auctionBudget.isEstimate, true);
  assert.equal(bid.totalBudget.isEstimate, true, 'revenue estimate taints total budget');
  assert.deepEqual(bid.totalBudget.estimateReasons, ['floor-valuations'], 'freight does not taint pre-freight numbers');
  assert.equal(bid.landedUnitPrice?.isEstimate, true);
});

test('hard inputs produce unflagged numbers', () => {
  const bid = computeBidFlagged({
    expectedRevenue: hardAmount(2400),
    sellingFeeRate: 0.15,
    requiredProfit: { kind: 'absolute', amount: 800 },
    freight: hardAmount(340),
    buyersPremiumRate: 0.1,
    totalUnits: 200,
  });
  assert.equal(bid.maxBid.isEstimate, false);
  assert.deepEqual(bid.maxBid.estimateReasons, []);
});

// --- verdict / constraints ---

const emptyValuation = (over: Partial<LotValuation> = {}): LotValuation => ({
  items: [],
  expectedRevenue: hardAmount(2400),
  breadAndButterRevenue: hardAmount(2400),
  hasGrailRisk: false,
  grailItemIds: [],
  unverifiedValueShare: 0,
  confidenceShares: { high: 1, medium: 0, low: 0 },
  extendedRetail: 6000,
  totalUnits: 200,
  ...over,
});

const workedBid = () =>
  computeBidFlagged({
    expectedRevenue: hardAmount(2400),
    sellingFeeRate: 0.15,
    requiredProfit: { kind: 'absolute', amount: 800 },
    freight: hardAmount(340),
    buyersPremiumRate: 0.1,
    totalUnits: 200,
  });

test('verdict: BID when nothing violated and current bid below walk-away', () => {
  const v = decideVerdict({
    bid: workedBid(),
    valuation: emptyValuation(),
    profile: defaultProfile(),
    currentBid: 500,
  });
  assert.equal(v.decision, 'BID');
  assert.equal(v.maxBid?.amount, 818);
  assert.deepEqual(v.passReasons, []);
});

test('verdict: PASS with gap when current bid exceeds walk-away', () => {
  const v = decideVerdict({
    bid: workedBid(),
    valuation: emptyValuation(),
    profile: defaultProfile(),
    currentBid: 900,
  });
  assert.equal(v.decision, 'PASS');
  const reason = v.passReasons.find((r) => r.includes(PASS_CURRENT_BID));
  assert.ok(reason, 'names the walk-away violation');
  assert.ok(reason!.includes('$82'), 'shows the gap (900 − 818)');
});

test('verdict: max spend caps the walk-away and can force PASS', () => {
  const profile = { ...defaultProfile(), maxSpendPerLot: 700 };
  const v = decideVerdict({ bid: workedBid(), valuation: emptyValuation(), profile, currentBid: null });
  // (700 − 340) / 1.1 = 327.27 → 327
  assert.equal(v.maxBid?.amount, 327);
  assert.equal(v.decision, 'BID');

  const tiny = { ...defaultProfile(), maxSpendPerLot: 300 };
  const v2 = decideVerdict({ bid: workedBid(), valuation: emptyValuation(), profile: tiny, currentBid: null });
  assert.equal(v2.decision, 'PASS');
  assert.ok(v2.passReasons.some((r) => r.includes(PASS_MAX_SPEND)), 'names max spend');
});

test('verdict: unacceptable condition grade names the constraint', () => {
  const valuation = emptyValuation({
    items: [
      {
        itemId: 1,
        description: 'Broken stuff',
        quantity: 5,
        unitMsrp: 100,
        conditionGrade: 'salvage',
        unitResale: 10,
        extendedResale: 50,
        confidence: 'low',
        flooredValuation: true,
        unverifiable: false,
        grailRisk: false,
        compCount: 0,
      },
    ],
  });
  const v = decideVerdict({
    bid: workedBid(),
    valuation,
    profile: defaultProfile(), // salvage not in default acceptable set
    currentBid: null,
  });
  assert.equal(v.decision, 'PASS');
  assert.ok(v.passReasons.some((r) => r.includes(PASS_CONDITION) && r.includes('salvage')));
});

test('verdict: unprofitable lot is a PASS', () => {
  const bid = computeBidFlagged({
    expectedRevenue: hardAmount(100),
    sellingFeeRate: 0.15,
    requiredProfit: { kind: 'absolute', amount: 500 },
    freight: hardAmount(200),
    buyersPremiumRate: 0.1,
    totalUnits: 10,
  });
  const v = decideVerdict({ bid, valuation: emptyValuation(), profile: defaultProfile(), currentBid: null });
  assert.equal(v.decision, 'PASS');
  assert.ok(v.passReasons.includes(PASS_NO_PROFITABLE_BID));
});

test('verdict: estimated freight surfaces an estimate warning on the walk-away', () => {
  const bid = computeBidFlagged({
    expectedRevenue: hardAmount(2400),
    sellingFeeRate: 0.15,
    requiredProfit: { kind: 'absolute', amount: 800 },
    freight: estimatedAmount(340, 'freight-estimate'),
    buyersPremiumRate: 0.1,
    totalUnits: 200,
  });
  const v = decideVerdict({ bid, valuation: emptyValuation(), profile: defaultProfile(), currentBid: null });
  assert.equal(v.decision, 'BID');
  assert.ok(v.estimateWarnings.some((w) => w.includes('get a real quote')));
});
