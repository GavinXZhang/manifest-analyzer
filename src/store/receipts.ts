import type { Db } from './db.ts';
import type { LineItem } from '../types.ts';

/** Check-in tallies for one manifest line. */
export interface Receipt {
  lineItemId: number;
  lotId: number;
  received: number;
  works: number;
  incomplete: number;
  weakBattery: number;
  dead: number;
  note: string | null;
  updatedAt: string;
}

export type Tally = Pick<Receipt, 'received' | 'works' | 'incomplete' | 'weakBattery' | 'dead'> & { note?: string | null };

interface Row {
  line_item_id: number; lot_id: number; received: number; works: number; incomplete: number;
  weak_battery: number; dead: number; note: string | null; updated_at: string;
}

const toReceipt = (r: Row): Receipt => ({
  lineItemId: r.line_item_id,
  lotId: r.lot_id,
  received: r.received,
  works: r.works,
  incomplete: r.incomplete,
  weakBattery: r.weak_battery,
  dead: r.dead,
  note: r.note,
  updatedAt: r.updated_at,
});

export function validateTally(t: Tally, label = 'line'): void {
  for (const key of ['received', 'works', 'incomplete', 'weakBattery', 'dead'] as const) {
    if (!Number.isInteger(t[key]) || t[key] < 0) throw new Error(`${label}: ${key} must be a whole number ≥ 0`);
  }
  const sorted = t.works + t.incomplete + t.weakBattery + t.dead;
  if (sorted > t.received) {
    throw new Error(`${label}: works + incomplete + weak battery + dead (${sorted}) exceeds units received (${t.received})`);
  }
}

export async function upsertReceipt(db: Db, lotId: number, lineItemId: number, tally: Tally, label?: string): Promise<Receipt> {
  validateTally(tally, label);
  await db.run(
    `INSERT INTO receipts (line_item_id, lot_id, received, works, incomplete, weak_battery, dead, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(line_item_id) DO UPDATE SET received = excluded.received, works = excluded.works,
       incomplete = excluded.incomplete, weak_battery = excluded.weak_battery, dead = excluded.dead,
       note = excluded.note, updated_at = excluded.updated_at`,
    [lineItemId, lotId, tally.received, tally.works, tally.incomplete, tally.weakBattery, tally.dead, tally.note ?? null, new Date().toISOString()],
  );
  return (await getReceipt(db, lineItemId))!;
}

export async function getReceipt(db: Db, lineItemId: number): Promise<Receipt | null> {
  const r = await db.get<Row>('SELECT * FROM receipts WHERE line_item_id = ?', [lineItemId]);
  return r ? toReceipt(r) : null;
}

export async function listReceipts(db: Db, lotId: number): Promise<Receipt[]> {
  const rows = await db.all<Row>('SELECT * FROM receipts WHERE lot_id = ? ORDER BY line_item_id', [lotId]);
  return rows.map(toReceipt);
}

export interface ReceiptSummary {
  manifestUnits: number;
  checked: number;
  works: number;
  incomplete: number;
  weakBattery: number;
  dead: number;
  linesTotal: number;
  linesChecked: number;
  complete: boolean;
}

export function summarizeReceipts(items: LineItem[], receipts: Receipt[]): ReceiptSummary {
  const byLine = new Map(receipts.map((r) => [r.lineItemId, r]));
  const s: ReceiptSummary = {
    manifestUnits: 0, checked: 0, works: 0, incomplete: 0, weakBattery: 0, dead: 0,
    linesTotal: items.length, linesChecked: 0, complete: false,
  };
  for (const item of items) {
    s.manifestUnits += item.quantity;
    const r = byLine.get(item.id);
    if (!r || r.received === 0) continue;
    s.linesChecked += 1;
    s.checked += r.received;
    s.works += r.works;
    s.incomplete += r.incomplete;
    s.weakBattery += r.weakBattery;
    s.dead += r.dead;
  }
  s.complete = items.length > 0 && s.linesChecked === items.length;
  return s;
}
