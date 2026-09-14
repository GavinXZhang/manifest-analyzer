import type { Db } from './db.ts';

export interface StorageUnit {
  id: number;
  name: string;
  monthlyCost: number;
  /** Day of month rent is due (1–28). */
  dueDay: number;
  note: string | null;
  createdAt: string;
}

interface UnitRow {
  id: number; name: string; monthly_cost: number; due_day: number; note: string | null; created_at: string;
}

const toUnit = (r: UnitRow): StorageUnit => ({
  id: r.id,
  name: r.name,
  monthlyCost: r.monthly_cost,
  dueDay: r.due_day,
  note: r.note,
  createdAt: r.created_at,
});

export async function addStorageUnit(
  db: Db,
  input: { name: string; monthlyCost: number; dueDay: number; note?: string | null },
): Promise<StorageUnit> {
  if (!input.name.trim()) throw new Error('name is required');
  if (!Number.isFinite(input.monthlyCost) || input.monthlyCost < 0) {
    throw new Error('monthlyCost must be a non-negative number');
  }
  if (!Number.isInteger(input.dueDay) || input.dueDay < 1 || input.dueDay > 28) {
    throw new Error('dueDay must be 1–28 (so every month has one)');
  }
  const r = await db.run(
    'INSERT INTO storage_units (name, monthly_cost, due_day, note, created_at) VALUES (?, ?, ?, ?, ?)',
    [input.name.trim(), input.monthlyCost, input.dueDay, input.note ?? null, new Date().toISOString()],
  );
  const row = await db.get<UnitRow>('SELECT * FROM storage_units WHERE id = ?', [r.lastInsertRowid]);
  return toUnit(row!);
}

export async function deleteStorageUnit(db: Db, id: number): Promise<void> {
  await db.run('DELETE FROM storage_units WHERE id = ?', [id]);
}

export async function listStorageUnits(db: Db): Promise<StorageUnit[]> {
  const rows = await db.all<UnitRow>('SELECT * FROM storage_units ORDER BY id');
  return rows.map(toUnit);
}

export async function getStorageUnit(db: Db, id: number): Promise<StorageUnit | null> {
  const row = await db.get<UnitRow>('SELECT * FROM storage_units WHERE id = ?', [id]);
  return row ? toUnit(row) : null;
}

export interface WorkEntry {
  id: number;
  /** YYYY-MM-DD */
  date: string;
  hours: number;
  note: string | null;
  lotId: number | null;
  createdAt: string;
}

interface HoursRow {
  id: number; date: string; hours: number; note: string | null; lot_id: number | null; created_at: string;
}

const toEntry = (r: HoursRow): WorkEntry => ({
  id: r.id,
  date: r.date,
  hours: r.hours,
  note: r.note,
  lotId: r.lot_id,
  createdAt: r.created_at,
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function addWorkEntry(
  db: Db,
  input: { date: string; hours: number; note?: string | null; lotId?: number | null },
): Promise<WorkEntry> {
  if (!DATE_RE.test(input.date)) throw new Error(`date must be YYYY-MM-DD, got "${input.date}"`);
  if (!Number.isFinite(input.hours) || input.hours <= 0 || input.hours > 24) {
    throw new Error('hours must be between 0 and 24');
  }
  const r = await db.run(
    'INSERT INTO work_hours (date, hours, note, lot_id, created_at) VALUES (?, ?, ?, ?, ?)',
    [input.date, input.hours, input.note ?? null, input.lotId ?? null, new Date().toISOString()],
  );
  const row = await db.get<HoursRow>('SELECT * FROM work_hours WHERE id = ?', [r.lastInsertRowid]);
  return toEntry(row!);
}

export async function deleteWorkEntry(db: Db, id: number): Promise<void> {
  await db.run('DELETE FROM work_hours WHERE id = ?', [id]);
}

export async function listWorkEntries(db: Db): Promise<WorkEntry[]> {
  const rows = await db.all<HoursRow>('SELECT * FROM work_hours ORDER BY date DESC, id DESC');
  return rows.map(toEntry);
}

export async function totalHours(db: Db): Promise<number> {
  const row = await db.get<{ s: number }>('SELECT COALESCE(SUM(hours), 0) AS s FROM work_hours');
  return Math.round(row!.s * 100) / 100;
}

export interface TimerState {
  startedAt: string;
  note: string | null;
  lotId: number | null;
}

export async function getTimer(db: Db): Promise<TimerState | null> {
  const row = await db.get<{ started_at: string; note: string | null; lot_id: number | null }>(
    'SELECT started_at, note, lot_id FROM timer WHERE id = 1',
  );
  return row ? { startedAt: row.started_at, note: row.note, lotId: row.lot_id } : null;
}

export async function startTimer(
  db: Db,
  input: { note?: string | null; lotId?: number | null } = {},
): Promise<TimerState> {
  if (await getTimer(db)) throw new Error('A timer is already running — stop it first');
  await db.run('INSERT INTO timer (id, started_at, note, lot_id) VALUES (1, ?, ?, ?)', [
    new Date().toISOString(),
    input.note ?? null,
    input.lotId ?? null,
  ]);
  return (await getTimer(db))!;
}

export async function clearTimer(db: Db): Promise<void> {
  await db.run('DELETE FROM timer WHERE id = 1');
}
