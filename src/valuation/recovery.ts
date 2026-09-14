import type { ConditionGrade, RecoveryRates } from '../types.ts';

/**
 * Effective recovery rate for a condition grade: the (user-editable) base rate
 * scaled by an optional user-confirmed per-seller/category calibration
 * multiplier, clamped to [0, 1].
 */
export function effectiveRate(
  grade: ConditionGrade,
  rates: RecoveryRates,
  segmentMultiplier = 1,
): number {
  return Math.min(1, Math.max(0, rates[grade] * segmentMultiplier));
}
