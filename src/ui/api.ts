import { Router, json, raw } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { Db } from '../store/db.ts';
import {
  emptyListingContext,
  REQUIRED_FIELDS,
  type CanonicalField,
  type ColumnMapping,
  type ListingContext,
  type Profile,
  type RecoveryRates,
} from '../types.ts';
import { getProfile, updateProfile } from '../store/profile.ts';
import { getRecoveryRates, saveRecoveryRates, getSegmentOverride, saveSegmentOverride } from '../store/rates.ts';
import { getSellerMapping, saveSellerMapping } from '../store/mappings.ts';
import {
  createLot,
  getLot,
  listLots,
  deleteLot,
  saveContext,
  setMappingStatus,
  saveRawFile,
  getRawFile,
  setUnmanifested,
  replaceLineItems,
  addLineItem,
  getLineItems,
  getLineItem,
  setComps,
  getComps,
  setCurrentRetail,
} from '../store/lots.ts';
import { recordOutcome, listSegmentOutcomes, getOutcome } from '../store/outcomes.ts';
import { getStage, setStage } from '../store/stages.ts';
import {
  addSale,
  deleteSale,
  listSales,
  addExpense,
  deleteExpense,
  deleteAutoExpenses,
  listExpenses,
  ledgerSummary,
  lotPerformance,
  EXPENSE_CATEGORIES,
  type ExpenseCategory,
} from '../store/ledger.ts';
import {
  addInventoryItem,
  updateInventoryItem,
  deleteInventoryItem,
  getInventoryItem,
  listInventory,
  INVENTORY_STATUSES,
  type InventoryItem,
} from '../store/inventory.ts';
import { addEvent, deleteEvent, listEvents, EVENT_KINDS, type EventKind } from '../store/events.ts';
import {
  addStorageUnit,
  deleteStorageUnit,
  listStorageUnits,
  getStorageUnit,
  addWorkEntry,
  deleteWorkEntry,
  listWorkEntries,
  totalHours,
  getTimer,
  startTimer,
  clearTimer,
} from '../store/workspace.ts';
import Anthropic from '@anthropic-ai/sdk';
import { addLibraryEntry, deleteLibraryEntry, listLibraryEntries } from '../store/library.ts';
import { buildIcs } from './ics.ts';
import { parseManifest } from '../ingest/ingest.ts';
import { proposeMapping, applySavedMapping } from '../ingest/mapping.ts';
import { normalizeRows, normalizeCondition } from '../ingest/normalize.ts';
import { topValueItems } from '../valuation/comps.ts';
import { suggestCalibrations } from '../valuation/calibration.ts';
import { floorPrice, targetPrice } from '../calc/pricing.ts';
import { estimateSetAside, maSalesTax, MA_SALES_TAX_RATE, MA_INCOME_RATE } from '../calc/tax.ts';
import { analyzeLot } from '../analyze.ts';

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function lotOr404(db: Db, id: string) {
  const lot = await getLot(db, Number(id));
  if (!lot) throw new HttpError(404, `No lot ${id}`);
  return lot;
}

function badRequest(err: unknown, fallback: string): never {
  throw new HttpError(400, err instanceof Error ? err.message : fallback);
}

export interface LegacyApi {
  router: Router;
  /** Claude-drafted listing for an inventory item, or null when no API key is configured. */
  aiDraft: ((itemId: number, style: string, instructions?: string) => Promise<string>) | undefined;
}

export function createApi(db: Db): LegacyApi {
  const api = Router();
  api.use(json({ limit: '5mb' }));

  api.get('/profile', async (_req, res) => res.json(await getProfile(db)));
  api.put('/profile', async (req, res) => res.json(await updateProfile(db, req.body as Partial<Profile>)));

  api.get('/rates', async (_req, res) => res.json(await getRecoveryRates(db)));
  api.put('/rates', async (req, res) => res.json(await saveRecoveryRates(db, req.body as Partial<RecoveryRates>)));

  // Manifest upload. The file arrives as a raw body; lot metadata in the query.
  api.post(
    '/lots',
    raw({ type: 'application/octet-stream', limit: '30mb' }),
    async (req, res) => {
      const name = String(req.query.name ?? '').trim();
      const seller = String(req.query.seller ?? '').trim();
      const unmanifested = req.query.unmanifested === 'true';
      if (!name || !seller) throw new HttpError(400, 'name and seller are required');

      const lot = await createLot(db, { name, seller, unmanifested });
      if (unmanifested || !Buffer.isBuffer(req.body) || req.body.length === 0) {
        return res.json({ lot, mapping: null, headers: [], sampleRows: [], itemCount: 0 });
      }

      const filename = String(req.headers['x-filename'] ?? 'manifest');
      let table;
      try {
        table = await parseManifest(filename, req.body);
      } catch (err) {
        await deleteLot(db, lot.id);
        throw new HttpError(422, err instanceof Error ? err.message : 'Could not parse manifest');
      }
      if (table.headers.length === 0 || table.rows.length === 0) {
        await deleteLot(db, lot.id);
        throw new HttpError(422, 'No tabular data found in that file');
      }
      await saveRawFile(db, lot.id, filename, table.headers, table.rows);

      const saved = await getSellerMapping(db, seller);
      const proposal = (saved && applySavedMapping(table.headers, saved)) ?? proposeMapping(table.headers);

      let itemCount = 0;
      if (!proposal.needsConfirmation) {
        const items = normalizeRows(table.headers, table.rows, proposal.mapping);
        await replaceLineItems(db, lot.id, items);
        await setMappingStatus(db, lot.id, 'confirmed');
        await saveSellerMapping(db, seller, proposal.mapping);
        itemCount = items.length;
      }
      res.json({
        lot: await getLot(db, lot.id),
        mapping: proposal,
        headers: table.headers,
        sampleRows: table.rows.slice(0, 5),
        itemCount,
      });
    },
  );

  api.get('/lots', async (_req, res) => {
    const lots = await listLots(db);
    res.json(
      await Promise.all(
        lots.map(async (lot) => ({ ...lot, stage: await getStage(db, lot.id), itemCount: (await getLineItems(db, lot.id)).length })),
      ),
    );
  });

  api.get('/lots/:id', async (req, res) => {
    const lot = await lotOr404(db, req.params.id);
    const rawFile = await getRawFile(db, lot.id);
    const pendingMapping =
      lot.mappingStatus === 'pending' && rawFile
        ? {
            proposal: proposeMapping(rawFile.headers),
            headers: rawFile.headers,
            sampleRows: rawFile.rows.slice(0, 5),
          }
        : null;
    res.json({ lot: { ...lot, stage: await getStage(db, lot.id) }, items: await getLineItems(db, lot.id), pendingMapping, outcome: await getOutcome(db, lot.id) });
  });

  api.delete('/lots/:id', async (req, res) => {
    await lotOr404(db, req.params.id);
    await deleteLot(db, Number(req.params.id));
    res.json({ ok: true });
  });

  // Attach a manifest to an existing lot (e.g. one created unmanifested, or
  // where the file arrives after the lot). Replaces any current line items.
  api.post(
    '/lots/:id/manifest',
    raw({ type: 'application/octet-stream', limit: '30mb' }),
    async (req, res) => {
      const lot = await lotOr404(db, req.params.id);
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        throw new HttpError(400, 'No manifest file received');
      }
      const filename = String(req.headers['x-filename'] ?? 'manifest');
      let table;
      try {
        table = await parseManifest(filename, req.body);
      } catch (err) {
        throw new HttpError(422, err instanceof Error ? err.message : 'Could not parse manifest');
      }
      if (table.headers.length === 0 || table.rows.length === 0) {
        throw new HttpError(422, 'No tabular data found in that file');
      }
      await saveRawFile(db, lot.id, filename, table.headers, table.rows);
      await setUnmanifested(db, lot.id, false);

      const saved = await getSellerMapping(db, lot.seller);
      const proposal = (saved && applySavedMapping(table.headers, saved)) ?? proposeMapping(table.headers);

      let itemCount = 0;
      if (!proposal.needsConfirmation) {
        const items = normalizeRows(table.headers, table.rows, proposal.mapping);
        await replaceLineItems(db, lot.id, items);
        await setMappingStatus(db, lot.id, 'confirmed');
        await saveSellerMapping(db, lot.seller, proposal.mapping);
        itemCount = items.length;
      } else {
        await setMappingStatus(db, lot.id, 'pending');
      }
      res.json({
        lot: await getLot(db, lot.id),
        mapping: proposal,
        headers: table.headers,
        sampleRows: table.rows.slice(0, 5),
        itemCount,
      });
    },
  );

  // Confirm (or re-confirm) a column mapping; remembered for the seller.
  api.post('/lots/:id/mapping', async (req, res) => {
    const lot = await lotOr404(db, req.params.id);
    const mapping = req.body as ColumnMapping;
    const rawFile = await getRawFile(db, lot.id);
    if (!rawFile) throw new HttpError(409, 'This lot has no uploaded manifest to map');
    for (const field of REQUIRED_FIELDS) {
      if (!mapping[field] || !rawFile.headers.includes(mapping[field]!)) {
        throw new HttpError(400, `Mapping for required field "${field}" is missing or not a file column`);
      }
    }
    for (const [field, header] of Object.entries(mapping) as [CanonicalField, string][]) {
      if (header && !rawFile.headers.includes(header)) {
        throw new HttpError(400, `"${header}" (${field}) is not a column of the uploaded file`);
      }
    }
    const items = normalizeRows(rawFile.headers, rawFile.rows, mapping);
    await replaceLineItems(db, lot.id, items);
    await setMappingStatus(db, lot.id, 'confirmed');
    await saveSellerMapping(db, lot.seller, mapping);
    res.json({ lot: await getLot(db, lot.id), itemCount: items.length });
  });

  // Listing context (manual entry — the compliance boundary).
  api.put('/lots/:id/context', async (req, res) => {
    const lot = await lotOr404(db, req.params.id);
    const patch = req.body as Partial<ListingContext>;
    const context: ListingContext = { ...emptyListingContext(), ...lot.context, ...patch };
    if (
      !Number.isFinite(context.buyersPremiumRate) ||
      context.buyersPremiumRate < 0 ||
      context.buyersPremiumRate > 1
    ) {
      throw new HttpError(400, 'buyersPremiumRate must be between 0 and 1');
    }
    await saveContext(db, lot.id, context);
    res.json(await getLot(db, lot.id));
  });

  // Manual line item (unmanifested lots).
  api.post('/lots/:id/items', async (req, res) => {
    const lot = await lotOr404(db, req.params.id);
    const b = req.body as {
      description?: string;
      quantity?: number;
      unitMsrp?: number | null;
      condition?: string;
      category?: string | null;
    };
    if (!b.description?.trim()) throw new HttpError(400, 'description is required');
    const conditionRaw = b.condition ?? '';
    const item = await addLineItem(db, lot.id, {
      description: b.description.trim(),
      identifierType: 'none',
      identifier: null,
      quantity: Number.isFinite(b.quantity) && b.quantity! > 0 ? Math.round(b.quantity!) : 1,
      unitMsrp: Number.isFinite(b.unitMsrp) && b.unitMsrp! >= 0 ? b.unitMsrp! : null,
      conditionRaw,
      conditionGrade: normalizeCondition(conditionRaw),
      category: b.category?.trim() || null,
      unverifiable: true,
    });
    res.json(item);
  });

  // Top-value items for manual comps entry.
  api.get('/lots/:id/top-items', async (req, res) => {
    const lot = await lotOr404(db, req.params.id);
    const n = Number(req.query.n ?? 10);
    const top = topValueItems(await getLineItems(db, lot.id), Number.isFinite(n) && n > 0 ? n : 10);
    res.json(
      await Promise.all(
        top.map(async (item) => ({ item, comps: (await getComps(db, item.id)).map((c) => c.soldPrice) })),
      ),
    );
  });

  api.put('/items/:itemId/comps', async (req, res) => {
    const item = await getLineItem(db, Number(req.params.itemId));
    if (!item) throw new HttpError(404, `No line item ${req.params.itemId}`);
    const body = req.body as { prices?: unknown; currentRetail?: unknown };
    const prices = body.prices;
    if (!Array.isArray(prices) || prices.some((p) => typeof p !== 'number' || !Number.isFinite(p) || p < 0)) {
      throw new HttpError(400, 'prices must be an array of non-negative numbers');
    }
    await setComps(db, item.id, (prices as number[]).map((p) => ({ price: p })));
    if (body.currentRetail !== undefined) {
      if (body.currentRetail !== null && typeof body.currentRetail !== 'number') {
        throw new HttpError(400, 'currentRetail must be a number or null');
      }
      await setCurrentRetail(db, item.id, body.currentRetail);
    }
    res.json({
      itemId: item.id,
      comps: prices,
      currentRetail: (await getLineItem(db, item.id))?.currentRetail ?? null,
    });
  });

  api.get('/lots/:id/analysis', async (req, res) => {
    const lot = await lotOr404(db, req.params.id);
    res.json(await analyzeLot(db, lot.id));
  });

  // Outcome logging, with a prediction snapshot taken at record time. A won
  // outcome also (re)generates auto expense rows: winning bid + premium, and
  // the freight quote when one was entered (estimates never enter the ledger).
  api.post('/lots/:id/outcome', async (req, res) => {
    const lot = await lotOr404(db, req.params.id);
    const b = req.body as { won?: boolean; finalPrice?: number | null; grossRecovered?: number | null };
    if (typeof b.won !== 'boolean') throw new HttpError(400, 'won (boolean) is required');
    const analysis = await analyzeLot(db, lot.id);
    const outcome = await recordOutcome(db, {
      lotId: lot.id,
      won: b.won,
      finalPrice: Number.isFinite(b.finalPrice) ? (b.finalPrice as number) : null,
      grossRecovered: Number.isFinite(b.grossRecovered) ? (b.grossRecovered as number) : null,
      predictedRevenue: analysis.valuation.expectedRevenue.amount,
      predictedMaxBid: analysis.verdict.maxBid?.amount ?? null,
    });

    // Lifecycle: a won lot is waiting to be checked in; a lost one is done.
    // Lots already past "won" (received/selling) keep their stage when the
    // outcome is merely re-saved with a corrected price.
    const currentStage = await getStage(db, lot.id);
    if (!outcome.won) await setStage(db, lot.id, 'closed');
    else if (currentStage === 'analyzing' || currentStage === 'bid_placed' || currentStage === 'closed') await setStage(db, lot.id, 'won');

    await deleteAutoExpenses(db, lot.id);
    if (outcome.won && outcome.finalPrice !== null && outcome.finalPrice > 0) {
      const today = new Date().toISOString().slice(0, 10);
      const premium = lot.context.buyersPremiumRate;
      await addExpense(db, {
        lotId: lot.id,
        amount: Math.round(outcome.finalPrice * (1 + premium) * 100) / 100,
        category: 'lot-purchase',
        note: `auto: winning bid $${outcome.finalPrice} + ${Math.round(premium * 100)}% premium`,
        auto: true,
        spentAt: today,
      });
      if (lot.context.freightQuote !== null && lot.context.freightQuote > 0) {
        await addExpense(db, {
          lotId: lot.id,
          amount: lot.context.freightQuote,
          category: 'freight',
          note: 'auto: freight quote',
          auto: true,
          spentAt: today,
        });
      }
    }
    res.json(outcome);
  });

  // ---- ledger (sales / expenses) ----

  api.get('/ledger', async (_req, res) => {
    const [sales, expenses, summary] = await Promise.all([
      listSales(db),
      listExpenses(db),
      ledgerSummary(db),
    ]);
    res.json({ sales, expenses, summary, categories: EXPENSE_CATEGORIES });
  });

  api.post('/sales', async (req, res) => {
    const b = req.body as { lotId?: number | null; amount?: number; note?: string; soldAt?: string };
    if (typeof b.amount !== 'number' || typeof b.soldAt !== 'string') {
      throw new HttpError(400, 'amount (number) and soldAt (YYYY-MM-DD) are required');
    }
    try {
      res.json(await addSale(db, { lotId: b.lotId ?? null, amount: b.amount, note: b.note ?? null, soldAt: b.soldAt }));
    } catch (err) {
      badRequest(err, 'Invalid sale');
    }
  });

  api.delete('/sales/:id', async (req, res) => {
    await deleteSale(db, Number(req.params.id));
    res.json({ ok: true });
  });

  api.post('/expenses', async (req, res) => {
    const b = req.body as {
      lotId?: number | null; amount?: number; category?: string; note?: string; spentAt?: string;
    };
    if (typeof b.amount !== 'number' || typeof b.spentAt !== 'string' || typeof b.category !== 'string') {
      throw new HttpError(400, 'amount, category, and spentAt (YYYY-MM-DD) are required');
    }
    try {
      res.json(
        await addExpense(db, {
          lotId: b.lotId ?? null,
          amount: b.amount,
          category: b.category as ExpenseCategory,
          note: b.note ?? null,
          spentAt: b.spentAt,
        }),
      );
    } catch (err) {
      badRequest(err, 'Invalid expense');
    }
  });

  api.delete('/expenses/:id', async (req, res) => {
    await deleteExpense(db, Number(req.params.id));
    res.json({ ok: true });
  });

  api.get('/leaderboard', async (req, res) => {
    const n = Number(req.query.n ?? 10);
    res.json(await lotPerformance(db, Number.isFinite(n) && n > 0 ? n : 10));
  });

  api.get('/history', async (_req, res) => {
    res.json({ outcomes: await listSegmentOutcomes(db) });
  });

  api.get('/calibration', async (_req, res) => {
    const outcomes = await listSegmentOutcomes(db);
    // Preload the overrides the suggester will ask about (it calls synchronously).
    const multipliers = new Map<string, number>();
    for (const o of outcomes) {
      const key = `${o.seller.trim().toLowerCase()} ${o.category}`;
      if (!multipliers.has(key)) {
        const override = await getSegmentOverride(db, o.seller.trim().toLowerCase(), o.category);
        multipliers.set(key, override?.multiplier ?? 1);
      }
    }
    res.json(
      suggestCalibrations(outcomes, (seller, category) =>
        multipliers.get(`${seller.trim().toLowerCase()} ${category}`) ?? 1,
      ),
    );
  });

  api.post('/calibration/apply', async (req, res) => {
    const b = req.body as { seller?: string; category?: string; multiplier?: number };
    if (!b.seller || !b.category || !Number.isFinite(b.multiplier)) {
      throw new HttpError(400, 'seller, category, multiplier are required');
    }
    await saveSegmentOverride(db, b.seller.trim().toLowerCase(), b.category, b.multiplier!);
    res.json({ ok: true });
  });

  // ---- inventory ----

  /**
   * Share of current retail an item can realistically ask for, by condition.
   * Drives the condition-based suggested ask (value-based, unlike the
   * cost-based floor/target).
   */
  const CONDITION_FACTORS: Record<string, number> = {
    'like-new': 0.65,
    good: 0.55,
    fair: 0.45,
    poor: 0.3,
  };

  /** Items enriched with pricing bounds computed from the buyer profile. */
  function enrich(item: InventoryItem, profile: Profile) {
    const margin = profile.requiredProfit.kind === 'percent' ? profile.requiredProfit.percent : 0.3;
    const floor = item.cost !== null ? floorPrice(item.cost, profile.sellingFeeRate) : null;
    const target = item.cost !== null ? targetPrice(item.cost, profile.sellingFeeRate, margin) : null;
    // Suggested ask: what the item is worth given its condition — retail × factor,
    // rounded to $5. Falls back to the cost-based target when retail/condition unset.
    const factor = item.condition ? CONDITION_FACTORS[item.condition] : null;
    const ask =
      item.currentRetail !== null && factor !== null
        ? Math.round((item.currentRetail * factor) / 5) * 5
        : null;
    return {
      ...item,
      pricing:
        item.cost === null && ask === null
          ? null
          : {
              floor,
              target,
              ask,
              askBelowFloor: ask !== null && floor !== null && ask < floor,
              conditionFactor: factor,
              ceiling: item.currentRetail,
              feeRate: profile.sellingFeeRate,
              marginRate: margin,
            },
    };
  }

  api.get('/inventory', async (_req, res) => {
    const [items, profile] = await Promise.all([listInventory(db), getProfile(db)]);
    res.json({ items: items.map((i) => enrich(i, profile)), statuses: INVENTORY_STATUSES });
  });

  api.post('/inventory', async (req, res) => {
    const b = req.body as Partial<InventoryItem>;
    if (typeof b.name !== 'string' || !b.name.trim()) throw new HttpError(400, 'name is required');
    try {
      const item = await addInventoryItem(db, b as Parameters<typeof addInventoryItem>[1]);
      res.json(enrich(item, await getProfile(db)));
    } catch (err) {
      badRequest(err, 'Invalid item');
    }
  });

  api.put('/inventory/:id', async (req, res) => {
    if (!(await getInventoryItem(db, Number(req.params.id)))) {
      throw new HttpError(404, `No inventory item ${req.params.id}`);
    }
    try {
      const item = await updateInventoryItem(db, Number(req.params.id), req.body as Partial<InventoryItem>);
      res.json(enrich(item, await getProfile(db)));
    } catch (err) {
      badRequest(err, 'Invalid update');
    }
  });

  api.delete('/inventory/:id', async (req, res) => {
    await deleteInventoryItem(db, Number(req.params.id));
    res.json({ ok: true });
  });

  // ---- calendar events ----

  api.get('/events', async (req, res) => {
    const { from, to } = req.query as { from?: string; to?: string };
    res.json({
      events: from && to ? await listEvents(db, from, to) : await listEvents(db),
      kinds: EVENT_KINDS,
    });
  });

  api.post('/events', async (req, res) => {
    const b = req.body as {
      title?: string; kind?: string; date?: string; time?: string | null;
      contact?: string | null; note?: string | null; inventoryId?: number | null;
    };
    if (!b.title || !b.kind || !b.date) throw new HttpError(400, 'title, kind, and date are required');
    try {
      res.json(
        await addEvent(db, {
          title: b.title,
          kind: b.kind as EventKind,
          date: b.date,
          time: b.time ?? null,
          contact: b.contact ?? null,
          note: b.note ?? null,
          inventoryId: b.inventoryId ?? null,
        }),
      );
    } catch (err) {
      badRequest(err, 'Invalid event');
    }
  });

  api.delete('/events/:id', async (req, res) => {
    await deleteEvent(db, Number(req.params.id));
    res.json({ ok: true });
  });

  // iCalendar feed: import into or subscribe from Google/Apple/Outlook Calendar.
  api.get('/calendar.ics', async (_req, res) => {
    res
      .type('text/calendar; charset=utf-8')
      .setHeader('Content-Disposition', 'inline; filename="manifest-analyzer.ics"')
      .send(buildIcs(await listEvents(db)));
  });

  // ---- storage units & work hours ----

  api.get('/workspace', async (_req, res) => {
    const [units, hours, hoursTotal, summary, timer] = await Promise.all([
      listStorageUnits(db),
      listWorkEntries(db),
      totalHours(db),
      ledgerSummary(db),
      getTimer(db),
    ]);
    res.json({
      units,
      hours,
      totalHours: hoursTotal,
      netProfit: summary.netProfit,
      profitPerHour: hoursTotal > 0 ? Math.round((summary.netProfit / hoursTotal) * 100) / 100 : null,
      timer,
    });
  });

  // ---- work timer (start / stop-confirm / discard) ----

  api.post('/timer/start', async (req, res) => {
    const b = req.body as { note?: string | null; lotId?: number | null };
    try {
      res.json(await startTimer(db, { note: b.note ?? null, lotId: b.lotId ?? null }));
    } catch (err) {
      throw new HttpError(409, err instanceof Error ? err.message : 'Timer already running');
    }
  });

  // Save the confirmed hours (user can correct the number in case they forgot
  // to stop the timer) and clear the timer in one step.
  api.post('/timer/commit', async (req, res) => {
    const b = req.body as { hours?: number; date?: string; note?: string | null; lotId?: number | null };
    if (typeof b.hours !== 'number' || typeof b.date !== 'string') {
      throw new HttpError(400, 'hours (number) and date (YYYY-MM-DD) are required');
    }
    try {
      const entry = await addWorkEntry(db, {
        date: b.date,
        hours: b.hours,
        note: b.note ?? null,
        lotId: b.lotId ?? null,
      });
      await clearTimer(db);
      res.json(entry);
    } catch (err) {
      badRequest(err, 'Invalid hours entry');
    }
  });

  api.post('/timer/discard', async (_req, res) => {
    await clearTimer(db);
    res.json({ ok: true });
  });

  api.post('/storage-units', async (req, res) => {
    const b = req.body as { name?: string; monthlyCost?: number; dueDay?: number; note?: string };
    if (typeof b.name !== 'string' || typeof b.monthlyCost !== 'number' || typeof b.dueDay !== 'number') {
      throw new HttpError(400, 'name, monthlyCost, and dueDay are required');
    }
    try {
      res.json(await addStorageUnit(db, { name: b.name, monthlyCost: b.monthlyCost, dueDay: b.dueDay, note: b.note ?? null }));
    } catch (err) {
      badRequest(err, 'Invalid storage unit');
    }
  });

  api.delete('/storage-units/:id', async (req, res) => {
    await deleteStorageUnit(db, Number(req.params.id));
    res.json({ ok: true });
  });

  // Record this month's rent for a unit as a storage expense in the ledger.
  api.post('/storage-units/:id/pay', async (req, res) => {
    const unit = await getStorageUnit(db, Number(req.params.id));
    if (!unit) throw new HttpError(404, `No storage unit ${req.params.id}`);
    const expense = await addExpense(db, {
      amount: unit.monthlyCost,
      category: 'storage',
      note: `${unit.name} rent`,
      spentAt: new Date().toISOString().slice(0, 10),
    });
    res.json(expense);
  });

  api.post('/hours', async (req, res) => {
    const b = req.body as { date?: string; hours?: number; note?: string; lotId?: number | null };
    if (typeof b.date !== 'string' || typeof b.hours !== 'number') {
      throw new HttpError(400, 'date (YYYY-MM-DD) and hours are required');
    }
    try {
      res.json(await addWorkEntry(db, { date: b.date, hours: b.hours, note: b.note ?? null, lotId: b.lotId ?? null }));
    } catch (err) {
      badRequest(err, 'Invalid hours entry');
    }
  });

  api.delete('/hours/:id', async (req, res) => {
    await deleteWorkEntry(db, Number(req.params.id));
    res.json({ ok: true });
  });

  // ---- description library ----

  api.get('/library', async (_req, res) => {
    res.json({ entries: await listLibraryEntries(db) });
  });

  api.post('/library', async (req, res) => {
    const b = req.body as { title?: string; text?: string };
    if (typeof b.title !== 'string' || typeof b.text !== 'string') {
      throw new HttpError(400, 'title and text are required');
    }
    try {
      res.json(await addLibraryEntry(db, b.title, b.text));
    } catch (err) {
      badRequest(err, 'Invalid library entry');
    }
  });

  api.delete('/library/:id', async (req, res) => {
    await deleteLibraryEntry(db, Number(req.params.id));
    res.json({ ok: true });
  });

  // ---- AI listing drafts (Claude) ----

  const AI_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-fable-5';
  const anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  const LISTING_BASE = `You write resale listings for a small local reseller in Massachusetts who flips liquidation stock (customer returns in good shape — never claim brand new unless the data says so). Given item data as JSON, write one listing that sells. Output only the listing text itself: no preamble, no markdown headers, no commentary.`;

  const LISTING_STYLES: Record<string, string> = {
    casual: `Channel: Facebook Marketplace. Include, in a natural order: an attention-grabbing first line naming the item; price anchoring against the current retail price when provided ("$X retail — yours for $Y"); two to four short lines on the features buyers care about; an honest condition note; logistics (local pickup, delivery available for a small fee, cash / Venmo / Zelle); a closing call to action. Voice: warm, direct, trustworthy local seller — not corporate, not spammy, no ALL CAPS. At most three emoji. 80–160 words.`,
    ebay: `Channel: eBay. First line is the title: at most 80 characters, brand + model + key spec, no filler words, no emoji. Then a blank line, then: condition (be specific about what was tested and any wear), what is included, item specifics as short "Label: value" lines, shipping note (ships within 1 business day, carefully packed). No emoji. 80–160 words after the title.`,
    short: `Channel: OfferUp / Mercari. Two to four short sentences: what it is, condition, price if provided, local pickup or shipped. No emoji, no hashtags.`,
    furniture: `Channel: AptDeco. Include dimensions, materials and brand if known (use [DIMENSIONS] as a placeholder if not), condition with specific wear notes, original retail if provided, and a pickup/delivery line. Calm, descriptive tone. 80–140 words.`,
    plain: `Channel: Craigslist. Plain text only, no links, no emoji. Title line with price, then condition, what is included, and "cash on pickup". Under 100 words.`,
  };

  /** Draft a listing with Claude in the channel's voice. Undefined when no key is configured. */
  const aiDraft = anthropic
    ? async (itemId: number, style: string, instructions?: string): Promise<string> => {
        const item = await getInventoryItem(db, itemId);
        if (!item) throw new HttpError(404, `No inventory item ${itemId}`);
        const profile = await getProfile(db);
        const margin = profile.requiredProfit.kind === 'percent' ? profile.requiredProfit.percent : 0.3;
        const asking = item.cost !== null ? targetPrice(item.cost, profile.sellingFeeRate, margin) : null;
        const response = await anthropic.beta.messages.create({
          model: AI_MODEL,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-06-01'],
          fallbacks: [{ model: 'claude-opus-4-8' }],
          output_config: { effort: 'low' },
          system: `${LISTING_BASE}\n\n${LISTING_STYLES[style] ?? LISTING_STYLES.casual}`,
          messages: [
            {
              role: 'user',
              content: JSON.stringify({
                item: {
                  name: item.name,
                  quantityAvailable: item.qty - item.qtySold,
                  condition: item.condition,
                  kind: item.kind,
                  description: item.description,
                  currentRetailPrice: item.currentRetail,
                  askingPrice: asking,
                },
                sellerNotes: instructions ?? null,
              }),
            },
          ],
        });
        if (response.stop_reason === 'refusal') {
          throw new HttpError(502, 'The model declined this request — use the template draft instead');
        }
        const text = response.content
          .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        if (!text) throw new HttpError(502, 'The model returned no text — try again');
        return text;
      }
    : undefined;

  api.get('/ai-status', (_req, res) => {
    res.json({ enabled: anthropic !== null, model: AI_MODEL });
  });

  api.post('/listings/:itemId/ai', async (req, res) => {
    if (!aiDraft) {
      throw new HttpError(
        409,
        'AI drafting is not set up yet — add an ANTHROPIC_API_KEY to enable it (the template draft still works)',
      );
    }
    const b = (req.body ?? {}) as { instructions?: string; style?: string };
    res.json({ text: await aiDraft(Number(req.params.itemId), b.style ?? 'casual', b.instructions), model: AI_MODEL });
  });

  // ---- MA tax estimate ----

  api.get('/tax-estimate', async (req, res) => {
    const year = String(req.query.year ?? new Date().getFullYear());
    const [sales, expensesList, profile] = await Promise.all([
      listSales(db),
      listExpenses(db),
      getProfile(db),
    ]);
    const revenue = sales.filter((s) => s.soldAt.startsWith(year)).reduce((sum, s) => sum + s.amount, 0);
    const expenses = expensesList.filter((e) => e.spentAt.startsWith(year)).reduce((sum, e) => sum + e.amount, 0);
    const round2 = (n: number): number => Math.round(n * 100) / 100;
    res.json({
      year: Number(year),
      revenue: round2(revenue),
      expenses: round2(expenses),
      netProfit: round2(revenue - expenses),
      federalRate: profile.estimatedFederalRate,
      estimate: estimateSetAside(revenue - expenses, profile.estimatedFederalRate),
      maIncomeRate: MA_INCOME_RATE,
      maSalesTaxRate: MA_SALES_TAX_RATE,
    });
  });

  api.get('/sales-tax', (req, res) => {
    const amount = Number(req.query.amount ?? 0);
    res.json({ amount, owed: maSalesTax(amount), rate: MA_SALES_TAX_RATE });
  });

  // Express 5 propagates async errors automatically; normalize them to JSON.
  api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Internal error' });
  });

  return { router: api, aiDraft };
}
