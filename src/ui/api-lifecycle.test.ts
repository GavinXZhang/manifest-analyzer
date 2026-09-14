import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { openDb } from '../store/db.ts';
import { createApp } from './server.ts';

const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures');

let server: Server;
let base: string;

before(async () => {
  const app = createApp(await openDb(':memory:'));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
after(() => server.close());

interface ApiResult { status: number; body: any }

const get = async (path: string): Promise<ApiResult> => {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
};
const send = async (method: string, path: string, body?: unknown): Promise<ApiResult> => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const upload = async (path: string, file: string): Promise<ApiResult> => {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': file },
    body: readFileSync(join(FIXTURES, file)),
  });
  return { status: res.status, body: await res.json() };
};

test('lifecycle e2e: analyze → won → receive → inventory → list → sell → money/today', async () => {
  await send('PUT', '/profile', { homeZip: '02215', monthlyRevenueGoal: 3000 });

  const up = await upload('/lots?name=TL%20pallet&seller=TechLiquidators', 'techliquidators-electronics.csv');
  assert.equal(up.status, 200);
  const lotId = up.body.lot.id as number;

  // Board: new lot sits in Analyzing.
  let board = await get('/lots/board');
  assert.equal(board.status, 200);
  assert.equal(board.body.columns.find((c: any) => c.stage === 'analyzing').count, 1);

  // Manual stage: bid placed.
  const st = await send('POST', `/lots/${lotId}/stage`, { stage: 'bid_placed' });
  assert.equal(st.body.stage, 'bid_placed');
  assert.equal((await send('POST', `/lots/${lotId}/stage`, { stage: 'nope' })).status, 400);

  // Won → stage won; landed cost appears.
  await send('PUT', `/lots/${lotId}/context`, { buyersPremiumRate: 0.1, freightQuote: 340 });
  const out = await send('POST', `/lots/${lotId}/outcome`, { won: true, finalPrice: 250 });
  assert.equal(out.status, 200);
  assert.equal((await get(`/lots/${lotId}/stage`)).body.stage, 'won');
  const recv = await get(`/lots/${lotId}/receiving`);
  assert.equal(recv.status, 200);
  assert.ok(recv.body.landedUnitCost > 0);
  assert.equal(recv.body.summary.checked, 0);
  const lines = recv.body.lines as any[];
  assert.ok(lines.length > 0);

  // Tallies with validation.
  const first = lines[0].item;
  const badTally = await send('PUT', `/lots/${lotId}/receipts/${first.id}`, { received: 1, works: 2 });
  assert.equal(badTally.status, 400);
  const ok = await send('PUT', `/lots/${lotId}/receipts/${first.id}`, { received: first.quantity, works: Math.max(0, first.quantity - 1), dead: first.quantity > 0 ? 1 : 0 });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.summary.checked, first.quantity);

  // Transfer + finish → received; inventory rows carry the landed cost.
  const fin = await send('POST', `/lots/${lotId}/receiving/finish`, {});
  assert.equal(fin.status, 200);
  assert.equal(fin.body.stage, 'received');
  const inv = await get('/inventory/view');
  assert.equal(inv.status, 200);
  const items = inv.body.items as any[];
  const unit = items.find((i) => i.lineItemId === first.id);
  if (first.quantity > 1) {
    assert.ok(unit, 'working units became inventory');
    assert.equal(unit.cost, recv.body.landedUnitCost);
    assert.equal(unit.state, 'unlisted');
  }

  // Channels seeded; list on eBay → item listed, lot moves to selling.
  const channels = (await get('/channels')).body.channels as any[];
  const ebay = channels.find((c) => c.name === 'eBay');
  assert.ok(ebay);
  const target = unit ?? items[0];
  const listing = await send('POST', `/inventory/${target.id}/listings`, { channelId: ebay.id, ask: 100 });
  assert.equal(listing.status, 200);
  assert.equal((await get(`/lots/${lotId}/stage`)).body.stage, 'selling');
  const viewAfter = (await get('/inventory/view')).body.items.find((i: any) => i.id === target.id);
  assert.equal(viewAfter.state, 'listed');
  assert.equal(viewAfter.bestNet.channelName, 'eBay');
  assert.equal(viewAfter.bestNet.net, 86.45);

  // Cut price, then sell one unit through the listing with fees.
  const cut = await send('POST', `/inventory/${target.id}/cut`, {});
  assert.equal(cut.body.listings[0].ask, 90);
  const sold = await send('POST', `/inventory/${target.id}/sold`, { amount: 90, listingId: listing.body.id, soldAt: '2026-09-10' });
  assert.equal(sold.status, 200);
  assert.equal(sold.body.sale.fees, 12.23);

  // Drafts fall back to templates without an API key.
  const draft = await send('POST', `/inventory/${target.id}/draft`, { channelId: ebay.id });
  assert.equal(draft.body.source, 'template');
  assert.ok(draft.body.text.length > 20);

  // Time card.
  const ci = await send('POST', '/punches/clock-in', { category: 'receiving', lotId });
  assert.equal(ci.status, 200);
  assert.equal((await send('POST', '/punches/clock-in', {})).status, 409);
  const tc = await get('/timecard');
  assert.equal(tc.body.days.length, 7);
  assert.ok(tc.body.running);
  await send('POST', '/punches/clock-out', {});
  assert.equal((await get('/punches/running')).body.running, null);

  // Recurring + money + reports + today.
  const rec = await send('POST', '/recurring', { name: 'Shelf', amount: 55, dueDay: 1 });
  assert.equal(rec.status, 200);
  const money = await get('/money/summary?period=90d');
  assert.equal(money.status, 200);
  assert.ok(money.body.revenue.value >= 90);
  assert.ok(Array.isArray(money.body.scoreboard));
  for (const kind of ['revenue-goal', 'net', 'funnel', 'cycle', 'hours', 'storage']) {
    const r = await get(`/reports/${kind}?period=90d`);
    assert.equal(r.status, 200, kind);
    assert.ok(Array.isArray(r.body.series), kind);
  }
  assert.equal((await get('/reports/bogus')).status, 404);
  const funnel = await get('/reports/funnel?period=90d');
  assert.equal(funnel.body.series.find((s: any) => s.key === 'won').value, 1);

  const today = await get('/today');
  assert.equal(today.status, 200);
  assert.ok('timeCard' in today.body && 'money' in today.body);
  assert.equal(today.body.checkin.length, 0);

  // Exports.
  const csv = await fetch(`${base}/export/sales.csv`);
  assert.equal(csv.status, 200);
  assert.match(await csv.text(), /amount/);

  // Legacy routes still answer.
  assert.equal((await get('/ledger')).status, 200);
  assert.equal((await get(`/lots/${lotId}`)).body.lot.stage, 'selling');
  board = await get('/lots/board');
  assert.equal(board.body.columns.find((c: any) => c.stage === 'selling').count, 1);
});
