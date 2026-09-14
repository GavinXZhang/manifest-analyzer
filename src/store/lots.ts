import type { Db } from './db.ts';
import {
  emptyListingContext,
  type CanonicalItem,
  type LineItem,
  type ListingContext,
  type Lot,
  type MappingStatus,
} from '../types.ts';

interface LotRow {
  id: number;
  name: string;
  seller: string;
  unmanifested: number;
  mapping_status: string;
  context_json: string | null;
  created_at: string;
}

function rowToLot(row: LotRow): Lot {
  return {
    id: row.id,
    name: row.name,
    seller: row.seller,
    unmanifested: row.unmanifested === 1,
    mappingStatus: row.mapping_status as MappingStatus,
    context: row.context_json
      ? { ...emptyListingContext(), ...(JSON.parse(row.context_json) as Partial<ListingContext>) }
      : emptyListingContext(),
    createdAt: row.created_at,
  };
}

export async function createLot(
  db: Db,
  input: { name: string; seller: string; unmanifested: boolean },
): Promise<Lot> {
  const result = await db.run(
    'INSERT INTO lots (name, seller, unmanifested, mapping_status, created_at) VALUES (?, ?, ?, ?, ?)',
    [
      input.name,
      input.seller,
      input.unmanifested ? 1 : 0,
      input.unmanifested ? 'confirmed' : 'pending',
      new Date().toISOString(),
    ],
  );
  return (await getLot(db, result.lastInsertRowid))!;
}

export async function getLot(db: Db, id: number): Promise<Lot | null> {
  const row = await db.get<LotRow>('SELECT * FROM lots WHERE id = ?', [id]);
  return row ? rowToLot(row) : null;
}

export async function listLots(db: Db): Promise<Lot[]> {
  const rows = await db.all<LotRow>('SELECT * FROM lots ORDER BY created_at DESC, id DESC');
  return rows.map(rowToLot);
}

/** Explicit cascade: children first, ledger links nulled, then the lot. */
export async function deleteLot(db: Db, id: number): Promise<void> {
  await db.batch([
    { sql: 'DELETE FROM comps WHERE item_id IN (SELECT id FROM line_items WHERE lot_id = ?)', args: [id] },
    { sql: 'DELETE FROM line_items WHERE lot_id = ?', args: [id] },
    { sql: 'DELETE FROM lot_files WHERE lot_id = ?', args: [id] },
    { sql: 'DELETE FROM outcomes WHERE lot_id = ?', args: [id] },
    { sql: 'UPDATE sales SET lot_id = NULL WHERE lot_id = ?', args: [id] },
    { sql: 'UPDATE expenses SET lot_id = NULL WHERE lot_id = ?', args: [id] },
    { sql: 'UPDATE inventory SET lot_id = NULL WHERE lot_id = ?', args: [id] },
    { sql: 'DELETE FROM lots WHERE id = ?', args: [id] },
  ]);
}

export async function saveContext(db: Db, lotId: number, context: ListingContext): Promise<void> {
  await db.run('UPDATE lots SET context_json = ? WHERE id = ?', [JSON.stringify(context), lotId]);
}

export async function setMappingStatus(db: Db, lotId: number, status: MappingStatus): Promise<void> {
  await db.run('UPDATE lots SET mapping_status = ? WHERE id = ?', [status, lotId]);
}

export async function setUnmanifested(db: Db, lotId: number, value: boolean): Promise<void> {
  await db.run('UPDATE lots SET unmanifested = ? WHERE id = ?', [value ? 1 : 0, lotId]);
}

export async function saveRawFile(
  db: Db,
  lotId: number,
  filename: string | null,
  headers: string[],
  rows: string[][],
): Promise<void> {
  await db.run(
    `INSERT INTO lot_files (lot_id, filename, headers_json, rows_json) VALUES (?, ?, ?, ?)
     ON CONFLICT(lot_id) DO UPDATE SET filename = excluded.filename,
       headers_json = excluded.headers_json, rows_json = excluded.rows_json`,
    [lotId, filename, JSON.stringify(headers), JSON.stringify(rows)],
  );
}

export async function getRawFile(
  db: Db,
  lotId: number,
): Promise<{ filename: string | null; headers: string[]; rows: string[][] } | null> {
  const row = await db.get<{ filename: string | null; headers_json: string; rows_json: string }>(
    'SELECT filename, headers_json, rows_json FROM lot_files WHERE lot_id = ?',
    [lotId],
  );
  if (!row) return null;
  return {
    filename: row.filename,
    headers: JSON.parse(row.headers_json) as string[],
    rows: JSON.parse(row.rows_json) as string[][],
  };
}

const INSERT_ITEM_SQL = `INSERT INTO line_items
  (lot_id, description, identifier_type, identifier, quantity, unit_msrp, condition_raw, condition_grade, category, unverifiable)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const itemArgs = (lotId: number, item: CanonicalItem) => [
  lotId,
  item.description,
  item.identifierType,
  item.identifier,
  item.quantity,
  item.unitMsrp,
  item.conditionRaw,
  item.conditionGrade,
  item.category,
  item.unverifiable ? 1 : 0,
];

export async function replaceLineItems(
  db: Db,
  lotId: number,
  items: CanonicalItem[],
): Promise<LineItem[]> {
  await db.batch([
    { sql: 'DELETE FROM comps WHERE item_id IN (SELECT id FROM line_items WHERE lot_id = ?)', args: [lotId] },
    { sql: 'DELETE FROM line_items WHERE lot_id = ?', args: [lotId] },
    ...items.map((item) => ({ sql: INSERT_ITEM_SQL, args: itemArgs(lotId, item) })),
  ]);
  return getLineItems(db, lotId);
}

/** Manual line-item entry — the only way to give an unmanifested lot substance. */
export async function addLineItem(db: Db, lotId: number, item: CanonicalItem): Promise<LineItem> {
  const result = await db.run(INSERT_ITEM_SQL, itemArgs(lotId, item));
  return (await getLineItem(db, result.lastInsertRowid))!;
}

interface ItemRow {
  id: number;
  lot_id: number;
  description: string;
  identifier_type: string;
  identifier: string | null;
  quantity: number;
  unit_msrp: number | null;
  condition_raw: string;
  condition_grade: string;
  category: string | null;
  unverifiable: number;
  current_retail: number | null;
}

function rowToItem(r: ItemRow): LineItem {
  return {
    id: r.id,
    lotId: r.lot_id,
    description: r.description,
    identifierType: r.identifier_type as LineItem['identifierType'],
    identifier: r.identifier,
    quantity: r.quantity,
    unitMsrp: r.unit_msrp,
    conditionRaw: r.condition_raw,
    conditionGrade: r.condition_grade as LineItem['conditionGrade'],
    category: r.category,
    unverifiable: r.unverifiable === 1,
    currentRetail: r.current_retail,
  };
}

export async function getLineItems(db: Db, lotId: number): Promise<LineItem[]> {
  const rows = await db.all<ItemRow>('SELECT * FROM line_items WHERE lot_id = ? ORDER BY id', [lotId]);
  return rows.map(rowToItem);
}

export async function getLineItem(db: Db, itemId: number): Promise<LineItem | null> {
  const r = await db.get<ItemRow>('SELECT * FROM line_items WHERE id = ?', [itemId]);
  return r ? rowToItem(r) : null;
}

export async function setCurrentRetail(db: Db, itemId: number, value: number | null): Promise<void> {
  if (value !== null && (!Number.isFinite(value) || value < 0)) {
    throw new Error(`currentRetail must be a non-negative number or null, got ${value}`);
  }
  await db.run('UPDATE line_items SET current_retail = ? WHERE id = ?', [value, itemId]);
}

export interface CompEntry {
  id: number;
  itemId: number;
  soldPrice: number;
  note: string | null;
  enteredAt: string;
}

export async function setComps(
  db: Db,
  itemId: number,
  soldPrices: { price: number; note?: string }[],
): Promise<CompEntry[]> {
  for (const { price } of soldPrices) {
    if (!Number.isFinite(price) || price < 0) {
      throw new Error(`Comp price must be a non-negative number, got ${price}`);
    }
  }
  const now = new Date().toISOString();
  await db.batch([
    { sql: 'DELETE FROM comps WHERE item_id = ?', args: [itemId] },
    ...soldPrices.map(({ price, note }) => ({
      sql: 'INSERT INTO comps (item_id, sold_price, note, entered_at) VALUES (?, ?, ?, ?)',
      args: [itemId, price, note ?? null, now],
    })),
  ]);
  return getComps(db, itemId);
}

interface CompRow {
  id: number;
  item_id: number;
  sold_price: number;
  note: string | null;
  entered_at: string;
}

const rowToComp = (r: CompRow): CompEntry => ({
  id: r.id,
  itemId: r.item_id,
  soldPrice: r.sold_price,
  note: r.note,
  enteredAt: r.entered_at,
});

export async function getComps(db: Db, itemId: number): Promise<CompEntry[]> {
  const rows = await db.all<CompRow>('SELECT * FROM comps WHERE item_id = ? ORDER BY id', [itemId]);
  return rows.map(rowToComp);
}

export async function getCompsForLot(db: Db, lotId: number): Promise<Map<number, CompEntry[]>> {
  const rows = await db.all<CompRow>(
    'SELECT c.* FROM comps c JOIN line_items li ON li.id = c.item_id WHERE li.lot_id = ? ORDER BY c.id',
    [lotId],
  );
  const map = new Map<number, CompEntry[]>();
  for (const r of rows) {
    const list = map.get(r.item_id) ?? [];
    list.push(rowToComp(r));
    map.set(r.item_id, list);
  }
  return map;
}
