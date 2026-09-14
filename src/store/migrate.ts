import type { Db } from './db.ts';
import { CHANNEL_SEEDS, PARTS_BOOK_SEEDS } from './seeds.ts';

/**
 * One-time data migrations, each keyed in the `meta` table so it runs exactly
 * once per database. Schema changes live in db.ts (idempotent DDL); this file
 * moves and seeds *data*: stage back-fill for lots that predate the lifecycle,
 * storage units → recurring expenses, hours/timer → punches, and seed rows for
 * channels and the parts book.
 */

async function done(db: Db, key: string): Promise<boolean> {
  return (await db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key])) !== undefined;
}

async function mark(db: Db, key: string): Promise<void> {
  await db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING', [key, new Date().toISOString()]);
}

export async function runDataMigrations(db: Db, now: Date = new Date()): Promise<void> {
  if (!(await done(db, 'v2-lifecycle'))) {
    await backfillStages(db);
    await migrateStorageUnits(db, now);
    await migrateHours(db);
    await mark(db, 'v2-lifecycle');
  }
  await seedChannels(db);
  await seedPartsBook(db);
}

/** Lots without a stage event get one inferred from their outcome / inventory. */
export async function backfillStages(db: Db): Promise<number> {
  const lots = await db.all<{ id: number; created_at: string }>(
    'SELECT id, created_at FROM lots WHERE id NOT IN (SELECT lot_id FROM lot_stage_events)',
  );
  for (const lot of lots) {
    const outcome = await db.get<{ won: number; recorded_at: string }>('SELECT won, recorded_at FROM outcomes WHERE lot_id = ?', [lot.id]);
    const inventory = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM inventory WHERE lot_id = ?', [lot.id]);
    let stage = 'analyzing';
    let at = lot.created_at;
    if (outcome) {
      at = outcome.recorded_at;
      stage = outcome.won === 1 ? ((inventory?.n ?? 0) > 0 ? 'selling' : 'won') : 'closed';
    }
    await db.batch([
      { sql: 'UPDATE lots SET stage = ? WHERE id = ?', args: [stage, lot.id] },
      { sql: 'INSERT INTO lot_stage_events (lot_id, stage, at, inferred) VALUES (?, ?, ?, 1)', args: [lot.id, stage, at] },
    ]);
  }
  return lots.length;
}

/**
 * Storage units become recurring expenses. `last_period` is set to the current
 * month so the automatic poster starts next month — this month's rent was (or
 * will be) recorded by hand the old way, and must not post twice.
 */
async function migrateStorageUnits(db: Db, now: Date): Promise<void> {
  const units = await db.all<{ name: string; monthly_cost: number; due_day: number; note: string | null; created_at: string }>(
    'SELECT name, monthly_cost, due_day, note, created_at FROM storage_units',
  );
  const period = now.toISOString().slice(0, 7);
  for (const u of units) {
    await db.run(
      `INSERT INTO recurring_expenses (name, amount, category, due_day, active, last_period, note, created_at)
       VALUES (?, ?, 'storage', ?, 1, ?, ?, ?)`,
      [u.name, u.monthly_cost, u.due_day, period, u.note, u.created_at],
    );
  }
}

/** Hours logs become manual punches (09:00 → 09:00 + hours); a running timer becomes an open punch. */
async function migrateHours(db: Db): Promise<void> {
  const hours = await db.all<{ date: string; hours: number; note: string | null; lot_id: number | null }>(
    'SELECT date, hours, note, lot_id FROM work_hours',
  );
  for (const h of hours) {
    const start = new Date(`${h.date}T09:00:00`);
    const end = new Date(start.getTime() + h.hours * 3600_000);
    await db.run(
      `INSERT INTO punches (started_at, ended_at, category, lot_id, note, source) VALUES (?, ?, 'other', ?, ?, 'manual')`,
      [start.toISOString(), end.toISOString(), h.lot_id, h.note],
    );
  }
  const timer = await db.get<{ started_at: string; note: string | null; lot_id: number | null }>(
    'SELECT started_at, note, lot_id FROM timer WHERE id = 1',
  );
  if (timer) {
    await db.run(
      `INSERT INTO punches (started_at, ended_at, category, lot_id, note, source) VALUES (?, NULL, 'other', ?, ?, 'clock')`,
      [timer.started_at, timer.lot_id, timer.note],
    );
    await db.run('DELETE FROM timer WHERE id = 1');
  }
}

async function seedChannels(db: Db): Promise<void> {
  const n = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM channels'))!.n;
  if (n > 0) return;
  await db.batch(
    CHANNEL_SEEDS.map((c, i) => ({
      sql: `INSERT INTO channels (name, fee_percent, fee_fixed, shipped_fee_percent, shipped_fee_fixed, categories_json, draft_style, enabled, sort)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [c.name, c.feePercent, c.feeFixed, c.shippedFeePercent, c.shippedFeeFixed, JSON.stringify(c.categories), c.draftStyle, c.enabled ? 1 : 0, i],
    })),
  );
}

async function seedPartsBook(db: Db): Promise<void> {
  const n = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM parts_book'))!.n;
  if (n > 0) return;
  const now = new Date().toISOString();
  await db.batch(
    PARTS_BOOK_SEEDS.map((f) => ({
      sql: 'INSERT INTO parts_book (family, match_json, parts_json, estimated, updated_at) VALUES (?, ?, ?, 1, ?)',
      args: [f.family, JSON.stringify({ keywords: f.keywords }), JSON.stringify(f.parts), now],
    })),
  );
}
