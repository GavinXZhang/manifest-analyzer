import type { Db } from './db.ts';
import type { InventoryStatus } from './inventory.ts';

export const LISTING_STATUSES = ['draft', 'active', 'ended', 'sold'] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export interface Listing {
  id: number;
  inventoryId: number;
  channelId: number;
  ask: number;
  url: string | null;
  shipped: boolean;
  status: ListingStatus;
  listedAt: string;
  endedAt: string | null;
  lastCutAt: string | null;
}

interface Row {
  id: number; inventory_id: number; channel_id: number; ask: number; url: string | null; shipped: number;
  status: string; listed_at: string; ended_at: string | null; last_cut_at: string | null;
}

const toListing = (r: Row): Listing => ({
  id: r.id,
  inventoryId: r.inventory_id,
  channelId: r.channel_id,
  ask: r.ask,
  url: r.url,
  shipped: r.shipped === 1,
  status: r.status as ListingStatus,
  listedAt: r.listed_at,
  endedAt: r.ended_at,
  lastCutAt: r.last_cut_at,
});

function assertAsk(ask: number): void {
  if (!Number.isFinite(ask) || ask < 0) throw new Error('ask must be a non-negative number');
}

export async function addListing(
  db: Db,
  input: { inventoryId: number; channelId: number; ask: number; url?: string | null; shipped?: boolean; status?: ListingStatus },
): Promise<Listing> {
  assertAsk(input.ask);
  const status = input.status ?? 'active';
  if (!LISTING_STATUSES.includes(status)) throw new Error(`status must be one of ${LISTING_STATUSES.join(', ')}`);
  const r = await db.run(
    `INSERT INTO listings (inventory_id, channel_id, ask, url, shipped, status, listed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [input.inventoryId, input.channelId, input.ask, input.url ?? null, input.shipped ? 1 : 0, status, new Date().toISOString()],
  );
  await applyDerivedStatus(db, input.inventoryId);
  return (await getListing(db, r.lastInsertRowid))!;
}

export async function updateListing(
  db: Db,
  id: number,
  patch: Partial<Pick<Listing, 'ask' | 'url' | 'shipped' | 'status'>>,
): Promise<Listing> {
  const existing = await getListing(db, id);
  if (!existing) throw new Error(`No listing ${id}`);
  const merged = { ...existing, ...patch };
  assertAsk(merged.ask);
  if (!LISTING_STATUSES.includes(merged.status)) throw new Error(`status must be one of ${LISTING_STATUSES.join(', ')}`);
  const endedAt =
    merged.status === 'ended' || merged.status === 'sold'
      ? existing.endedAt ?? new Date().toISOString()
      : null;
  await db.run('UPDATE listings SET ask = ?, url = ?, shipped = ?, status = ?, ended_at = ? WHERE id = ?', [
    merged.ask, merged.url, merged.shipped ? 1 : 0, merged.status, endedAt, id,
  ]);
  await applyDerivedStatus(db, existing.inventoryId);
  return (await getListing(db, id))!;
}

export async function deleteListing(db: Db, id: number): Promise<void> {
  const existing = await getListing(db, id);
  if (!existing) return;
  await db.run('DELETE FROM listings WHERE id = ?', [id]);
  await applyDerivedStatus(db, existing.inventoryId);
}

export async function getListing(db: Db, id: number): Promise<Listing | null> {
  const r = await db.get<Row>('SELECT * FROM listings WHERE id = ?', [id]);
  return r ? toListing(r) : null;
}

export async function listListingsFor(db: Db, inventoryId: number): Promise<Listing[]> {
  const rows = await db.all<Row>('SELECT * FROM listings WHERE inventory_id = ? ORDER BY id', [inventoryId]);
  return rows.map(toListing);
}

export async function listAllListings(db: Db): Promise<Listing[]> {
  const rows = await db.all<Row>('SELECT * FROM listings ORDER BY inventory_id, id');
  return rows.map(toListing);
}

/**
 * Inventory status is derived, never edited: sold once every unit is gone,
 * listed while any listing is active, otherwise in stock. Written back to
 * `inventory.status` so older readers keep working.
 */
export function deriveStatus(qty: number, qtySold: number, listings: Listing[]): InventoryStatus {
  if (qtySold >= qty) return 'sold';
  if (listings.some((l) => l.status === 'active')) return 'listed';
  return 'in-stock';
}

export async function applyDerivedStatus(db: Db, inventoryId: number): Promise<InventoryStatus | null> {
  const item = await db.get<{ qty: number; qty_sold: number }>('SELECT qty, qty_sold FROM inventory WHERE id = ?', [inventoryId]);
  if (!item) return null;
  const status = deriveStatus(item.qty, item.qty_sold, await listListingsFor(db, inventoryId));
  await db.run('UPDATE inventory SET status = ? WHERE id = ?', [status, inventoryId]);
  return status;
}

/** Cut every active ask by a fraction (0.1 = 10%), recording when. */
export async function cutPrice(db: Db, inventoryId: number, fraction: number): Promise<Listing[]> {
  if (!Number.isFinite(fraction) || fraction <= 0 || fraction >= 1) throw new Error('cut must be between 0 and 1');
  const now = new Date().toISOString();
  const active = (await listListingsFor(db, inventoryId)).filter((l) => l.status === 'active');
  await db.batch([
    ...active.map((l) => ({
      sql: 'UPDATE listings SET ask = ?, last_cut_at = ? WHERE id = ?',
      args: [Math.round(l.ask * (1 - fraction) * 100) / 100, now, l.id],
    })),
    { sql: 'UPDATE inventory SET last_cut_at = ? WHERE id = ?', args: [now, inventoryId] },
  ]);
  return listListingsFor(db, inventoryId);
}
