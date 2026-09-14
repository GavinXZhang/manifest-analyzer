import type { Db } from './db.ts';

export const EVENT_KINDS = ['delivery', 'viewing', 'pickup', 'other'] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export interface CalendarEvent {
  id: number;
  title: string;
  kind: EventKind;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM, optional */
  time: string | null;
  contact: string | null;
  note: string | null;
  inventoryId: number | null;
  createdAt: string;
}

interface Row {
  id: number; title: string; kind: string; date: string; time: string | null;
  contact: string | null; note: string | null; inventory_id: number | null; created_at: string;
}

const toEvent = (r: Row): CalendarEvent => ({
  id: r.id,
  title: r.title,
  kind: r.kind as EventKind,
  date: r.date,
  time: r.time,
  contact: r.contact,
  note: r.note,
  inventoryId: r.inventory_id,
  createdAt: r.created_at,
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function addEvent(
  db: Db,
  input: {
    title: string;
    kind: EventKind;
    date: string;
    time?: string | null;
    contact?: string | null;
    note?: string | null;
    inventoryId?: number | null;
  },
): Promise<CalendarEvent> {
  if (!input.title.trim()) throw new Error('title is required');
  if (!EVENT_KINDS.includes(input.kind)) throw new Error(`kind must be one of ${EVENT_KINDS.join(', ')}`);
  if (!DATE_RE.test(input.date)) throw new Error(`date must be YYYY-MM-DD, got "${input.date}"`);
  if (input.time != null && input.time !== '' && !TIME_RE.test(input.time)) {
    throw new Error(`time must be HH:MM, got "${input.time}"`);
  }
  const r = await db.run(
    `INSERT INTO events (title, kind, date, time, contact, note, inventory_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.title.trim(),
      input.kind,
      input.date,
      input.time || null,
      input.contact ?? null,
      input.note ?? null,
      input.inventoryId ?? null,
      new Date().toISOString(),
    ],
  );
  const row = await db.get<Row>('SELECT * FROM events WHERE id = ?', [r.lastInsertRowid]);
  return toEvent(row!);
}

export async function deleteEvent(db: Db, id: number): Promise<void> {
  await db.run('DELETE FROM events WHERE id = ?', [id]);
}

export async function listEvents(db: Db, from?: string, to?: string): Promise<CalendarEvent[]> {
  const rows =
    from !== undefined && to !== undefined
      ? await db.all<Row>('SELECT * FROM events WHERE date >= ? AND date <= ? ORDER BY date, time, id', [from, to])
      : await db.all<Row>('SELECT * FROM events ORDER BY date, time, id');
  return rows.map(toEvent);
}
