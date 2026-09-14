import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.ts';
import { getProfile, saveProfile, updateProfile } from './profile.ts';
import { getRecoveryRates, saveRecoveryRates, saveSegmentOverride, getSegmentOverride } from './rates.ts';
import { getSellerMapping, saveSellerMapping } from './mappings.ts';
import {
  createLot,
  getLot,
  listLots,
  deleteLot,
  saveContext,
  replaceLineItems,
  getLineItems,
  setComps,
  getComps,
} from './lots.ts';
import { recordOutcome, getOutcome, listOutcomes } from './outcomes.ts';
import { defaultProfile, emptyListingContext, DEFAULT_RECOVERY_RATES, type CanonicalItem } from '../types.ts';

const item = (over: Partial<CanonicalItem> = {}): CanonicalItem => ({
  description: 'Widget',
  identifierType: 'UPC',
  identifier: '012345678905',
  quantity: 10,
  unitMsrp: 25,
  conditionRaw: 'Customer Returns',
  conditionGrade: 'customer-returns',
  category: 'electronics',
  unverifiable: false,
  ...over,
});

test('profile: defaults, save, merge-on-read', async () => {
  const db = await openDb(':memory:');
  assert.deepEqual(await getProfile(db), defaultProfile());

  const saved = await updateProfile(db, { homeZip: '02215', maxSpendPerLot: 1500 });
  assert.equal(saved.homeZip, '02215');
  assert.equal(saved.maxSpendPerLot, 1500);
  assert.equal((await getProfile(db)).sellingFeeRate, 0.15);

  await assert.rejects(saveProfile(db, { ...defaultProfile(), sellingFeeRate: 1.5 }));
  await assert.rejects(saveProfile(db, { ...defaultProfile(), maxSpendPerLot: -5 }));
  await assert.rejects(
    saveProfile(db, { ...defaultProfile(), requiredProfit: { kind: 'absolute', amount: -1 } }),
  );
});

test('recovery rates: ship with defaults, editable, validated', async () => {
  const db = await openDb(':memory:');
  assert.deepEqual(await getRecoveryRates(db), DEFAULT_RECOVERY_RATES);

  const updated = await saveRecoveryRates(db, { 'new': 0.6, 'salvage': 0.05 });
  assert.equal(updated['new'], 0.6);
  assert.equal(updated['salvage'], 0.05);
  assert.equal(updated['like-new'], 0.45);

  await assert.rejects(saveRecoveryRates(db, { 'new': 1.2 }));
  await assert.rejects(saveRecoveryRates(db, { bogus: 0.5 } as never));
});

test('segment overrides: save and read back', async () => {
  const db = await openDb(':memory:');
  assert.equal(await getSegmentOverride(db, 'acme', 'toys'), null);
  await saveSegmentOverride(db, 'acme', 'toys', 1.2);
  assert.equal((await getSegmentOverride(db, 'acme', 'toys'))?.multiplier, 1.2);
  await assert.rejects(saveSegmentOverride(db, 'acme', 'toys', 0));
});

test('seller mappings: persisted per seller, seller key normalized', async () => {
  const db = await openDb(':memory:');
  assert.equal(await getSellerMapping(db, 'Acme Liquidation'), null);
  await saveSellerMapping(db, 'Acme Liquidation', { description: 'Prod Desc', quantity: 'Pcs' });
  assert.deepEqual(await getSellerMapping(db, '  acme liquidation '), {
    description: 'Prod Desc',
    quantity: 'Pcs',
  });
});

test('lots: create/list/context/items/comps/delete cascade', async () => {
  const db = await openDb(':memory:');
  const lot = await createLot(db, { name: 'Pallet of stuff', seller: 'Acme', unmanifested: false });
  assert.equal(lot.mappingStatus, 'pending');
  assert.deepEqual(lot.context, emptyListingContext());

  const ctx = { ...emptyListingContext(), currentBid: 250, buyersPremiumRate: 0.1 };
  await saveContext(db, lot.id, ctx);
  assert.equal((await getLot(db, lot.id))?.context.currentBid, 250);

  const items = await replaceLineItems(db, lot.id, [
    item(),
    item({ description: 'Gadget', unverifiable: true, identifierType: 'none', identifier: null }),
  ]);
  assert.equal(items.length, 2);
  assert.equal(items[1].unverifiable, true);

  await setComps(db, items[0].id, [{ price: 12 }, { price: 15, note: 'ebay sold' }]);
  assert.equal((await getComps(db, items[0].id)).length, 2);
  await assert.rejects(setComps(db, items[0].id, [{ price: -1 }]));

  assert.equal((await listLots(db)).length, 1);
  await deleteLot(db, lot.id);
  assert.equal((await listLots(db)).length, 0);
  assert.equal((await getLineItems(db, lot.id)).length, 0, 'line items cascade-deleted');
  assert.equal((await getComps(db, items[0].id)).length, 0, 'comps cascade-deleted');
});

test('replaceLineItems clears stale comps for the replaced rows', async () => {
  const db = await openDb(':memory:');
  const lot = await createLot(db, { name: 'L', seller: 'S', unmanifested: false });
  const [first] = await replaceLineItems(db, lot.id, [item()]);
  await setComps(db, first.id, [{ price: 9 }]);
  await replaceLineItems(db, lot.id, [item({ description: 'Replacement' })]);
  assert.equal((await getComps(db, first.id)).length, 0);
});

test('unmanifested lot starts with mapping confirmed (nothing to map)', async () => {
  const db = await openDb(':memory:');
  const lot = await createLot(db, { name: 'Mystery pallet', seller: 'Acme', unmanifested: true });
  assert.equal(lot.mappingStatus, 'confirmed');
});

test('outcomes: upsert with prediction snapshot preserved', async () => {
  const db = await openDb(':memory:');
  const lot = await createLot(db, { name: 'L', seller: 'S', unmanifested: false });
  await recordOutcome(db, {
    lotId: lot.id,
    won: true,
    finalPrice: 700,
    grossRecovered: null,
    predictedRevenue: 2400,
    predictedMaxBid: 818,
  });
  // Later: user fills in gross recovered; prediction snapshot must survive.
  await recordOutcome(db, {
    lotId: lot.id,
    won: true,
    finalPrice: 700,
    grossRecovered: 2100,
    predictedRevenue: null,
    predictedMaxBid: null,
  });
  const o = (await getOutcome(db, lot.id))!;
  assert.equal(o.grossRecovered, 2100);
  assert.equal(o.predictedRevenue, 2400);
  assert.equal(o.predictedMaxBid, 818);
  assert.equal((await listOutcomes(db)).length, 1);
});
