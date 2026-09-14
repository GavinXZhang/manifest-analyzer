import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floorPrice, targetPrice } from './pricing.ts';
import { estimateSetAside, maSalesTax, MA_SALES_TAX_RATE } from './tax.ts';

test('floor price: break-even after selling fees', () => {
  // Sell at $100 with 15% fees → keep $85. So $85 of cost needs a $100 price.
  assert.equal(floorPrice(85, 0.15), 100);
  assert.equal(floorPrice(0, 0.15), 0);
  assert.equal(floorPrice(-5, 0.15), null);
  assert.equal(floorPrice(85, 1), null, 'fee rate of 100% has no break-even');
});

test('target price: also clears the profit margin', () => {
  // cost 55, fees 15%, margin 30% → P = 55 / 0.55 = 100
  assert.equal(targetPrice(55, 0.15, 0.3), 100);
  assert.equal(targetPrice(55, 0.15, 0), floorPrice(55, 0.15), 'zero margin degenerates to floor');
  assert.equal(targetPrice(55, 0.6, 0.5), null, 'fees + margin ≥ 100% is impossible');
});

test('MA set-aside: SE tax + federal estimate + 5% state', () => {
  const est = estimateSetAside(10_000, 0.12);
  // SE: 10000 × 0.9235 × 0.153 = 1412.955 → 1412.96(±)
  assert.equal(est.seTax, 1412.96);
  assert.equal(est.seDeduction, 706.48);
  assert.equal(est.taxableIncome, 9293.52);
  assert.equal(est.federalIncomeEst, 1115.22);
  assert.equal(est.maIncomeEst, 464.68);
  assert.equal(est.totalSetAside, 2992.85, 'rounded once from the precise sum');
  assert.ok(est.setAsideRate > 0.29 && est.setAsideRate < 0.31);
});

test('MA set-aside: no SE tax under the $400 threshold, no negatives', () => {
  const tiny = estimateSetAside(300, 0.12);
  assert.equal(tiny.seTax, 0, 'below the SE minimum');
  assert.ok(tiny.totalSetAside > 0, 'income tax still estimated');

  const loss = estimateSetAside(-5000, 0.12);
  assert.equal(loss.totalSetAside, 0, 'a loss year sets aside nothing');
  assert.equal(loss.setAsideRate, 0);
});

test('MA sales tax: 6.25% on direct sales only', () => {
  assert.equal(MA_SALES_TAX_RATE, 0.0625);
  assert.equal(maSalesTax(1000), 62.5);
  assert.equal(maSalesTax(0), 0);
  assert.equal(maSalesTax(-10), 0);
});
