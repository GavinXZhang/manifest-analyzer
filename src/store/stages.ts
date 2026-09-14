import type { Db } from './db.ts';

export const LOT_STAGES = ['analyzing', 'bid_placed', 'won', 'received', 'selling', 'closed'] as const;
export type LotStage = (typeof LOT_STAGES)[number];

export const STAGE_LABELS: Record<LotStage, string> = {
  analyzing: 'Analyzing',
  bid_placed: 'Bid placed',
  won: 'Won',
  received: 'Received',
  selling: 'Selling',
  closed: 'Closed',
};

export interface StageEvent {
  id: number;
  lotId: number;
  stage: LotStage;
  at: string;
  inferred: boolean;
}

interface Row { id: number; lot_id: number; stage: string; at: string; inferred: number }

const toEvent = (r: Row): StageEvent => ({ id: r.id, lotId: r.lot_id, stage: r.stage as LotStage, at: r.at, inferred: r.inferred === 1 });

export function isLotStage(value: unknown): value is LotStage {
  return typeof value === 'string' && (LOT_STAGES as readonly string[]).includes(value);
}

export async function getStage(db: Db, lotId: number): Promise<LotStage> {
  const row = await db.get<{ stage: string | null }>('SELECT stage FROM lots WHERE id = ?', [lotId]);
  return isLotStage(row?.stage) ? row.stage : 'analyzing';
}

/**
 * Move a lot to a stage and log the transition. A no-op when the lot is
 * already there, so callers can invoke it from every path that implies a
 * stage (outcome saved, check-in finished, first listing…) without spamming
 * the event log.
 */
export async function setStage(
  db: Db,
  lotId: number,
  stage: LotStage,
  opts: { at?: string; inferred?: boolean } = {},
): Promise<StageEvent | null> {
  const current = await getStage(db, lotId);
  const events = await listStageEvents(db, lotId);
  if (current === stage && events.length > 0) return null;
  const at = opts.at ?? new Date().toISOString();
  await db.batch([
    { sql: 'UPDATE lots SET stage = ? WHERE id = ?', args: [stage, lotId] },
    {
      sql: 'INSERT INTO lot_stage_events (lot_id, stage, at, inferred) VALUES (?, ?, ?, ?)',
      args: [lotId, stage, at, opts.inferred ? 1 : 0],
    },
  ]);
  const row = await db.get<Row>('SELECT * FROM lot_stage_events WHERE lot_id = ? ORDER BY id DESC LIMIT 1', [lotId]);
  return toEvent(row!);
}

export async function listStageEvents(db: Db, lotId: number): Promise<StageEvent[]> {
  const rows = await db.all<Row>('SELECT * FROM lot_stage_events WHERE lot_id = ? ORDER BY at, id', [lotId]);
  return rows.map(toEvent);
}

export async function listAllStageEvents(db: Db): Promise<StageEvent[]> {
  const rows = await db.all<Row>('SELECT * FROM lot_stage_events ORDER BY at, id');
  return rows.map(toEvent);
}

/** When the lot entered its current stage (null before the first event). */
export async function stageEnteredAt(db: Db, lotId: number): Promise<string | null> {
  const row = await db.get<{ at: string }>(
    'SELECT at FROM lot_stage_events WHERE lot_id = ? ORDER BY at DESC, id DESC LIMIT 1',
    [lotId],
  );
  return row?.at ?? null;
}
