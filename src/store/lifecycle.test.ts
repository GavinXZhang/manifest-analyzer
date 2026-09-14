import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.ts';
import { createLot, replaceLineItems, getLineItems, saveContext } from './lots.ts';
import { recordOutcome } from './outcomes.ts';
import { emptyListingContext, type CanonicalItem } from '../types.ts';
import { setStage, getStage, listStageEvents } from './stages.ts';
import { backfillStages } from './migrate.ts';
import { upsertReceipt, listReceipts, summarizeReceipts, validateTally } from './receipts.ts';
import { receivingView, transferWorkingUnits, createPartsItems, lotLandedUnitCost } from './receiving.ts';
import { listInventory, listInventoryForLot, getInventoryItem, addInventoryItem } from './inventory.ts';
import { listChannels } from './channels.ts';
import { addListing, updateListing, listListingsFor, deriveStatus, cutPrice } from './listings.ts';
import { markSold } from './selling.ts';
import { listSales, listExpenses } from './ledger.ts';
import { clockIn, clockOut, switchTask, addManualPunch, getRunningPunch, listPunches, hoursByDay, hoursByCategory, totalHours, updatePunch } from './punches.ts';
import { addRecurring, postDueRecurring, monthlyBurn, listRecurring } from './recurring.ts';

const item = (over: Partial<CanonicalItem> = {}): CanonicalItem => ({
  description: 'DYSON V11 STICK VAC',
  identifierType: 'UPC',
  identifier: '885609023809',
  quantity: 4,
  unitMsrp: 649.99,
  conditionRaw: 'USED_GOOD',
  conditionGrade: 'customer-returns',
  category: 'VACUUMS',
  unverifiable: false,
  ...over,
});

async function wonLot(db: Awaited<ReturnType<typeof openDb>>) {
  const lot = await createLot(db, { name: 'Vacuums', seller: 'MON', unmanifested: false });
  await replaceLineItems(db, lot.id, [
    item(),
    item({ description: 'TINECO GO VAC MOP', identifier: '194846102155', quantity: 29, unitMsrp: 299.99 }),
    item({ description: 'ECOVACS X2 OMNI VAC', identifier: '759159722683', quantity: 2, unitMsrp: 999.99 }),
  ]);
  await saveContext(db, lot.id, { ...emptyListingContext(), buyersPremiumRate: 0.03, freightQuote: 683.83 });
  await recordOutcome(db, { lotId: lot.id, won: true, finalPrice: 4566.09, grossRecovered: null, predictedRevenue: null, predictedMaxBid: null });
  await setStage(db, lot.id, 'won');
  return lot;
}

test('stages: set/get, no duplicate events, back-fill infers from outcome + inventory', async () => {
  const db = await openDb(':memory:');
  const lot = await createLot(db, { name: 'A', seller: 'S', unmanifested: true });
  assert.equal(await getStage(db, lot.id), 'analyzing');
  assert.ok(await setStage(db, lot.id, 'bid_placed'));
  assert.equal(await setStage(db, lot.id, 'bid_placed'), null);
  assert.equal((await listStageEvents(db, lot.id)).length, 1);

  const old = await createLot(db, { name: 'Old', seller: 'S', unmanifested: true });
  await recordOutcome(db, { lotId: old.id, won: true, finalPrice: 100, grossRecovered: null, predictedRevenue: null, predictedMaxBid: null });
  await addInventoryItem(db, { lotId: old.id, name: 'Thing' });
  const lost = await createLot(db, { name: 'Lost', seller: 'S', unmanifested: true });
  await recordOutcome(db, { lotId: lost.id, won: false, finalPrice: 100, grossRecovered: null, predictedRevenue: null, predictedMaxBid: null });
  assert.equal(await backfillStages(db), 2);
  assert.equal(await getStage(db, old.id), 'selling');
  assert.equal(await getStage(db, lost.id), 'closed');
  assert.equal((await listStageEvents(db, old.id))[0].inferred, true);
  assert.equal(await backfillStages(db), 0);
});

test('receipts: validation, summary, landed cost', async () => {
  const db = await openDb(':memory:');
  const lot = await wonLot(db);
  const [dyson, tineco] = await getLineItems(db, lot.id);
  assert.throws(() => validateTally({ received: 4, works: 3, incomplete: 1, weakBattery: 1, dead: 0 }), /exceeds/);
  await upsertReceipt(db, lot.id, dyson.id, { received: 4, works: 2, incomplete: 0, weakBattery: 1, dead: 1 });
  await upsertReceipt(db, lot.id, tineco.id, { received: 29, works: 24, incomplete: 3, weakBattery: 1, dead: 1, note: '3 missing tank' });
  const s = summarizeReceipts(await getLineItems(db, lot.id), await listReceipts(db, lot.id));
  assert.equal(s.manifestUnits, 35);
  assert.equal(s.checked, 33);
  assert.equal(s.works, 26);
  assert.equal(s.dead, 2);
  assert.equal(s.linesChecked, 2);
  assert.equal(s.complete, false);
  assert.equal(await lotLandedUnitCost(db, lot.id), landed(35));
  const view = await receivingView(db, lot.id);
  assert.equal(view.lines[0].family, 'Dyson V11');
  assert.equal(view.salvage.families[0].family, 'Dyson V11');
  assert.equal(view.salvage.families.find((f) => f.family === 'Dyson V11')!.cannibalize, 1);
});

function landed(units: number): number {
  return Math.round(((4566.09 * 1.03 + 683.83) / units) * 100) / 100;
}

test('transfer: idempotent per line, cost basis = landed, parts items', async () => {
  const db = await openDb(':memory:');
  const lot = await wonLot(db);
  const [dyson, tineco, ecovacs] = await getLineItems(db, lot.id);
  await upsertReceipt(db, lot.id, dyson.id, { received: 4, works: 2, incomplete: 0, weakBattery: 1, dead: 1 });
  await upsertReceipt(db, lot.id, ecovacs.id, { received: 2, works: 1, incomplete: 0, weakBattery: 0, dead: 1 });

  let r = await transferWorkingUnits(db, lot.id, '2026-09-14');
  assert.deepEqual(r, { created: 2, updated: 0, removed: 0, unitsInInventory: 3 });
  let inv = await listInventoryForLot(db, lot.id);
  assert.equal(inv.length, 2);
  assert.equal(inv[0].cost, landed(35));
  assert.equal(inv[0].family, 'Dyson V11');
  assert.equal(inv[0].receivedAt, '2026-09-14');

  await upsertReceipt(db, lot.id, dyson.id, { received: 4, works: 3, incomplete: 0, weakBattery: 0, dead: 1 });
  await upsertReceipt(db, lot.id, tineco.id, { received: 29, works: 24, incomplete: 3, weakBattery: 1, dead: 1 });
  r = await transferWorkingUnits(db, lot.id, '2026-09-15');
  assert.deepEqual(r, { created: 1, updated: 1, removed: 0, unitsInInventory: 28 });
  inv = await listInventoryForLot(db, lot.id);
  assert.equal(inv.length, 3);
  assert.equal(inv.find((i) => i.lineItemId === dyson.id)!.qty, 3);

  const parts = await createPartsItems(db, lot.id);
  assert.ok(parts >= 3);
  assert.equal(await createPartsItems(db, lot.id), 0);
  const partRows = (await listInventoryForLot(db, lot.id)).filter((i) => i.kind === 'parts');
  assert.ok(partRows.some((p) => p.name === 'Ecovacs X2 — OMNI station' && p.qty === 1 && p.cost === 0));
});

test('listings: derived status, best net, cut price, mark sold with fees', async () => {
  const db = await openDb(':memory:');
  const channels = await listChannels(db);
  const ebay = channels.find((c) => c.name === 'eBay')!;
  const fb = channels.find((c) => c.name === 'Facebook Marketplace')!;
  const itemRow = await addInventoryItem(db, { name: 'Dyson V10 Animal+', qty: 3, cost: 52.3 });
  assert.equal(itemRow.status, 'in-stock');

  const l1 = await addListing(db, { inventoryId: itemRow.id, channelId: ebay.id, ask: 199 });
  assert.equal((await getInventoryItem(db, itemRow.id))!.status, 'listed');
  await addListing(db, { inventoryId: itemRow.id, channelId: fb.id, ask: 185 });
  assert.equal(deriveStatus(3, 0, await listListingsFor(db, itemRow.id)), 'listed');

  const cut = await cutPrice(db, itemRow.id, 0.1);
  assert.deepEqual(cut.map((l) => l.ask), [179.1, 166.5]);

  const first = await markSold(db, { inventoryId: itemRow.id, amount: 189, listingId: l1.id, soldAt: '2026-09-10' });
  assert.equal(first.sale.fees, 25.34);
  assert.equal(first.remaining, 2);
  assert.equal((await getInventoryItem(db, itemRow.id))!.status, 'listed');

  await markSold(db, { inventoryId: itemRow.id, amount: 170, qty: 2, channelId: fb.id, soldAt: '2026-09-11' });
  const after = await getInventoryItem(db, itemRow.id);
  assert.equal(after!.status, 'sold');
  assert.equal(after!.qtySold, 3);
  const listings = await listListingsFor(db, itemRow.id);
  assert.ok(listings.every((l) => l.status !== 'active'));
  await assert.rejects(markSold(db, { inventoryId: itemRow.id, amount: 1 }), /left to sell/);
  await updateListing(db, l1.id, { status: 'ended' });
  assert.equal((await listSales(db)).length, 2);
});

test('punches: clock in/out, switch, manual, aggregation, no double clock-in', async () => {
  const db = await openDb(':memory:');
  // Fixed times sit safely in the past; switch/clock-out use "now".
  const p = await clockIn(db, { category: 'receiving', at: '2026-09-01T13:14:00Z' });
  assert.equal(p.endedAt, null);
  await assert.rejects(clockIn(db, {}), /Already clocked in/);
  const sw = await switchTask(db, { category: 'listing' });
  assert.equal(sw.category, 'listing');
  assert.equal((await getRunningPunch(db))!.id, sw.id);
  await clockOut(db);
  assert.equal(await getRunningPunch(db), null);
  await assert.rejects(clockOut(db), /Not clocked in/);
  await addManualPunch(db, { startedAt: '2026-09-12T14:00:00Z', endedAt: '2026-09-12T18:00:00Z', category: 'shipping' });
  await assert.rejects(addManualPunch(db, { startedAt: '2026-09-12T14:00:00Z', endedAt: '2026-09-12T13:00:00Z' }), /after start/);
  // The first punch ran from Sep 1 until the switch; trim it so the totals are deterministic.
  const edited = await updatePunch(db, p.id, { endedAt: '2026-09-01T14:00:00Z' });
  assert.equal(edited.endedAt, '2026-09-01T14:00:00Z');
  await assert.rejects(updatePunch(db, p.id, { endedAt: '2026-09-01T13:00:00Z' }), /after start/);
  const all = await listPunches(db);
  assert.equal(all.length, 3);
  const byDay = hoursByDay(all, 'America/New_York');
  assert.equal(byDay.get('2026-09-12'), 4);
  assert.equal(byDay.get('2026-09-01'), 0.77);
  assert.ok(totalHours(all) >= 4.77);
  const cats = hoursByCategory(all);
  assert.equal(cats[0].category, 'shipping');
  assert.equal(cats[0].hours, 4);
});

test('recurring: posts on due day once per period and back-fills missed months', async () => {
  const db = await openDb(':memory:');
  const r = await addRecurring(db, { name: 'Extra Space 5×10', amount: 129, dueDay: 15, createdAt: '2026-08-01T00:00:00Z' });
  assert.equal(await postDueRecurring(db, '2026-08-10'), 0);
  assert.equal(await postDueRecurring(db, '2026-08-15'), 1);
  assert.equal(await postDueRecurring(db, '2026-08-20'), 0);
  assert.equal(await postDueRecurring(db, '2026-10-03'), 1); // September back-filled; October not yet due
  assert.equal(await postDueRecurring(db, '2026-10-16'), 1);
  const expenses = await listExpenses(db);
  assert.deepEqual(expenses.map((e) => e.spentAt), ['2026-08-15', '2026-09-15', '2026-10-15']);
  assert.ok(expenses.every((e) => e.auto && e.category === 'storage'));
  assert.equal((await listRecurring(db))[0].lastPeriod, '2026-10');
  await addRecurring(db, { name: 'Shelf', amount: 55, dueDay: 1 });
  assert.deepEqual(await monthlyBurn(db), { monthly: 184, storageMonthly: 184 });
  assert.equal(r.active, true);
  assert.equal((await listInventory(db)).length, 0);
});
