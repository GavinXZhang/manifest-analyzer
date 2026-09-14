import type { Db } from './db.ts';

export const PUNCH_CATEGORIES = ['receiving', 'testing', 'listing', 'photos', 'shipping', 'driving', 'admin', 'other'] as const;
export type PunchCategory = (typeof PUNCH_CATEGORIES)[number];

export interface Punch {
  id: number;
  startedAt: string;
  /** null while the clock is running */
  endedAt: string | null;
  category: PunchCategory;
  lotId: number | null;
  note: string | null;
  source: 'clock' | 'manual';
}

interface Row {
  id: number; started_at: string; ended_at: string | null; category: string; lot_id: number | null; note: string | null; source: string;
}

const toPunch = (r: Row): Punch => ({
  id: r.id,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  category: r.category as PunchCategory,
  lotId: r.lot_id,
  note: r.note,
  source: r.source as Punch['source'],
});

function assertCategory(c: string): asserts c is PunchCategory {
  if (!(PUNCH_CATEGORIES as readonly string[]).includes(c)) {
    throw new Error(`category must be one of ${PUNCH_CATEGORIES.join(', ')}`);
  }
}

function assertIso(label: string, iso: string): void {
  if (!Number.isFinite(Date.parse(iso))) throw new Error(`${label} must be an ISO date-time`);
}

export async function getRunningPunch(db: Db): Promise<Punch | null> {
  const r = await db.get<Row>('SELECT * FROM punches WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1');
  return r ? toPunch(r) : null;
}

export async function clockIn(
  db: Db,
  input: { category?: string; lotId?: number | null; note?: string | null; at?: string } = {},
): Promise<Punch> {
  if (await getRunningPunch(db)) throw new Error('Already clocked in — clock out or switch task first');
  const category = input.category ?? 'other';
  assertCategory(category);
  const at = input.at ?? new Date().toISOString();
  const r = await db.run(
    `INSERT INTO punches (started_at, ended_at, category, lot_id, note, source) VALUES (?, NULL, ?, ?, ?, 'clock')`,
    [at, category, input.lotId ?? null, input.note ?? null],
  );
  return (await getPunch(db, r.lastInsertRowid))!;
}

export async function clockOut(db: Db, at: string = new Date().toISOString()): Promise<Punch> {
  const running = await getRunningPunch(db);
  if (!running) throw new Error('Not clocked in');
  if (Date.parse(at) < Date.parse(running.startedAt)) throw new Error('clock-out is before clock-in');
  await db.run('UPDATE punches SET ended_at = ? WHERE id = ?', [at, running.id]);
  return (await getPunch(db, running.id))!;
}

/** Close the running punch and immediately open a new one. */
export async function switchTask(
  db: Db,
  input: { category?: string; lotId?: number | null; note?: string | null },
): Promise<Punch> {
  const at = new Date().toISOString();
  await clockOut(db, at);
  return clockIn(db, { ...input, at });
}

export async function addManualPunch(
  db: Db,
  input: { startedAt: string; endedAt: string; category?: string; lotId?: number | null; note?: string | null },
): Promise<Punch> {
  assertIso('startedAt', input.startedAt);
  assertIso('endedAt', input.endedAt);
  if (Date.parse(input.endedAt) <= Date.parse(input.startedAt)) throw new Error('end must be after start');
  if (Date.parse(input.endedAt) - Date.parse(input.startedAt) > 24 * 3600_000) throw new Error('a punch cannot exceed 24 hours');
  const category = input.category ?? 'other';
  assertCategory(category);
  const r = await db.run(
    `INSERT INTO punches (started_at, ended_at, category, lot_id, note, source) VALUES (?, ?, ?, ?, ?, 'manual')`,
    [input.startedAt, input.endedAt, category, input.lotId ?? null, input.note ?? null],
  );
  return (await getPunch(db, r.lastInsertRowid))!;
}

export async function updatePunch(
  db: Db,
  id: number,
  patch: Partial<Pick<Punch, 'startedAt' | 'endedAt' | 'category' | 'lotId' | 'note'>>,
): Promise<Punch> {
  const existing = await getPunch(db, id);
  if (!existing) throw new Error(`No punch ${id}`);
  const merged = { ...existing, ...patch };
  assertIso('startedAt', merged.startedAt);
  if (merged.endedAt !== null) {
    assertIso('endedAt', merged.endedAt);
    if (Date.parse(merged.endedAt) <= Date.parse(merged.startedAt)) throw new Error('end must be after start');
  }
  assertCategory(merged.category);
  await db.run('UPDATE punches SET started_at = ?, ended_at = ?, category = ?, lot_id = ?, note = ? WHERE id = ?', [
    merged.startedAt, merged.endedAt, merged.category, merged.lotId, merged.note, id,
  ]);
  return (await getPunch(db, id))!;
}

export async function deletePunch(db: Db, id: number): Promise<void> {
  await db.run('DELETE FROM punches WHERE id = ?', [id]);
}

export async function getPunch(db: Db, id: number): Promise<Punch | null> {
  const r = await db.get<Row>('SELECT * FROM punches WHERE id = ?', [id]);
  return r ? toPunch(r) : null;
}

/** Punches overlapping [from, to) by start time, newest first. Omit both for everything. */
export async function listPunches(db: Db, from?: string, to?: string): Promise<Punch[]> {
  const rows =
    from && to
      ? await db.all<Row>('SELECT * FROM punches WHERE started_at >= ? AND started_at < ? ORDER BY started_at DESC, id DESC', [from, to])
      : await db.all<Row>('SELECT * FROM punches ORDER BY started_at DESC, id DESC');
  return rows.map(toPunch);
}

// ---- aggregation (pure) ----

export function punchHours(p: Punch, now: Date = new Date()): number {
  const end = p.endedAt ? Date.parse(p.endedAt) : now.getTime();
  return Math.max(0, (end - Date.parse(p.startedAt)) / 3600_000);
}

/** YYYY-MM-DD of an instant in the given IANA time zone. */
export function localDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export function hoursByDay(punches: Punch[], timeZone: string, now: Date = new Date()): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of punches) {
    const day = localDay(p.startedAt, timeZone);
    m.set(day, round2((m.get(day) ?? 0) + punchHours(p, now)));
  }
  return m;
}

export function hoursByCategory(punches: Punch[], now: Date = new Date()): { category: PunchCategory; hours: number; share: number }[] {
  const m = new Map<PunchCategory, number>();
  let total = 0;
  for (const p of punches) {
    const h = punchHours(p, now);
    total += h;
    m.set(p.category, (m.get(p.category) ?? 0) + h);
  }
  return [...m.entries()]
    .map(([category, hours]) => ({ category, hours: round2(hours), share: total > 0 ? Math.round((hours / total) * 100) / 100 : 0 }))
    .sort((a, b) => b.hours - a.hours);
}

export function totalHours(punches: Punch[], now: Date = new Date()): number {
  return round2(punches.reduce((s, p) => s + punchHours(p, now), 0));
}

export function hoursForLot(punches: Punch[], lotId: number, now: Date = new Date()): number {
  return totalHours(punches.filter((p) => p.lotId === lotId), now);
}
