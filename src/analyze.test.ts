/**
 * Orchestrator tests + the estimate-flag propagation audit (task 6.2):
 * no number reaching the verdict may look "hard" when any input was estimated.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Db } from './store/db.ts';
import { openDb } from './store/db.ts';
import { updateProfile } from './store/profile.ts';
import { createLot, saveContext, replaceLineItems, setComps } from './store/lots.ts';
import { recordOutcome } from './store/outcomes.ts';
import { analyzeLot, dominantCategory, FREIGHT_MISSING_REASON } from './analyze.ts';
import { emptyListingContext, type CanonicalItem, type Analysis } from './types.ts';

const item = (over: Partial<CanonicalItem> = {}): CanonicalItem => ({
  description: 'Widget',
  identifierType: 'UPC',
  identifier: '012345678905',
  quantity: 10,
  unitMsrp: 100,
  conditionRaw: 'Customer Returns',
  conditionGrade: 'customer-returns',
  category: 'electronics',
  unverifiable: false,
  ...over,
});

/** Lot where every item has ≥3 comps and freight is a real quote. */
async function seedHardLot(db: Db, over: { freightQuote?: number | null; sellerZip?: string | null } = {}) {
  await updateProfile(db, { homeZip: '02215', requiredProfit: { kind: 'absolute', amount: 200 } });
  const lot = await createLot(db, { name: 'L', seller: 'Acme', unmanifested: false });
  await saveContext(db, lot.id, {
    ...emptyListingContext(),
    freightQuote: over.freightQuote === undefined ? 150 : over.freightQuote,
    sellerZip: over.sellerZip ?? null,
    palletCount: over.sellerZip ? 1 : null,
    weightClass: over.sellerZip ? 'standard' : null,
  });
  const items = await replaceLineItems(db, lot.id, [
    item(),
    item({ description: 'Gadget' }),
    item({ description: 'Gizmo' }),
    item({ description: 'Doohickey' }),
  ]);
  for (const li of items) await setComps(db, li.id, [{ price: 50 }, { price: 55 }, { price: 60 }]);
  return lot;
}

const allBidNumbers = (a: Analysis) =>
  [
    ['expectedRevenue', a.bid.expectedRevenue],
    ['sellingCosts', a.bid.sellingCosts],
    ['requiredProfit', a.bid.requiredProfit],
    ['totalBudget', a.bid.totalBudget],
    ['freight', a.bid.freight],
    ['auctionBudget', a.bid.auctionBudget],
    ['maxBid', a.bid.maxBid],
    ...(a.bid.landedUnitPrice ? [['landedUnitPrice', a.bid.landedUnitPrice] as const] : []),
    ...(a.verdict.maxBid ? [['verdict.maxBid', a.verdict.maxBid] as const] : []),
  ] as const;

test('audit: fully hard inputs → zero estimated numbers, zero warnings', async () => {
  const db = await openDb(':memory:');
  const lot = await seedHardLot(db);
  const a = await analyzeLot(db, lot.id);
  for (const [name, fa] of allBidNumbers(a)) {
    assert.equal(fa.isEstimate, false, `${name} must be hard`);
    assert.deepEqual(fa.estimateReasons, [], `${name} carries no reasons`);
  }
  assert.deepEqual(a.verdict.estimateWarnings, []);
});

test('audit: estimated freight taints exactly the post-freight numbers', async () => {
  const db = await openDb(':memory:');
  const lot = await seedHardLot(db, { freightQuote: null, sellerZip: '85001' });
  const a = await analyzeLot(db, lot.id);

  assert.equal(a.bid.freight.isEstimate, true);
  assert.equal(a.bid.auctionBudget.isEstimate, true);
  assert.equal(a.bid.maxBid.isEstimate, true);
  assert.equal(a.verdict.maxBid?.isEstimate, true, 'the number the user acts on is flagged');
  assert.ok(a.verdict.estimateWarnings.some((w) => w.includes('get a real quote')));

  assert.equal(a.bid.expectedRevenue.isEstimate, false, 'pre-freight numbers stay hard');
  assert.equal(a.bid.totalBudget.isEstimate, false);
});

test('audit: missing freight is never silently $0-and-hard', async () => {
  const db = await openDb(':memory:');
  const lot = await seedHardLot(db, { freightQuote: null });
  const a = await analyzeLot(db, lot.id);
  assert.equal(a.bid.freight.amount, 0);
  assert.equal(a.bid.freight.isEstimate, true);
  assert.ok(a.bid.maxBid.estimateReasons.includes(FREIGHT_MISSING_REASON));
  assert.ok(a.verdict.estimateWarnings.some((w) => w.includes('No freight entered')));
});

test('audit: floor-valued and unverifiable items taint revenue-derived numbers', async () => {
  const db = await openDb(':memory:');
  await updateProfile(db, { homeZip: '02215' });
  const lot = await createLot(db, { name: 'L', seller: 'Acme', unmanifested: false });
  await saveContext(db, lot.id, { ...emptyListingContext(), freightQuote: 100 });
  await replaceLineItems(db, lot.id, [
    item(),
    item({ description: 'No-ID bin', identifierType: 'none', identifier: null, unverifiable: true }),
  ]);
  const a = await analyzeLot(db, lot.id);

  for (const [name, fa] of allBidNumbers(a)) {
    if (name === 'freight') continue; // the quote itself is hard
    assert.equal(fa.isEstimate, true, `${name} must be flagged`);
  }
  assert.ok(a.bid.maxBid.estimateReasons.includes('floor-valuations'));
  assert.ok(a.bid.maxBid.estimateReasons.includes('unverified-rows'));
  assert.ok(a.verdict.estimateWarnings.some((w) => w.includes('MSRP floor')));
  assert.ok(a.verdict.estimateWarnings.some((w) => w.includes('unverifiable')));
  assert.equal(a.valuation.unverifiedValueShare, 0.5);
});

test('grail risk: recommended bid uses the grails-excluded valuation', async () => {
  const db = await openDb(':memory:');
  await updateProfile(db, { homeZip: '02215', requiredProfit: { kind: 'absolute', amount: 0 } });
  const lot = await createLot(db, { name: 'L', seller: 'Acme', unmanifested: false });
  await saveContext(db, lot.id, { ...emptyListingContext(), freightQuote: 0 });
  await replaceLineItems(db, lot.id, [
    item({ description: 'PS5 grail', unitMsrp: 5000, quantity: 1 }),
    item({ unitMsrp: 1000, quantity: 1 }),
    item({ unitMsrp: 1000, quantity: 1 }),
    item({ unitMsrp: 1000, quantity: 1 }),
    item({ unitMsrp: 1000, quantity: 1 }),
  ]);
  const a = await analyzeLot(db, lot.id);
  assert.equal(a.valuation.hasGrailRisk, true);
  assert.equal(a.valuation.expectedRevenue.amount, 900);
  assert.equal(a.valuation.breadAndButterRevenue.amount, 400);
  assert.equal(a.bid.expectedRevenue.amount, 400, 'bid math starts from bread-and-butter revenue');
});

test('market estimate appears at ≥5 logged finals in the segment, clearly separate', async () => {
  const db = await openDb(':memory:');
  const lot = await seedHardLot(db);
  // Log 5 finals for Acme/electronics via sibling lots.
  for (let i = 0; i < 5; i++) {
    const sib = await createLot(db, { name: `S${i}`, seller: 'Acme', unmanifested: false });
    await replaceLineItems(db, sib.id, [item()]); // extendedRetail 1000
    await recordOutcome(db, {
      lotId: sib.id,
      won: i % 2 === 0,
      finalPrice: 100 + i * 10,
      grossRecovered: null,
      predictedRevenue: null,
      predictedMaxBid: null,
    });
  }
  const a = await analyzeLot(db, lot.id);
  assert.ok(a.marketEstimate);
  assert.equal(a.marketEstimate!.label, 'market estimate');
  assert.equal(a.marketEstimate!.sampleSize, 5);
  assert.ok(a.marketEstimate!.low <= a.marketEstimate!.high);
  assert.notEqual(a.marketEstimate!.low, a.verdict.maxBid?.amount, 'market estimate is not the walk-away');
});

test('dominantCategory: by extended MSRP, uncategorized fallback', async () => {
  const db = await openDb(':memory:');
  const lot = await createLot(db, { name: 'L', seller: 'S', unmanifested: false });
  const items = await replaceLineItems(db, lot.id, [
    item({ category: 'toys', unitMsrp: 10, quantity: 1 }),
    item({ category: 'electronics', unitMsrp: 500, quantity: 2 }),
  ]);
  assert.equal(dominantCategory(items), 'electronics');
  assert.equal(dominantCategory([]), 'uncategorized');
});
