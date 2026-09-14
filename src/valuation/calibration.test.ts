import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  suggestCalibrations,
  predictClosingRange,
  CALIBRATION_MIN_OUTCOMES,
  CLOSING_RANGE_MIN_OUTCOMES,
} from './calibration.ts';
import type { SegmentOutcome } from '../store/outcomes.ts';

const outcome = (over: Partial<SegmentOutcome> = {}): SegmentOutcome => ({
  lotId: 1,
  won: true,
  finalPrice: 500,
  grossRecovered: 1000,
  predictedRevenue: 1000,
  predictedMaxBid: 400,
  recordedAt: '2026-08-01T00:00:00Z',
  seller: 'Acme',
  category: 'electronics',
  extendedRetail: 4000,
  ...over,
});

test('calibration: needs ≥3 outcomes with gross recorded in a segment', () => {
  const two = [outcome({ lotId: 1 }), outcome({ lotId: 2 })];
  assert.deepEqual(suggestCalibrations(two, () => 1), []);
  assert.equal(CALIBRATION_MIN_OUTCOMES, 3);
});

test('calibration: median ratio drives the suggested multiplier', () => {
  const outcomes = [
    outcome({ lotId: 1, grossRecovered: 700 }),   // 0.7
    outcome({ lotId: 2, grossRecovered: 800 }),   // 0.8
    outcome({ lotId: 3, grossRecovered: 1500 }),  // 1.5
  ];
  const [s] = suggestCalibrations(outcomes, () => 1);
  assert.equal(s.medianRatio, 0.8);
  assert.equal(s.suggestedMultiplier, 0.8);
  assert.equal(s.sampleSize, 3);
  assert.equal(s.seller, 'Acme');
});

test('calibration: composes onto an existing multiplier; spot-on model suggests nothing', () => {
  const outcomes = [
    outcome({ lotId: 1, grossRecovered: 800 }),
    outcome({ lotId: 2, grossRecovered: 800 }),
    outcome({ lotId: 3, grossRecovered: 800 }),
  ];
  const [s] = suggestCalibrations(outcomes, () => 1.5);
  assert.equal(s.suggestedMultiplier, 1.2); // 1.5 × 0.8

  const accurate = [
    outcome({ lotId: 1, grossRecovered: 990 }),
    outcome({ lotId: 2, grossRecovered: 1010 }),
    outcome({ lotId: 3, grossRecovered: 1000 }),
  ];
  assert.deepEqual(suggestCalibrations(accurate, () => 1), [], 'within 5% → no suggestion');
});

test('calibration: lost lots and missing gross are excluded', () => {
  const outcomes = [
    outcome({ lotId: 1 }),
    outcome({ lotId: 2, won: false }),
    outcome({ lotId: 3, grossRecovered: null }),
    outcome({ lotId: 4 }),
  ];
  assert.deepEqual(suggestCalibrations(outcomes, () => 1), [], 'only 2 usable outcomes');
});

test('closing range: needs ≥5 finals in the segment', () => {
  const four = Array.from({ length: 4 }, (_, i) => outcome({ lotId: i }));
  assert.equal(predictClosingRange(four, 'Acme', 'electronics'), null);
  assert.equal(CLOSING_RANGE_MIN_OUTCOMES, 5);
});

test('closing range: p25–p75 band of final price as % of extended retail', () => {
  const outcomes = [0.1, 0.12, 0.15, 0.18, 0.2].map((pct, i) =>
    outcome({ lotId: i, finalPrice: pct * 4000 }),
  );
  const range = predictClosingRange(outcomes, 'acme', 'Electronics')!;
  assert.equal(range.sampleSize, 5);
  assert.equal(range.lowPctOfRetail, 0.12);
  assert.equal(range.highPctOfRetail, 0.18);
});

test('closing range: other segments are not mixed in', () => {
  const outcomes = [
    ...Array.from({ length: 5 }, (_, i) => outcome({ lotId: i })),
    ...Array.from({ length: 5 }, (_, i) => outcome({ lotId: 10 + i, category: 'toys', finalPrice: 3999 })),
  ];
  const range = predictClosingRange(outcomes, 'Acme', 'electronics')!;
  assert.equal(range.sampleSize, 5);
  assert.equal(range.highPctOfRetail, 0.125, 'toys outcomes excluded');
});
