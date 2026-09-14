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

/* Response bodies are intentionally `any` — these tests assert shapes at runtime. */
interface ApiResult {
  status: number;
  body: any;
}

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

test('e2e: profile → upload → context → comps → analysis → outcome', async () => {
  // Profile: Boston buyer, $800 absolute required profit.
  const prof = await send('PUT', '/profile', {
    homeZip: '02215',
    requiredProfit: { kind: 'absolute', amount: 800 },
  });
  assert.equal(prof.status, 200);
  assert.equal(prof.body.homeZip, '02215');

  // Standard manifest auto-maps with zero configuration.
  const up = await upload('/lots?name=TL%20pallet&seller=TechLiquidators', 'techliquidators-electronics.csv');
  assert.equal(up.status, 200);
  assert.equal(up.body.mapping.needsConfirmation, false);
  assert.equal(up.body.itemCount, 12);
  assert.equal(up.body.lot.mappingStatus, 'confirmed');
  const lotId = up.body.lot.id;

  // Listing context with a real freight quote.
  const ctx = await send('PUT', `/lots/${lotId}/context`, {
    currentBid: 300,
    bidCount: 2,
    freightQuote: 340,
    buyersPremiumRate: 0.1,
  });
  assert.equal(ctx.status, 200);
  assert.equal(ctx.body.context.freightQuote, 340);

  // Comps on the top-value item.
  const top = await get(`/lots/${lotId}/top-items?n=3`);
  assert.equal(top.status, 200);
  assert.equal(top.body.length, 3);
  const itemId = top.body[0].item.id;
  const comps = await send('PUT', `/items/${itemId}/comps`, { prices: [120, 130, 140] });
  assert.equal(comps.status, 200);

  // Analysis: all the verdict furniture is present.
  const a = await get(`/lots/${lotId}/analysis`);
  assert.equal(a.status, 200);
  assert.ok(['BID', 'PASS'].includes(a.body.verdict.decision));
  assert.equal(a.body.rationale.length, 5);
  assert.equal(a.body.bid.freight.isEstimate, false, 'real quote is a hard number');
  assert.ok(
    a.body.bid.expectedRevenue.estimateReasons.includes('floor-valuations'),
    'items without comps keep the revenue flagged',
  );
  const withComps = a.body.valuation.items.find((i: { itemId: number }) => i.itemId === itemId);
  assert.equal(withComps.confidence, 'high');

  // Outcome logging snapshots predictions.
  const oc = await send('POST', `/lots/${lotId}/outcome`, { won: true, finalPrice: 700, grossRecovered: 1500 });
  assert.equal(oc.status, 200);
  assert.equal(oc.body.predictedRevenue, a.body.valuation.expectedRevenue.amount);

  const hist = await get('/history');
  assert.equal(hist.body.outcomes.length, 1);
  assert.equal(hist.body.outcomes[0].seller, 'TechLiquidators');
});

test('e2e: non-standard manifest needs confirmation; confirmed mapping is remembered', async () => {
  const up = await upload('/lots?name=HG%20lot%201&seller=HomeGoodsCo', 'homegoods-returns.csv');
  assert.equal(up.body.mapping.needsConfirmation, true);
  assert.equal(up.body.itemCount, 0, 'no items until the user confirms');
  assert.ok(up.body.mapping.mapping.unit_msrp, 'best guess pre-filled');
  const lotId = up.body.lot.id;

  // Fetching the lot again re-serves the pending mapping screen data.
  const lot = await get(`/lots/${lotId}`);
  assert.ok(lot.body.pendingMapping);
  assert.equal(lot.body.pendingMapping.headers[0], 'Prod Desc');

  const confirm = await send('POST', `/lots/${lotId}/mapping`, {
    description: 'Prod Desc',
    model: 'Item No.',
    quantity: 'Pcs',
    unit_msrp: 'Est. MSRP',
    condition: 'Cond.',
    category: 'Dept',
  });
  assert.equal(confirm.status, 200);
  assert.equal(confirm.body.itemCount, 10);

  // Second upload from the same seller: saved mapping applies, no confirmation.
  const up2 = await upload('/lots?name=HG%20lot%202&seller=homegoodsco', 'homegoods-returns.csv');
  assert.equal(up2.body.mapping.source, 'saved-seller-mapping');
  assert.equal(up2.body.mapping.needsConfirmation, false);
  assert.equal(up2.body.itemCount, 10);
});

test('validation and error paths', async () => {
  assert.equal((await get('/lots/9999')).status, 404);
  assert.equal((await get('/lots/9999/analysis')).status, 404);

  const noName = await fetch(`${base}/lots?seller=x`, { method: 'POST' });
  assert.equal(noName.status, 400);

  const up = await upload('/lots?name=Bad%20map&seller=BadMapCo', 'homegoods-returns.csv');
  const badMapping = await send('POST', `/lots/${up.body.lot.id}/mapping`, { description: 'Nope' });
  assert.equal(badMapping.status, 400);

  const badPremium = await send('PUT', `/lots/${up.body.lot.id}/context`, { buyersPremiumRate: 5 });
  assert.equal(badPremium.status, 400);

  const badComps = await send('PUT', '/items/1/comps', { prices: [-3] });
  assert.equal(badComps.status, 400);
});

test('manifest can be attached to an existing lot after creation', async () => {
  const created = await fetch(`${base}/lots?name=Late%20manifest&seller=LateCo&unmanifested=true`, { method: 'POST' });
  const { lot } = (await created.json()) as { lot: { id: number; unmanifested: boolean } };
  assert.equal(lot.unmanifested, true);

  const up = await upload(`/lots/${lot.id}/manifest`, 'techliquidators-electronics.csv');
  assert.equal(up.status, 200);
  assert.equal(up.body.itemCount, 12, 'standard columns auto-map on attach');
  assert.equal(up.body.lot.unmanifested, false, 'no longer unmanifested');
  assert.equal(up.body.lot.mappingStatus, 'confirmed');

  const empty = await fetch(`${base}/lots/${lot.id}/manifest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
  });
  assert.equal(empty.status, 400, 'empty body rejected');
});

test('timer flow: start → commit saves hours and clears', async () => {
  const start = await send('POST', '/timer/start', { note: 'delivery run' });
  assert.equal(start.status, 200);
  assert.equal(start.body.note, 'delivery run');

  const dup = await send('POST', '/timer/start', {});
  assert.equal(dup.status, 409, 'second timer rejected');

  const commit = await send('POST', '/timer/commit', { hours: 1.5, date: '2026-08-23', note: 'delivery run' });
  assert.equal(commit.status, 200);
  assert.equal(commit.body.hours, 1.5);

  const ws = await get('/workspace');
  assert.equal(ws.body.timer, null, 'timer cleared after commit');
  assert.ok(ws.body.totalHours >= 1.5);
});

test('AI listing endpoint: cleanly disabled without an API key', async () => {
  const status = await get('/ai-status');
  assert.equal(status.body.enabled, false, 'no ANTHROPIC_API_KEY in tests');

  const inv = await send('POST', '/inventory', { name: 'Test couch', cost: 100, currentRetail: 500 });
  const draft = await send('POST', `/listings/${inv.body.id}/ai`, {});
  assert.equal(draft.status, 409);
  assert.match(draft.body.error, /not set up/i);

  // Saved listing text round-trips through the inventory update.
  const saved = await send('PUT', `/inventory/${inv.body.id}`, { listingText: 'Great couch, come get it!' });
  assert.equal(saved.body.listingText, 'Great couch, come get it!');
});

test('description library: add, list, validate, delete', async () => {
  const bad = await send('POST', '/library', { title: '  ', text: 'x' });
  assert.equal(bad.status, 400);

  const added = await send('POST', '/library', {
    title: 'Tisdale sectional — sold Aug 26',
    text: 'Gorgeous Thomasville sectional, $1,499 at Costco — yours for $1,050!',
  });
  assert.equal(added.status, 200);
  assert.equal(added.body.title, 'Tisdale sectional — sold Aug 26');

  const list = await get('/library');
  assert.equal(list.body.entries.length, 1);
  assert.match(list.body.entries[0].text, /Thomasville/);

  await send('DELETE', `/library/${added.body.id}`);
  assert.equal((await get('/library')).body.entries.length, 0);
});

test('unmanifested lot: manual items only, flagged unverifiable', async () => {
  const res = await fetch(`${base}/lots?name=Mystery&seller=Acme&unmanifested=true`, { method: 'POST' });
  const { lot } = (await res.json()) as { lot: { id: number; mappingStatus: string } };
  assert.equal(lot.mappingStatus, 'confirmed');

  const item = await send('POST', `/lots/${lot.id}/items`, {
    description: 'Whole pallet, assorted',
    quantity: 100,
    unitMsrp: 20,
    condition: 'Customer Returns',
  });
  assert.equal(item.status, 200);
  assert.equal(item.body.unverifiable, true);

  const a = await get(`/lots/${lot.id}/analysis`);
  assert.equal(a.body.valuation.unverifiedValueShare, 1, 'entire valuation unverified');
});
