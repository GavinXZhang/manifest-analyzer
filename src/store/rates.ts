import type { Db } from './db.ts';
import {
  CONDITION_GRADES,
  DEFAULT_RECOVERY_RATES,
  type ConditionGrade,
  type RecoveryRates,
} from '../types.ts';

export async function getRecoveryRates(db: Db): Promise<RecoveryRates> {
  const rates: RecoveryRates = { ...DEFAULT_RECOVERY_RATES };
  const rows = await db.all<{ grade: string; rate: number }>('SELECT grade, rate FROM recovery_rates');
  for (const row of rows) {
    if ((CONDITION_GRADES as string[]).includes(row.grade)) {
      rates[row.grade as ConditionGrade] = row.rate;
    }
  }
  return rates;
}

export async function saveRecoveryRates(db: Db, rates: Partial<RecoveryRates>): Promise<RecoveryRates> {
  const entries = Object.entries(rates);
  for (const [grade, rate] of entries) {
    if (!(CONDITION_GRADES as string[]).includes(grade)) {
      throw new Error(`Unknown condition grade: ${grade}`);
    }
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 1) {
      throw new Error(`Recovery rate for ${grade} must be between 0 and 1, got ${rate}`);
    }
  }
  await db.batch(
    entries.map(([grade, rate]) => ({
      sql: 'INSERT INTO recovery_rates (grade, rate) VALUES (?, ?) ON CONFLICT(grade) DO UPDATE SET rate = excluded.rate',
      args: [grade, rate as number],
    })),
  );
  return getRecoveryRates(db);
}

export interface SegmentOverride {
  seller: string;
  category: string;
  multiplier: number;
  confirmedAt: string;
}

export async function getSegmentOverride(
  db: Db,
  seller: string,
  category: string,
): Promise<SegmentOverride | null> {
  const row = await db.get<{ seller: string; category: string; multiplier: number; confirmed_at: string }>(
    'SELECT seller, category, multiplier, confirmed_at FROM segment_rate_overrides WHERE seller = ? AND category = ?',
    [seller, category],
  );
  if (!row) return null;
  return {
    seller: row.seller,
    category: row.category,
    multiplier: row.multiplier,
    confirmedAt: row.confirmed_at,
  };
}

export async function saveSegmentOverride(
  db: Db,
  seller: string,
  category: string,
  multiplier: number,
): Promise<void> {
  if (!Number.isFinite(multiplier) || multiplier <= 0 || multiplier > 3) {
    throw new Error(`Segment multiplier must be in (0, 3], got ${multiplier}`);
  }
  await db.run(
    `INSERT INTO segment_rate_overrides (seller, category, multiplier, confirmed_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(seller, category) DO UPDATE SET multiplier = excluded.multiplier, confirmed_at = excluded.confirmed_at`,
    [seller, category, multiplier, new Date().toISOString()],
  );
}
