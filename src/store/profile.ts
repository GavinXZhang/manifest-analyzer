import type { Db } from './db.ts';
import { defaultProfile, type Profile } from '../types.ts';

export async function getProfile(db: Db): Promise<Profile> {
  const row = await db.get<{ json: string }>('SELECT json FROM profile WHERE id = 1');
  if (!row) return defaultProfile();
  // Merge over defaults so profiles saved by older versions keep new fields.
  return { ...defaultProfile(), ...(JSON.parse(row.json) as Partial<Profile>) };
}

export async function saveProfile(db: Db, profile: Profile): Promise<Profile> {
  const merged = { ...defaultProfile(), ...profile };
  validateProfile(merged);
  await db.run(
    'INSERT INTO profile (id, json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET json = excluded.json',
    [JSON.stringify(merged)],
  );
  return merged;
}

export async function updateProfile(db: Db, patch: Partial<Profile>): Promise<Profile> {
  return saveProfile(db, { ...(await getProfile(db)), ...patch });
}

function assertRate(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be between 0 and 1, got ${value}`);
  }
}

function validateProfile(p: Profile): void {
  assertRate('sellingFeeRate', p.sellingFeeRate);
  assertRate('defaultBuyersPremiumRate', p.defaultBuyersPremiumRate);
  assertRate('conservativeFloorRate', p.conservativeFloorRate);
  assertRate('sellThroughProbability', p.sellThroughProbability);
  assertRate('estimatedFederalRate', p.estimatedFederalRate);
  if (p.maxSpendPerLot !== null && (!Number.isFinite(p.maxSpendPerLot) || p.maxSpendPerLot < 0)) {
    throw new Error('maxSpendPerLot must be a non-negative number or null');
  }
  for (const key of ['monthlyRevenueGoal', 'hourlyValue'] as const) {
    if (p[key] !== null && (!Number.isFinite(p[key]) || p[key]! < 0)) {
      throw new Error(`${key} must be a non-negative number or null`);
    }
  }
  for (const key of ['agingWarnDays', 'agingCutDays', 'checkinOverdueDays'] as const) {
    if (!Number.isInteger(p[key]) || p[key] < 0) throw new Error(`${key} must be a whole number ≥ 0`);
  }
  if (p.agingCutDays < p.agingWarnDays) throw new Error('agingCutDays must be ≥ agingWarnDays');
  if (!Number.isFinite(p.priceCutFraction) || p.priceCutFraction <= 0 || p.priceCutFraction >= 1) {
    throw new Error('priceCutFraction must be between 0 and 1');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: p.timeZone });
  } catch {
    throw new Error(`Unknown time zone "${p.timeZone}"`);
  }
  if (p.requiredProfit.kind === 'absolute') {
    if (!Number.isFinite(p.requiredProfit.amount) || p.requiredProfit.amount < 0) {
      throw new Error('requiredProfit.amount must be a non-negative number');
    }
  } else {
    assertRate('requiredProfit.percent', p.requiredProfit.percent);
  }
}
