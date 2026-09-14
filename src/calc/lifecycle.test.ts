import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landedUnitCost, landedTotal } from './landed.ts';
import { feeFor, netAfterFees, bestNet } from './fees.ts';
import { daysBetween, carryingRatePerItemDay, accruedCarryingCost, agingLevel, daysInMonth } from './aging.ts';
import { buildSalvagePlan } from './salvage.ts';
import { matchFamily, matchesFamily } from '../valuation/families.ts';
import { PARTS_BOOK_SEEDS } from '../store/seeds.ts';

test('landed unit cost: the vacuum lot lands at $52.30/unit', () => {
  assert.equal(landedTotal(4566.09, 0.03, 683.83), 5386.9);
  assert.equal(landedUnitCost(4566.09, 0.03, 683.83, 103), 52.3);
  assert.equal(landedUnitCost(100, 0.1, 0, 0), null);
});

test('fees: percent + fixed, shipped override, best net', () => {
  const ebay = { feePercent: 0.1325, feeFixed: 0.3, shippedFeePercent: null, shippedFeeFixed: null };
  assert.equal(feeFor(199, ebay), 26.67);
  assert.equal(netAfterFees(199, ebay), 172.33);
  const fb = { feePercent: 0, feeFixed: 0, shippedFeePercent: 0.05, shippedFeeFixed: 0 };
  assert.equal(netAfterFees(185, fb), 185);
  assert.equal(netAfterFees(185, fb, true), 175.75);
  assert.deepEqual(bestNet([{ source: 'eBay', net: 172.33 }, { source: 'FB', net: 185 }]), { source: 'FB', net: 185 });
  assert.equal(bestNet([]), null);
});

test('aging: days, carrying rate, thresholds', () => {
  assert.equal(daysBetween('2026-07-29', '2026-09-14'), 47);
  assert.equal(daysBetween('2026-09-14', '2026-09-01'), 0);
  assert.equal(daysInMonth('2026-09-14'), 30);
  const rate = carryingRatePerItemDay(184, 30, 71);
  assert.ok(Math.abs(rate - 0.0864) < 0.001);
  assert.equal(accruedCarryingCost(47, rate), 4.06);
  assert.equal(agingLevel(20, 21, 30), 'ok');
  assert.equal(agingLevel(21, 21, 30), 'warn');
  assert.equal(agingLevel(30, 21, 30), 'cut');
});

test('family matching: most specific family wins, tokens are whole words', () => {
  const fams = PARTS_BOOK_SEEDS.map((f) => ({ family: f.family, keywords: f.keywords }));
  assert.equal(matchFamily('DYSON V11 TORQUE DR STICK', fams)?.family, 'Dyson V11');
  assert.equal(matchFamily('DYSON BALL ANIMAL2 ORIGIN', fams)?.family, 'Dyson upright');
  assert.equal(matchFamily('DYSON OUTSIZE STICK VAC', fams)?.family, 'Dyson Outsize');
  assert.equal(matchFamily('TINECO GO PET CYCLONE', fams)?.family, 'Tineco Pet Cyclone');
  assert.equal(matchFamily('TINECO IFLOOR3 ULTRA VAC', fams)?.family, 'Tineco Floor One');
  assert.equal(matchFamily('ECOVACS X2 OMNI VAC', fams)?.family, 'Ecovacs X2');
  assert.equal(matchFamily('LG CORDZERO CHARGE PLUS', fams)?.family, 'LG CordZero');
  assert.equal(matchFamily('West Elm sofa', fams), null);
  assert.equal(matchesFamily('DYSON V110', { family: 'x', keywords: ['V11'] }), false);
});

test('salvage plan: pools by family, cannibalisation, floors', () => {
  const families = [
    { family: 'Dyson V11', estimated: true, parts: [{ name: 'Battery', low: 40, high: 70 }, { name: 'Head', low: 50, high: 80 }] },
    { family: 'Ecovacs X2', estimated: true, parts: [{ name: 'Station', low: 150, high: 250 }] },
  ];
  const plan = buildSalvagePlan(
    [
      { lineItemId: 1, description: 'DYSON V11 STICK', family: 'Dyson V11', dead: 1, weakBattery: 1, incomplete: 0 },
      { lineItemId: 2, description: 'DYSON V11 CORDLESS', family: 'Dyson V11', dead: 1, weakBattery: 0, incomplete: 1 },
      { lineItemId: 3, description: 'ECOVACS X2 OMNI', family: 'Ecovacs X2', dead: 1, weakBattery: 0, incomplete: 0 },
      { lineItemId: 4, description: 'MYSTERY VAC', family: null, dead: 1, weakBattery: 0, incomplete: 0 },
      { lineItemId: 5, description: 'FINE VAC', family: 'Dyson V11', dead: 0, weakBattery: 0, incomplete: 0 },
    ],
    families,
  );
  assert.equal(plan.families.length, 2);
  const v11 = plan.families.find((f) => f.family === 'Dyson V11')!;
  assert.equal(v11.dead, 2);
  assert.equal(v11.weakBattery, 1);
  assert.equal(v11.cannibalize, 1);
  assert.deepEqual(v11.perUnitFloor, { low: 90, high: 150 });
  assert.deepEqual(v11.floor, { low: 180, high: 300 });
  assert.equal(plan.families[0].family, 'Dyson V11'); // highest floor first
  assert.equal(plan.unmatched.length, 1);
  assert.equal(plan.totalDead, 4);
  assert.deepEqual(plan.floor, { low: 330, high: 550 });
});
