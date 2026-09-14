import type { Db } from './db.ts';
import type { FeeRule } from '../calc/fees.ts';

export const DRAFT_STYLES = ['ebay', 'casual', 'short', 'furniture', 'plain'] as const;
export type DraftStyle = (typeof DRAFT_STYLES)[number];

export interface Channel extends FeeRule {
  id: number;
  name: string;
  categories: string[];
  draftStyle: DraftStyle;
  enabled: boolean;
  sort: number;
}

interface Row {
  id: number; name: string; fee_percent: number; fee_fixed: number; shipped_fee_percent: number | null;
  shipped_fee_fixed: number | null; categories_json: string; draft_style: string; enabled: number; sort: number;
}

const toChannel = (r: Row): Channel => ({
  id: r.id,
  name: r.name,
  feePercent: r.fee_percent,
  feeFixed: r.fee_fixed,
  shippedFeePercent: r.shipped_fee_percent,
  shippedFeeFixed: r.shipped_fee_fixed,
  categories: JSON.parse(r.categories_json) as string[],
  draftStyle: r.draft_style as DraftStyle,
  enabled: r.enabled === 1,
  sort: r.sort,
});

function validate(c: Omit<Channel, 'id' | 'sort'>): void {
  if (!c.name.trim()) throw new Error('name is required');
  const rate = (label: string, v: number | null) => {
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 1)) throw new Error(`${label} must be between 0 and 1`);
  };
  const money = (label: string, v: number | null) => {
    if (v !== null && (!Number.isFinite(v) || v < 0)) throw new Error(`${label} must be ≥ 0`);
  };
  rate('feePercent', c.feePercent);
  rate('shippedFeePercent', c.shippedFeePercent);
  money('feeFixed', c.feeFixed);
  money('shippedFeeFixed', c.shippedFeeFixed);
  if (!DRAFT_STYLES.includes(c.draftStyle)) throw new Error(`draftStyle must be one of ${DRAFT_STYLES.join(', ')}`);
}

export async function listChannels(db: Db, opts: { enabledOnly?: boolean } = {}): Promise<Channel[]> {
  const rows = await db.all<Row>(
    `SELECT * FROM channels ${opts.enabledOnly ? 'WHERE enabled = 1' : ''} ORDER BY sort, id`,
  );
  return rows.map(toChannel);
}

export async function getChannel(db: Db, id: number): Promise<Channel | null> {
  const r = await db.get<Row>('SELECT * FROM channels WHERE id = ?', [id]);
  return r ? toChannel(r) : null;
}

export async function addChannel(db: Db, input: Partial<Omit<Channel, 'id' | 'sort'>> & { name: string }): Promise<Channel> {
  const c: Omit<Channel, 'id' | 'sort'> = {
    name: input.name,
    feePercent: input.feePercent ?? 0,
    feeFixed: input.feeFixed ?? 0,
    shippedFeePercent: input.shippedFeePercent ?? null,
    shippedFeeFixed: input.shippedFeeFixed ?? null,
    categories: input.categories ?? [],
    draftStyle: input.draftStyle ?? 'casual',
    enabled: input.enabled ?? true,
  };
  validate(c);
  const max = (await db.get<{ m: number | null }>('SELECT MAX(sort) AS m FROM channels'))!.m ?? -1;
  const r = await db.run(
    `INSERT INTO channels (name, fee_percent, fee_fixed, shipped_fee_percent, shipped_fee_fixed, categories_json, draft_style, enabled, sort)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [c.name.trim(), c.feePercent, c.feeFixed, c.shippedFeePercent, c.shippedFeeFixed, JSON.stringify(c.categories), c.draftStyle, c.enabled ? 1 : 0, max + 1],
  );
  return (await getChannel(db, r.lastInsertRowid))!;
}

export async function updateChannel(db: Db, id: number, patch: Partial<Omit<Channel, 'id'>>): Promise<Channel> {
  const existing = await getChannel(db, id);
  if (!existing) throw new Error(`No channel ${id}`);
  const merged = { ...existing, ...patch };
  validate(merged);
  await db.run(
    `UPDATE channels SET name = ?, fee_percent = ?, fee_fixed = ?, shipped_fee_percent = ?, shipped_fee_fixed = ?,
       categories_json = ?, draft_style = ?, enabled = ?, sort = ? WHERE id = ?`,
    [merged.name.trim(), merged.feePercent, merged.feeFixed, merged.shippedFeePercent, merged.shippedFeeFixed,
      JSON.stringify(merged.categories), merged.draftStyle, merged.enabled ? 1 : 0, merged.sort, id],
  );
  return (await getChannel(db, id))!;
}

export async function deleteChannel(db: Db, id: number): Promise<void> {
  const inUse = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM listings WHERE channel_id = ?', [id]))!.n;
  if (inUse > 0) throw new Error('This channel has listings — disable it instead of deleting');
  await db.run('DELETE FROM channels WHERE id = ?', [id]);
}
