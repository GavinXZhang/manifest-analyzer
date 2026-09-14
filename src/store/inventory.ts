import type { Db } from './db.ts';

export const INVENTORY_STATUSES = ['in-stock', 'listed', 'sold'] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

export const ITEM_CONDITIONS = ['like-new', 'good', 'fair', 'poor'] as const;
export type ItemCondition = (typeof ITEM_CONDITIONS)[number];

export const INVENTORY_KINDS = ['unit', 'parts'] as const;
export type InventoryKind = (typeof INVENTORY_KINDS)[number];

export interface InventoryItem {
  id: number;
  lotId: number | null;
  name: string;
  /** Product description the user copied from the retailer's page. */
  description: string | null;
  qty: number;
  /** Units already sold (sales decrement what's left; qty stays the original count). */
  qtySold: number;
  /** What the unit cost you (your allocation of bid + premium + freight). */
  cost: number | null;
  /** Today's listed retail price, copied from the retailer's site. */
  currentRetail: number | null;
  /** Derived from listings + sales (see listings.ts); kept for older readers. */
  status: InventoryStatus;
  acquiredAt: string | null;
  /** Saved Facebook Marketplace listing text for this item. */
  listingText: string | null;
  /** Physical condition — drives the condition-based suggested asking price. */
  condition: ItemCondition | null;
  /** A whole unit for sale, or parts pulled from a dead one. */
  kind: InventoryKind;
  /** Parts-book family, when matched at check-in. */
  family: string | null;
  /** Manifest line this row came from (check-in transfers are idempotent per line). */
  lineItemId: number | null;
  /** YYYY-MM-DD the unit landed on the shelf; days-on-shelf counts from here. */
  receivedAt: string | null;
  lastCutAt: string | null;
  createdAt: string;
}

interface Row {
  id: number; lot_id: number | null; name: string; description: string | null; qty: number; qty_sold: number;
  cost: number | null; current_retail: number | null; status: string; acquired_at: string | null;
  listing_text: string | null; item_condition: string | null; kind: string; family: string | null;
  line_item_id: number | null; received_at: string | null; last_cut_at: string | null; created_at: string;
}

const toItem = (r: Row): InventoryItem => ({
  id: r.id,
  lotId: r.lot_id,
  name: r.name,
  description: r.description,
  qty: r.qty,
  qtySold: r.qty_sold ?? 0,
  cost: r.cost,
  currentRetail: r.current_retail,
  status: r.status as InventoryStatus,
  acquiredAt: r.acquired_at,
  listingText: r.listing_text,
  condition: r.item_condition as ItemCondition | null,
  kind: (r.kind ?? 'unit') as InventoryKind,
  family: r.family,
  lineItemId: r.line_item_id,
  receivedAt: r.received_at,
  lastCutAt: r.last_cut_at,
  createdAt: r.created_at,
});

function validate(input: Partial<InventoryItem>): void {
  if (input.name !== undefined && input.name.trim() === '') throw new Error('name is required');
  for (const key of ['cost', 'currentRetail'] as const) {
    const v = input[key];
    if (v !== undefined && v !== null && (!Number.isFinite(v) || v < 0)) {
      throw new Error(`${key} must be a non-negative number or null`);
    }
  }
  if (input.qty !== undefined && (!Number.isInteger(input.qty) || input.qty < 1)) {
    throw new Error('qty must be a positive integer');
  }
  if (input.qtySold !== undefined && (!Number.isInteger(input.qtySold) || input.qtySold < 0)) {
    throw new Error('qtySold must be a whole number ≥ 0');
  }
  if (input.status !== undefined && !INVENTORY_STATUSES.includes(input.status)) {
    throw new Error(`status must be one of ${INVENTORY_STATUSES.join(', ')}`);
  }
  if (input.condition !== undefined && input.condition !== null && !ITEM_CONDITIONS.includes(input.condition)) {
    throw new Error(`condition must be one of ${ITEM_CONDITIONS.join(', ')} or null`);
  }
  if (input.kind !== undefined && !INVENTORY_KINDS.includes(input.kind)) {
    throw new Error(`kind must be one of ${INVENTORY_KINDS.join(', ')}`);
  }
}

export async function addInventoryItem(
  db: Db,
  input: Omit<Partial<InventoryItem>, 'id' | 'createdAt'> & { name: string },
): Promise<InventoryItem> {
  validate(input);
  const r = await db.run(
    `INSERT INTO inventory (lot_id, name, description, qty, qty_sold, cost, current_retail, status, acquired_at, listing_text,
       item_condition, kind, family, line_item_id, received_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.lotId ?? null,
      input.name.trim(),
      input.description ?? null,
      input.qty ?? 1,
      input.qtySold ?? 0,
      input.cost ?? null,
      input.currentRetail ?? null,
      input.status ?? 'in-stock',
      input.acquiredAt ?? null,
      input.listingText ?? null,
      input.condition ?? null,
      input.kind ?? 'unit',
      input.family ?? null,
      input.lineItemId ?? null,
      input.receivedAt ?? input.acquiredAt ?? new Date().toISOString().slice(0, 10),
      new Date().toISOString(),
    ],
  );
  return (await getInventoryItem(db, r.lastInsertRowid))!;
}

export async function updateInventoryItem(
  db: Db,
  id: number,
  patch: Omit<Partial<InventoryItem>, 'id' | 'createdAt'>,
): Promise<InventoryItem> {
  const existing = await getInventoryItem(db, id);
  if (!existing) throw new Error(`No inventory item ${id}`);
  const merged = { ...existing, ...patch };
  validate(merged);
  await db.run(
    `UPDATE inventory SET lot_id = ?, name = ?, description = ?, qty = ?, qty_sold = ?, cost = ?,
       current_retail = ?, status = ?, acquired_at = ?, listing_text = ?, item_condition = ?,
       kind = ?, family = ?, line_item_id = ?, received_at = ?, last_cut_at = ? WHERE id = ?`,
    [
      merged.lotId,
      merged.name.trim(),
      merged.description,
      merged.qty,
      merged.qtySold,
      merged.cost,
      merged.currentRetail,
      merged.status,
      merged.acquiredAt,
      merged.listingText,
      merged.condition,
      merged.kind,
      merged.family,
      merged.lineItemId,
      merged.receivedAt,
      merged.lastCutAt,
      id,
    ],
  );
  return (await getInventoryItem(db, id))!;
}

export async function deleteInventoryItem(db: Db, id: number): Promise<void> {
  await db.batch([
    { sql: 'UPDATE events SET inventory_id = NULL WHERE inventory_id = ?', args: [id] },
    { sql: 'UPDATE sales SET inventory_id = NULL WHERE inventory_id = ?', args: [id] },
    { sql: 'DELETE FROM listings WHERE inventory_id = ?', args: [id] },
    { sql: 'DELETE FROM inventory WHERE id = ?', args: [id] },
  ]);
}

export async function getInventoryItem(db: Db, id: number): Promise<InventoryItem | null> {
  const r = await db.get<Row>('SELECT * FROM inventory WHERE id = ?', [id]);
  return r ? toItem(r) : null;
}

export async function listInventory(db: Db): Promise<InventoryItem[]> {
  const rows = await db.all<Row>(
    `SELECT * FROM inventory ORDER BY CASE status WHEN 'sold' THEN 1 ELSE 0 END, created_at DESC, id DESC`,
  );
  return rows.map(toItem);
}

export async function findInventoryByLine(db: Db, lineItemId: number, kind: InventoryKind = 'unit'): Promise<InventoryItem | null> {
  const r = await db.get<Row>('SELECT * FROM inventory WHERE line_item_id = ? AND kind = ? ORDER BY id LIMIT 1', [lineItemId, kind]);
  return r ? toItem(r) : null;
}

export async function listInventoryForLot(db: Db, lotId: number): Promise<InventoryItem[]> {
  const rows = await db.all<Row>('SELECT * FROM inventory WHERE lot_id = ? ORDER BY id', [lotId]);
  return rows.map(toItem);
}
