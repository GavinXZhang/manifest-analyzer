import type { Db } from './db.ts';

export const INVENTORY_STATUSES = ['in-stock', 'listed', 'sold'] as const;
export type InventoryStatus = (typeof INVENTORY_STATUSES)[number];

export const ITEM_CONDITIONS = ['like-new', 'good', 'fair', 'poor'] as const;
export type ItemCondition = (typeof ITEM_CONDITIONS)[number];

export interface InventoryItem {
  id: number;
  lotId: number | null;
  name: string;
  /** Product description the user copied from the retailer's page. */
  description: string | null;
  qty: number;
  /** What the unit cost you (your allocation of bid + premium + freight). */
  cost: number | null;
  /** Today's listed retail price, copied from the retailer's site. */
  currentRetail: number | null;
  status: InventoryStatus;
  acquiredAt: string | null;
  /** Saved Facebook Marketplace listing text for this item. */
  listingText: string | null;
  /** Physical condition — drives the condition-based suggested asking price. */
  condition: ItemCondition | null;
  createdAt: string;
}

interface Row {
  id: number; lot_id: number | null; name: string; description: string | null; qty: number;
  cost: number | null; current_retail: number | null; status: string; acquired_at: string | null;
  listing_text: string | null; item_condition: string | null; created_at: string;
}

const toItem = (r: Row): InventoryItem => ({
  id: r.id,
  lotId: r.lot_id,
  name: r.name,
  description: r.description,
  qty: r.qty,
  cost: r.cost,
  currentRetail: r.current_retail,
  status: r.status as InventoryStatus,
  acquiredAt: r.acquired_at,
  listingText: r.listing_text,
  condition: r.item_condition as ItemCondition | null,
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
  if (input.status !== undefined && !INVENTORY_STATUSES.includes(input.status)) {
    throw new Error(`status must be one of ${INVENTORY_STATUSES.join(', ')}`);
  }
  if (input.condition !== undefined && input.condition !== null && !ITEM_CONDITIONS.includes(input.condition)) {
    throw new Error(`condition must be one of ${ITEM_CONDITIONS.join(', ')} or null`);
  }
}

export async function addInventoryItem(
  db: Db,
  input: Omit<Partial<InventoryItem>, 'id' | 'createdAt'> & { name: string },
): Promise<InventoryItem> {
  validate(input);
  const r = await db.run(
    `INSERT INTO inventory (lot_id, name, description, qty, cost, current_retail, status, acquired_at, listing_text, item_condition, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.lotId ?? null,
      input.name.trim(),
      input.description ?? null,
      input.qty ?? 1,
      input.cost ?? null,
      input.currentRetail ?? null,
      input.status ?? 'in-stock',
      input.acquiredAt ?? null,
      input.listingText ?? null,
      input.condition ?? null,
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
    `UPDATE inventory SET lot_id = ?, name = ?, description = ?, qty = ?, cost = ?,
       current_retail = ?, status = ?, acquired_at = ?, listing_text = ?, item_condition = ? WHERE id = ?`,
    [
      merged.lotId,
      merged.name.trim(),
      merged.description,
      merged.qty,
      merged.cost,
      merged.currentRetail,
      merged.status,
      merged.acquiredAt,
      merged.listingText,
      merged.condition,
      id,
    ],
  );
  return (await getInventoryItem(db, id))!;
}

export async function deleteInventoryItem(db: Db, id: number): Promise<void> {
  await db.batch([
    { sql: 'UPDATE events SET inventory_id = NULL WHERE inventory_id = ?', args: [id] },
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
