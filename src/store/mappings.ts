import type { Db } from './db.ts';
import type { ColumnMapping } from '../types.ts';

export async function getSellerMapping(db: Db, seller: string): Promise<ColumnMapping | null> {
  const row = await db.get<{ mapping_json: string }>(
    'SELECT mapping_json FROM seller_mappings WHERE seller = ?',
    [seller.trim().toLowerCase()],
  );
  return row ? (JSON.parse(row.mapping_json) as ColumnMapping) : null;
}

export async function saveSellerMapping(db: Db, seller: string, mapping: ColumnMapping): Promise<void> {
  await db.run(
    `INSERT INTO seller_mappings (seller, mapping_json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(seller) DO UPDATE SET mapping_json = excluded.mapping_json, updated_at = excluded.updated_at`,
    [seller.trim().toLowerCase(), JSON.stringify(mapping), new Date().toISOString()],
  );
}
