import type { Db } from './db.ts';
import type { Outcome } from '../types.ts';

interface OutcomeRow {
  lot_id: number;
  won: number;
  final_price: number | null;
  gross_recovered: number | null;
  predicted_revenue: number | null;
  predicted_max_bid: number | null;
  recorded_at: string;
}

function rowToOutcome(r: OutcomeRow): Outcome {
  return {
    lotId: r.lot_id,
    won: r.won === 1,
    finalPrice: r.final_price,
    grossRecovered: r.gross_recovered,
    predictedRevenue: r.predicted_revenue,
    predictedMaxBid: r.predicted_max_bid,
    recordedAt: r.recorded_at,
  };
}

export async function recordOutcome(db: Db, outcome: Omit<Outcome, 'recordedAt'>): Promise<Outcome> {
  await db.run(
    `INSERT INTO outcomes (lot_id, won, final_price, gross_recovered, predicted_revenue, predicted_max_bid, recorded_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(lot_id) DO UPDATE SET won = excluded.won, final_price = excluded.final_price,
       gross_recovered = excluded.gross_recovered,
       predicted_revenue = COALESCE(excluded.predicted_revenue, outcomes.predicted_revenue),
       predicted_max_bid = COALESCE(excluded.predicted_max_bid, outcomes.predicted_max_bid),
       recorded_at = excluded.recorded_at`,
    [
      outcome.lotId,
      outcome.won ? 1 : 0,
      outcome.finalPrice,
      outcome.grossRecovered,
      outcome.predictedRevenue,
      outcome.predictedMaxBid,
      new Date().toISOString(),
    ],
  );
  return (await getOutcome(db, outcome.lotId))!;
}

export async function getOutcome(db: Db, lotId: number): Promise<Outcome | null> {
  const row = await db.get<OutcomeRow>('SELECT * FROM outcomes WHERE lot_id = ?', [lotId]);
  return row ? rowToOutcome(row) : null;
}

export async function listOutcomes(db: Db): Promise<Outcome[]> {
  const rows = await db.all<OutcomeRow>('SELECT * FROM outcomes ORDER BY recorded_at DESC');
  return rows.map(rowToOutcome);
}

export interface SegmentOutcome extends Outcome {
  seller: string;
  category: string;
  extendedRetail: number;
  /** Lot display name (populated by listSegmentOutcomes; empty in synthetic test data). */
  lotName?: string;
}

/**
 * Outcomes joined with lot seller and the lot's dominant category + extended retail,
 * for calibration and closing-range prediction.
 */
export async function listSegmentOutcomes(db: Db): Promise<SegmentOutcome[]> {
  const rows = await db.all<OutcomeRow & { seller: string; lot_name: string; category: string; extended_retail: number }>(
    `SELECT o.*, l.seller, l.name AS lot_name,
       COALESCE((
         SELECT li.category FROM line_items li WHERE li.lot_id = l.id AND li.category IS NOT NULL
         GROUP BY li.category ORDER BY SUM(li.quantity * COALESCE(li.unit_msrp, 0)) DESC LIMIT 1
       ), 'uncategorized') AS category,
       COALESCE((SELECT SUM(li.quantity * COALESCE(li.unit_msrp, 0)) FROM line_items li WHERE li.lot_id = l.id), 0) AS extended_retail
     FROM outcomes o JOIN lots l ON l.id = o.lot_id
     ORDER BY o.recorded_at DESC`,
  );
  return rows.map((r) => ({
    ...rowToOutcome(r),
    seller: r.seller,
    category: r.category,
    extendedRetail: r.extended_retail,
    lotName: r.lot_name,
  }));
}
