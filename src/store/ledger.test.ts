import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from './db.ts';
import { createLot, deleteLot } from './lots.ts';
import { recordOutcome } from './outcomes.ts';
import {
  addSale,
  deleteSale,
  listSales,
  addExpense,
  deleteExpense,
  deleteAutoExpenses,
  listExpenses,
  ledgerSummary,
  lotPerformance,
} from './ledger.ts';

test('sales: add/list/delete with validation', async () => {
  const db = await openDb(':memory:');
  const sale = await addSale(db, { amount: 42.5, soldAt: '2026-08-20', note: 'headphones on ebay' });
  assert.equal(sale.amount, 42.5);
  assert.equal(sale.lotId, null);
  assert.equal((await listSales(db)).length, 1);

  await assert.rejects(addSale(db, { amount: -5, soldAt: '2026-08-20' }));
  await assert.rejects(addSale(db, { amount: 5, soldAt: 'not-a-date' }));

  await deleteSale(db, sale.id);
  assert.equal((await listSales(db)).length, 0);
});

test('expenses: categories validated, auto rows replaceable', async () => {
  const db = await openDb(':memory:');
  const lot = await createLot(db, { name: 'L', seller: 'S', unmanifested: false });
  await addExpense(db, { lotId: lot.id, amount: 500, category: 'lot-purchase', auto: true, spentAt: '2026-08-01' });
  await addExpense(db, { lotId: lot.id, amount: 100, category: 'freight', auto: true, spentAt: '2026-08-01' });
  await addExpense(db, { lotId: lot.id, amount: 25, category: 'supplies', spentAt: '2026-08-02', note: 'boxes' });

  await assert.rejects(addExpense(db, { amount: 10, category: 'bribes' as never, spentAt: '2026-08-02' }));

  await deleteAutoExpenses(db, lot.id);
  const remaining = await listExpenses(db);
  assert.equal(remaining.length, 1, 'manual entries survive auto wipe');
  assert.equal(remaining[0].category, 'supplies');

  await deleteExpense(db, remaining[0].id);
  assert.equal((await listExpenses(db)).length, 0);
});

test('ledger summary: revenue − expenses = net', async () => {
  const db = await openDb(':memory:');
  await addSale(db, { amount: 100, soldAt: '2026-08-01' });
  await addSale(db, { amount: 50.25, soldAt: '2026-08-03' });
  await addExpense(db, { amount: 60, category: 'other', spentAt: '2026-08-02' });
  assert.deepEqual(await ledgerSummary(db), { totalRevenue: 150.25, totalExpenses: 60, netProfit: 90.25 });
});

test('ledger survives lot deletion (lot link nulls out)', async () => {
  const db = await openDb(':memory:');
  const lot = await createLot(db, { name: 'L', seller: 'S', unmanifested: false });
  await addSale(db, { lotId: lot.id, amount: 75, soldAt: '2026-08-05' });
  await deleteLot(db, lot.id);
  const [sale] = await listSales(db);
  assert.equal(sale.amount, 75);
  assert.equal(sale.lotId, null);
});

test('lot performance: ranks recent won lots, prefers sales ledger over outcome gross', async () => {
  const db = await openDb(':memory:');

  const winner = await createLot(db, { name: 'Great pallet', seller: 'Acme', unmanifested: false });
  await recordOutcome(db, { lotId: winner.id, won: true, finalPrice: 400, grossRecovered: 900, predictedRevenue: null, predictedMaxBid: null });
  await addExpense(db, { lotId: winner.id, amount: 440, category: 'lot-purchase', auto: true, spentAt: '2026-08-01' });
  await addSale(db, { lotId: winner.id, amount: 600, soldAt: '2026-08-05' });
  await addSale(db, { lotId: winner.id, amount: 500, soldAt: '2026-08-09' });

  const grossOnly = await createLot(db, { name: 'OK pallet', seller: 'Acme', unmanifested: false });
  await recordOutcome(db, { lotId: grossOnly.id, won: true, finalPrice: 300, grossRecovered: 350, predictedRevenue: null, predictedMaxBid: null });
  await addExpense(db, { lotId: grossOnly.id, amount: 330, category: 'lot-purchase', auto: true, spentAt: '2026-08-02' });

  const lost = await createLot(db, { name: 'Lost one', seller: 'Acme', unmanifested: false });
  await recordOutcome(db, { lotId: lost.id, won: false, finalPrice: 999, grossRecovered: null, predictedRevenue: null, predictedMaxBid: null });

  const perf = await lotPerformance(db, 10);
  assert.equal(perf.length, 2, 'lost lots are not on the board');

  const great = perf.find((p) => p.lotId === winner.id)!;
  assert.equal(great.revenue, 1100, 'sales ledger wins over the gross figure');
  assert.equal(great.revenueSource, 'sales-ledger');
  assert.equal(great.profit, 660);
  assert.equal(great.roi, 1.5);

  const ok = perf.find((p) => p.lotId === grossOnly.id)!;
  assert.equal(ok.revenue, 350);
  assert.equal(ok.revenueSource, 'outcome-gross');
  assert.equal(ok.profit, 20);
});

test('migration: current_retail column exists on fresh databases', async () => {
  const db = await openDb(':memory:');
  const row = await db.get<{ current_retail: number | null }>(
    "SELECT current_retail FROM line_items LIMIT 1",
  );
  assert.equal(row, undefined, 'query succeeds (column exists), table just empty');
});
