import type { Db } from './db.ts';
import type { LineItem } from '../types.ts';
import { getLot, getLineItems } from './lots.ts';
import { getOutcome } from './outcomes.ts';
import { listReceipts, summarizeReceipts, type ReceiptSummary } from './receipts.ts';
import { addInventoryItem, updateInventoryItem, deleteInventoryItem, findInventoryByLine } from './inventory.ts';
import { listListingsFor } from './listings.ts';
import { listFamilies, type Family } from './partsbook.ts';
import { matchFamily } from '../valuation/families.ts';
import { landedUnitCost } from '../calc/landed.ts';
import { buildSalvagePlan, type SalvagePlan } from '../calc/salvage.ts';

/**
 * The receiving step: what a won lot's manifest lines became once the pallets
 * were opened, and how those units flow into inventory or the salvage plan.
 */

export function familyForLine(item: LineItem, families: Family[]): Family | null {
  return matchFamily(`${item.description} ${item.category ?? ''}`, families);
}

/** Landed cost per manifest unit for a won lot, or null before an outcome/price exists. */
export async function lotLandedUnitCost(db: Db, lotId: number): Promise<number | null> {
  const [lot, outcome, items] = await Promise.all([getLot(db, lotId), getOutcome(db, lotId), getLineItems(db, lotId)]);
  if (!lot || !outcome || !outcome.won || outcome.finalPrice === null) return null;
  const units = items.reduce((s, i) => s + i.quantity, 0);
  return landedUnitCost(outcome.finalPrice, lot.context.buyersPremiumRate, lot.context.freightQuote ?? 0, units);
}

export interface ReceivingView {
  summary: ReceiptSummary;
  landedUnitCost: number | null;
  lines: {
    item: LineItem;
    family: string | null;
    receipt: Awaited<ReturnType<typeof listReceipts>>[number] | null;
  }[];
  salvage: SalvagePlan;
}

export async function receivingView(db: Db, lotId: number): Promise<ReceivingView> {
  const [items, receipts, families, landed] = await Promise.all([
    getLineItems(db, lotId),
    listReceipts(db, lotId),
    listFamilies(db),
    lotLandedUnitCost(db, lotId),
  ]);
  const byLine = new Map(receipts.map((r) => [r.lineItemId, r]));
  const lines = items.map((item) => ({
    item,
    family: familyForLine(item, families)?.family ?? null,
    receipt: byLine.get(item.id) ?? null,
  }));
  const salvage = buildSalvagePlan(
    lines.map((l) => ({
      lineItemId: l.item.id,
      description: l.item.description,
      family: l.family,
      dead: l.receipt?.dead ?? 0,
      weakBattery: l.receipt?.weakBattery ?? 0,
      incomplete: l.receipt?.incomplete ?? 0,
    })),
    families.map((f) => ({ family: f.family, parts: f.parts, estimated: f.estimated })),
  );
  return { summary: summarizeReceipts(items, receipts), landedUnitCost: landed, lines, salvage };
}

export interface TransferResult {
  created: number;
  updated: number;
  removed: number;
  unitsInInventory: number;
}

/**
 * Create or adjust one inventory row per manifest line with working units.
 * Idempotent: re-running after more check-in sets the row's qty to the current
 * works tally instead of adding a second row. A line whose tally drops to zero
 * loses its row only if nothing has been listed or sold from it.
 */
export async function transferWorkingUnits(db: Db, lotId: number, today: string = new Date().toISOString().slice(0, 10)): Promise<TransferResult> {
  const view = await receivingView(db, lotId);
  const result: TransferResult = { created: 0, updated: 0, removed: 0, unitsInInventory: 0 };
  for (const line of view.lines) {
    const works = line.receipt?.works ?? 0;
    const existing = await findInventoryByLine(db, line.item.id, 'unit');
    if (works === 0) {
      if (existing && existing.qtySold === 0 && (await listListingsFor(db, existing.id)).length === 0) {
        await deleteInventoryItem(db, existing.id);
        result.removed += 1;
      }
      continue;
    }
    if (existing) {
      if (existing.qty !== works || (existing.cost === null && view.landedUnitCost !== null)) {
        await updateInventoryItem(db, existing.id, {
          qty: Math.max(works, existing.qtySold),
          cost: existing.cost ?? view.landedUnitCost,
          family: existing.family ?? line.family,
        });
        result.updated += 1;
      }
    } else {
      await addInventoryItem(db, {
        lotId,
        name: line.item.description,
        qty: works,
        cost: view.landedUnitCost,
        currentRetail: line.item.currentRetail ?? line.item.unitMsrp,
        condition: 'good',
        kind: 'unit',
        family: line.family,
        lineItemId: line.item.id,
        receivedAt: today,
        acquiredAt: today,
      });
      result.created += 1;
    }
    result.unitsInInventory += works;
  }
  return result;
}

/** One parts row per part per family with dead units; skips parts that already exist for the lot. */
export async function createPartsItems(db: Db, lotId: number, today: string = new Date().toISOString().slice(0, 10)): Promise<number> {
  const view = await receivingView(db, lotId);
  let created = 0;
  for (const fam of view.salvage.families) {
    if (fam.dead === 0) continue;
    for (const part of fam.parts) {
      const name = `${fam.family} — ${part.name}`;
      const exists = await db.get<{ id: number }>(
        "SELECT id FROM inventory WHERE lot_id = ? AND kind = 'parts' AND name = ?",
        [lotId, name],
      );
      if (exists) continue;
      await addInventoryItem(db, {
        lotId,
        name,
        description: `Pulled from ${fam.dead} dead ${fam.family} unit${fam.dead === 1 ? '' : 's'} · est. $${part.low}–${part.high} each`,
        qty: fam.dead,
        cost: 0,
        currentRetail: part.high,
        condition: 'fair',
        kind: 'parts',
        family: fam.family,
        receivedAt: today,
        acquiredAt: today,
      });
      created += 1;
    }
  }
  return created;
}
