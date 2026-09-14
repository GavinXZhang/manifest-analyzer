import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from './csv.ts';
import { detectTable } from './headers.ts';
import { proposeMapping, applySavedMapping, CONFIDENCE_THRESHOLD } from './mapping.ts';
import { normalizeRows, normalizeCondition, parseMoney, isValidGtin } from './normalize.ts';
import { parseManifest } from './ingest.ts';
import { estimateFreight, resolveFreight } from './freight.ts';
import { emptyListingContext } from '../types.ts';

const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures');

test('csv: quotes, escaped quotes, CRLF, BOM, delimiter detection', () => {
  const rows = parseCsv('﻿a,b,c\r\n"x,y","he said ""hi""",3\n');
  assert.deepEqual(rows, [
    ['a', 'b', 'c'],
    ['x,y', 'he said "hi"', '3'],
  ]);
  assert.deepEqual(parseCsv('a\tb\n1\t2'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
  assert.deepEqual(parseCsv('a;b\n1;2'), [
    ['a', 'b'],
    ['1', '2'],
  ]);
});

test('standard B-Stock manifest maps with zero manual configuration', () => {
  const text = readFileSync(join(FIXTURES, 'techliquidators-electronics.csv'), 'utf8');
  const table = detectTable(parseCsv(text));
  assert.deepEqual(table.headers, ['Item Description', 'UPC', 'Qty', 'Unit Retail', 'Condition', 'Category']);

  const proposal = proposeMapping(table.headers);
  assert.equal(proposal.needsConfirmation, false, 'standard columns must not require confirmation');
  assert.equal(proposal.confidence, 1);
  assert.equal(proposal.mapping.description, 'Item Description');
  assert.equal(proposal.mapping.upc, 'UPC');
  assert.equal(proposal.mapping.quantity, 'Qty');
  assert.equal(proposal.mapping.unit_msrp, 'Unit Retail');
  assert.equal(proposal.mapping.condition, 'Condition');

  const items = normalizeRows(table.headers, table.rows, proposal.mapping);
  assert.equal(items.length, 12, 'every row mapped');
  assert.ok(items.every((i) => i.identifierType === 'UPC' && !i.unverifiable));
  assert.equal(items[0].quantity, 12);
  assert.equal(items[0].unitMsrp, 149.99);
  assert.equal(items[0].conditionGrade, 'customer-returns');
});

test('non-standard columns fall below threshold and yield best-guess proposal', () => {
  const text = readFileSync(join(FIXTURES, 'homegoods-returns.csv'), 'utf8');
  const table = detectTable(parseCsv(text));
  const proposal = proposeMapping(table.headers);
  assert.equal(proposal.needsConfirmation, true, 'Prod Desc / Pcs / Est. MSRP must require confirmation');
  assert.ok(proposal.confidence < CONFIDENCE_THRESHOLD);
  // Best guesses are still pre-filled for the mapping screen.
  assert.equal(proposal.mapping.unit_msrp, 'Est. MSRP');
  assert.equal(proposal.mapping.category, 'Dept');
});

test('saved seller mapping applies when headers match, else null', () => {
  const headers = ['Prod Desc', 'Item No.', 'Pcs', 'Est. MSRP', 'Cond.', 'Dept'];
  const saved = {
    description: 'Prod Desc',
    model: 'Item No.',
    quantity: 'Pcs',
    unit_msrp: 'Est. MSRP',
    condition: 'Cond.',
    category: 'Dept',
  };
  const applied = applySavedMapping(headers, saved);
  assert.ok(applied);
  assert.equal(applied.confidence, 1);
  assert.equal(applied.needsConfirmation, false);
  assert.equal(applied.source, 'saved-seller-mapping');

  assert.equal(applySavedMapping(['Different', 'Columns'], saved), null);
});

test('xlsx fixture: junk title row skipped, ASIN and unverifiable rows handled', async () => {
  const buf = readFileSync(join(FIXTURES, 'amazon-returns.xlsx'));
  const table = await parseManifest('amazon-returns.xlsx', buf);
  assert.equal(table.headers[0], 'Description');
  assert.ok(table.headerRowIndex >= 1, 'title row above header was skipped');

  const proposal = proposeMapping(table.headers);
  assert.equal(proposal.needsConfirmation, false);
  const items = normalizeRows(table.headers, table.rows, proposal.mapping);
  assert.equal(items.length, 9);

  const echo = items.find((i) => i.description.startsWith('Echo Dot'));
  assert.equal(echo?.identifierType, 'ASIN');
  assert.equal(echo?.identifier, 'B09B8V1LZ3');

  const unverifiable = items.filter((i) => i.unverifiable);
  assert.equal(unverifiable.length, 2, 'rows without identifiers flagged unverifiable');
  assert.ok(unverifiable.every((i) => i.identifierType === 'none'));

  const salvage = items.find((i) => i.description.includes('phone accessories'));
  assert.equal(salvage?.conditionGrade, 'salvage');
});

test('condition normalization: specific phrases win over substrings', () => {
  assert.equal(normalizeCondition('Brand New'), 'new');
  assert.equal(normalizeCondition('Like New'), 'like-new');
  assert.equal(normalizeCondition('Used - Like New'), 'like-new');
  assert.equal(normalizeCondition('Open Box'), 'like-new');
  assert.equal(normalizeCondition('Shelf Pulls'), 'like-new');
  assert.equal(normalizeCondition('Customer Returns'), 'customer-returns');
  assert.equal(normalizeCondition('Used - Good'), 'customer-returns');
  assert.equal(normalizeCondition('Salvage'), 'salvage');
  assert.equal(normalizeCondition('As-Is'), 'salvage');
  assert.equal(normalizeCondition('Scratch & Dent'), 'salvage');
  assert.equal(normalizeCondition(''), 'unknown');
  assert.equal(normalizeCondition('Mixed'), 'unknown');
});

test('money and total-row handling', () => {
  assert.equal(parseMoney('$1,299.99'), 1299.99);
  assert.equal(parseMoney(''), null);
  assert.equal(parseMoney('n/a'), null);

  const headers = ['Item Description', 'UPC', 'Qty', 'Unit Retail'];
  const rows = [
    ['Widget', '012345678905', '2', '$10.00'],
    ['TOTAL', '', '', '$20.00'],
  ];
  const items = normalizeRows(headers, rows, {
    description: 'Item Description',
    upc: 'UPC',
    quantity: 'Qty',
    unit_msrp: 'Unit Retail',
  });
  assert.equal(items.length, 1, 'summary/total rows dropped');
});

test('GTIN checksum: real codes pass, typos and fakes fail', () => {
  assert.equal(isValidGtin('012345678905'), true, 'classic valid UPC-A');
  assert.equal(isValidGtin('027242923423'), true, 'fixture UPC');
  assert.equal(isValidGtin('012345678904'), false, 'one digit off');
  assert.equal(isValidGtin('999999999999'), false, 'fabricated code');
  assert.equal(isValidGtin('4006381333931'), true, 'EAN-13');
  assert.equal(isValidGtin('12345'), false, 'wrong length');
  assert.equal(isValidGtin('01234567890a'), false, 'non-digits');
});

test('identifier realism: bad-checksum UPCs demote to model, stripped zeros repaired', () => {
  const headers = ['Item Description', 'UPC', 'Qty', 'Unit Retail'];
  const mapping = { description: 'Item Description', upc: 'UPC', quantity: 'Qty', unit_msrp: 'Unit Retail' } as const;
  const items = normalizeRows(
    headers,
    [
      ['Legit item', '012345678905', '1', '10'],
      ['Excel ate my zero', '12345678905', '1', '10'],
      ['Suspicious code', '012345678904', '1', '10'],
    ],
    mapping,
  );
  assert.equal(items[0].identifierType, 'UPC');
  assert.equal(items[1].identifierType, 'UPC', '11-digit code repaired by restoring leading zero');
  assert.equal(items[1].identifier, '012345678905');
  assert.equal(items[2].identifierType, 'model', 'failing checksum means it is not a real barcode');
});

test('freight estimator: deterministic, always flagged as estimate', () => {
  const est = estimateFreight({ originZip: '85001', destZip: '02215', palletCount: 2, weightClass: 'standard' });
  assert.equal(est.isEstimate, true);
  assert.deepEqual(est.estimateReasons, ['freight-estimate']);
  // zone |8-0| = 8 → $300/pallet: 300 + 300×0.85 = 555
  assert.equal(est.amount, 555);

  assert.throws(() => estimateFreight({ originZip: 'nope', destZip: '02215', palletCount: 1, weightClass: 'light' }));
});

test('resolveFreight: quote is hard, zip fallback is estimate, neither is null', () => {
  const ctx = emptyListingContext();

  assert.equal(resolveFreight(ctx, '02215'), null);

  const quoted = resolveFreight({ ...ctx, freightQuote: 340 }, '02215')!;
  assert.equal(quoted.amount, 340);
  assert.equal(quoted.isEstimate, false);

  const estimated = resolveFreight(
    { ...ctx, sellerZip: '85001', palletCount: 1, weightClass: 'standard' },
    '02215',
  )!;
  assert.equal(estimated.isEstimate, true);

  const free = resolveFreight({ ...ctx, shippingType: 'free' }, null)!;
  assert.equal(free.amount, 0);
  assert.equal(free.isEstimate, false);
});
