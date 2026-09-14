import { Router, json } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { Db } from '../store/db.ts';
import type { Profile } from '../types.ts';
import { getProfile } from '../store/profile.ts';
import { getLot, listLots, getLineItems, getLineItem } from '../store/lots.ts';
import { getOutcome } from '../store/outcomes.ts';
import { setStage, getStage, isLotStage, listStageEvents, stageEnteredAt, LOT_STAGES, STAGE_LABELS, type LotStage } from '../store/stages.ts';
import { upsertReceipt, listReceipts, summarizeReceipts } from '../store/receipts.ts';
import { receivingView, transferWorkingUnits, createPartsItems, lotLandedUnitCost } from '../store/receiving.ts';
import { listFamilies, addFamily, updateFamily, deleteFamily } from '../store/partsbook.ts';
import { listChannels, getChannel, addChannel, updateChannel, deleteChannel, type Channel } from '../store/channels.ts';
import { addListing, updateListing, deleteListing, getListing, cutPrice, listListingsFor } from '../store/listings.ts';
import { markSold } from '../store/selling.ts';
import { getInventoryItem, listInventoryForLot } from '../store/inventory.ts';
import { inventoryView } from '../store/inventory-view.ts';
import {
  clockIn, clockOut, switchTask, addManualPunch, updatePunch, deletePunch, getRunningPunch, listPunches,
  hoursByDay, hoursByCategory, totalHours, localDay, punchHours, PUNCH_CATEGORIES,
} from '../store/punches.ts';
import { addRecurring, updateRecurring, deleteRecurring, listRecurring, postDueRecurring, monthlyBurn } from '../store/recurring.ts';
import { moneySummary, report, scoreboard, PERIODS, REPORT_KINDS, type Period, type ReportKind } from '../store/reports.ts';
import { todayView, addDays, startOfWeek } from '../store/today.ts';
import { listSales, listExpenses } from '../store/ledger.ts';
import { listAllListings } from '../store/listings.ts';
import { listInventory } from '../store/inventory.ts';
import { draftListing } from '../reasoning/drafts.ts';
import { analyzeLot } from '../analyze.ts';
import { daysBetween } from '../calc/aging.ts';
import { estimateSetAside } from '../calc/tax.ts';

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const bad = (err: unknown, fallback: string): never => {
  throw new HttpError(400, err instanceof Error ? err.message : fallback);
};

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const today = (profile: Profile): string => localDay(new Date().toISOString(), profile.timeZone);

/**
 * Routes for the lifecycle redesign: board, receiving, salvage, channels,
 * listings, time card, recurring costs, reports, Today, exports. Mounted next
 * to the original API so every old route keeps working unchanged.
 */
export function createLifecycleApi(db: Db, opts: { aiDraft?: (itemId: number, style: string, instructions?: string) => Promise<string> } = {}): Router {
  const api = Router();
  api.use(json({ limit: '2mb' }));

  async function lotOr404(id: string) {
    const lot = await getLot(db, Number(id));
    if (!lot) throw new HttpError(404, `No lot ${id}`);
    return lot;
  }

  // ---- lots: board + stages ----

  api.get('/lots/board', async (_req, res) => {
    const profile = await getProfile(db);
    const t = today(profile);
    const lots = await listLots(db);
    const cards = await Promise.all(
      lots.map(async (lot) => {
        const [stage, items, outcome, entered] = await Promise.all([getStage(db, lot.id), getLineItems(db, lot.id), getOutcome(db, lot.id), stageEnteredAt(db, lot.id)]);
        const units = items.reduce((s, i) => s + i.quantity, 0);
        const extRetail = items.reduce((s, i) => s + i.quantity * (i.unitMsrp ?? 0), 0);
        let analysis = null;
        if (lot.mappingStatus === 'confirmed' && items.length > 0 && (stage === 'analyzing' || stage === 'bid_placed')) {
          try {
            const a = await analyzeLot(db, lot.id);
            analysis = { decision: a.verdict.decision, maxBid: a.verdict.maxBid?.amount ?? null, isEstimate: a.verdict.maxBid?.isEstimate ?? false, landedUnitPrice: a.bid.landedUnitPrice?.amount ?? null, passReasons: a.verdict.passReasons };
          } catch {
            analysis = null;
          }
        }
        const landed = stage === 'won' || stage === 'received' || stage === 'selling' || stage === 'closed' ? await lotLandedUnitCost(db, lot.id) : null;
        let checkin = null;
        if (stage === 'won' || stage === 'received') checkin = summarizeReceipts(items, await listReceipts(db, lot.id));
        let selling = null;
        if (stage === 'selling' || stage === 'closed' || stage === 'received') {
          const inv = await listInventoryForLot(db, lot.id);
          const unitsIn = inv.filter((i) => i.kind === 'unit').reduce((s, i) => s + i.qty, 0);
          const sold = inv.filter((i) => i.kind === 'unit').reduce((s, i) => s + i.qtySold, 0);
          const sales = (await listSales(db)).filter((s) => s.lotId === lot.id);
          const cost = (await listExpenses(db)).filter((e) => e.lotId === lot.id).reduce((s, e) => s + e.amount, 0);
          const recovered = sales.reduce((s, x) => s + x.amount - x.fees, 0);
          selling = { units: unitsIn, sold, recovered: Math.round(recovered * 100) / 100, cost: Math.round(cost * 100) / 100, net: Math.round((recovered - cost) * 100) / 100, listed: inv.filter((i) => i.status === 'listed').length, canClose: unitsIn > 0 && sold >= unitsIn };
        }
        const daysInStage = entered ? daysBetween(entered.slice(0, 10), t) : 0;
        return {
          id: lot.id, name: lot.name, seller: lot.seller, stage, stageLabel: STAGE_LABELS[stage], units, extRetail: Math.round(extRetail * 100) / 100,
          mappingStatus: lot.mappingStatus, unmanifested: lot.unmanifested, createdAt: lot.createdAt, context: lot.context, outcome, analysis, landedUnitCost: landed,
          landedTotal: landed !== null ? Math.round(landed * units * 100) / 100 : null, checkin, selling, daysInStage,
          overdueCheckin: stage === 'won' && daysInStage >= profile.checkinOverdueDays,
          endsSoon: lot.context.endTime !== null && (stage === 'analyzing' || stage === 'bid_placed') ? lot.context.endTime : null,
        };
      }),
    );
    const columns = LOT_STAGES.map((stage) => {
      const inStage = cards.filter((c) => c.stage === stage);
      let total: { label: string; value: number } | null = null;
      if (stage === 'bid_placed') total = { label: 'max bid', value: inStage.reduce((s, c) => s + (c.analysis?.maxBid ?? 0), 0) };
      if (stage === 'won' || stage === 'received') total = { label: 'landed', value: inStage.reduce((s, c) => s + (c.landedTotal ?? 0), 0) };
      if (stage === 'selling') total = { label: 'recovered', value: inStage.reduce((s, c) => s + (c.selling?.recovered ?? 0), 0) };
      if (stage === 'closed') total = { label: 'net', value: inStage.reduce((s, c) => s + (c.selling?.net ?? 0), 0) };
      return { stage, label: STAGE_LABELS[stage], count: inStage.length, total, lots: inStage };
    });
    res.json({ columns, committed: Math.round(cards.reduce((s, c) => s + (c.landedTotal ?? 0), 0) * 100) / 100 });
  });

  api.get('/lots/:id/stage', async (req, res) => {
    const lot = await lotOr404(req.params.id);
    res.json({ stage: await getStage(db, lot.id), events: await listStageEvents(db, lot.id) });
  });

  api.post('/lots/:id/stage', async (req, res) => {
    const lot = await lotOr404(req.params.id);
    const stage = (req.body as { stage?: unknown }).stage;
    if (!isLotStage(stage)) throw new HttpError(400, `stage must be one of ${LOT_STAGES.join(', ')}`);
    await setStage(db, lot.id, stage);
    res.json({ stage, events: await listStageEvents(db, lot.id) });
  });

  // ---- receiving ----

  api.get('/lots/:id/receiving', async (req, res) => {
    const lot = await lotOr404(req.params.id);
    const [view, stage, outcome] = await Promise.all([receivingView(db, lot.id), getStage(db, lot.id), getOutcome(db, lot.id)]);
    res.json({ lot: { ...lot, stage }, outcome, ...view });
  });

  api.put('/lots/:id/receipts/:lineItemId', async (req, res) => {
    const lot = await lotOr404(req.params.id);
    const item = await getLineItem(db, Number(req.params.lineItemId));
    if (!item || item.lotId !== lot.id) throw new HttpError(404, `No manifest line ${req.params.lineItemId} on this lot`);
    const b = req.body as Record<string, unknown>;
    const tally = {
      received: Number(b.received ?? 0), works: Number(b.works ?? 0), incomplete: Number(b.incomplete ?? 0),
      weakBattery: Number(b.weakBattery ?? 0), dead: Number(b.dead ?? 0), note: typeof b.note === 'string' ? b.note : null,
    };
    try {
      const receipt = await upsertReceipt(db, lot.id, item.id, tally, item.description);
      const items = await getLineItems(db, lot.id);
      res.json({ receipt, summary: summarizeReceipts(items, await listReceipts(db, lot.id)) });
    } catch (err) {
      bad(err, 'Invalid tally');
    }
  });

  api.post('/lots/:id/receiving/transfer', async (req, res) => {
    const lot = await lotOr404(req.params.id);
    const profile = await getProfile(db);
    const result = await transferWorkingUnits(db, lot.id, today(profile));
    res.json(result);
  });

  api.post('/lots/:id/receiving/finish', async (req, res) => {
    const lot = await lotOr404(req.params.id);
    const profile = await getProfile(db);
    const result = await transferWorkingUnits(db, lot.id, today(profile));
    await setStage(db, lot.id, 'received');
    res.json({ ...result, stage: 'received' });
  });

  api.post('/lots/:id/receiving/parts', async (req, res) => {
    const lot = await lotOr404(req.params.id);
    const profile = await getProfile(db);
    res.json({ created: await createPartsItems(db, lot.id, today(profile)) });
  });

  // ---- parts book ----

  api.get('/parts-book', async (_req, res) => res.json({ families: await listFamilies(db) }));
  api.post('/parts-book', async (req, res) => {
    try {
      res.json(await addFamily(db, req.body as Parameters<typeof addFamily>[1]));
    } catch (err) {
      bad(err, 'Invalid family');
    }
  });
  api.put('/parts-book/:id', async (req, res) => {
    try {
      res.json(await updateFamily(db, Number(req.params.id), req.body as Parameters<typeof updateFamily>[2]));
    } catch (err) {
      bad(err, 'Invalid family');
    }
  });
  api.delete('/parts-book/:id', async (req, res) => {
    await deleteFamily(db, Number(req.params.id));
    res.json({ ok: true });
  });

  // ---- channels ----

  api.get('/channels', async (_req, res) => res.json({ channels: await listChannels(db) }));
  api.post('/channels', async (req, res) => {
    try {
      res.json(await addChannel(db, req.body as Parameters<typeof addChannel>[1]));
    } catch (err) {
      bad(err, 'Invalid channel');
    }
  });
  api.put('/channels/:id', async (req, res) => {
    try {
      res.json(await updateChannel(db, Number(req.params.id), req.body as Partial<Channel>));
    } catch (err) {
      bad(err, 'Invalid channel');
    }
  });
  api.delete('/channels/:id', async (req, res) => {
    try {
      await deleteChannel(db, Number(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      bad(err, 'Cannot delete channel');
    }
  });

  // ---- inventory view, listings, selling ----

  api.get('/inventory/view', async (_req, res) => {
    const profile = await getProfile(db);
    await postDueRecurring(db, today(profile));
    const view = await inventoryView(db, profile, today(profile));
    res.json({ ...view, channels: await listChannels(db), settings: { agingWarnDays: profile.agingWarnDays, agingCutDays: profile.agingCutDays, priceCutFraction: profile.priceCutFraction } });
  });

  async function itemOr404(id: string) {
    const item = await getInventoryItem(db, Number(id));
    if (!item) throw new HttpError(404, `No inventory item ${id}`);
    return item;
  }

  /**
   * First listing on a received lot's item moves the lot into Selling. A lot
   * still in Won stays there — check-in isn't finished, and Today should keep
   * nagging about it even if a few units are already listed.
   */
  async function bumpLotToSelling(lotId: number | null): Promise<void> {
    if (lotId === null) return;
    if ((await getStage(db, lotId)) === 'received') await setStage(db, lotId, 'selling');
  }

  api.post('/inventory/:id/listings', async (req, res) => {
    const item = await itemOr404(req.params.id);
    const b = req.body as { channelId?: number; ask?: number; url?: string | null; shipped?: boolean; status?: 'draft' | 'active' };
    if (typeof b.channelId !== 'number' || num(b.ask) === undefined) throw new HttpError(400, 'channelId and ask are required');
    const channel = await getChannel(db, b.channelId);
    if (!channel) throw new HttpError(404, `No channel ${b.channelId}`);
    if (!channel.enabled) throw new HttpError(409, `${channel.name} is disabled in Settings`);
    try {
      const listing = await addListing(db, { inventoryId: item.id, channelId: b.channelId, ask: b.ask!, url: b.url ?? null, shipped: b.shipped ?? false, status: b.status ?? 'active' });
      if (listing.status === 'active') await bumpLotToSelling(item.lotId);
      res.json(listing);
    } catch (err) {
      bad(err, 'Invalid listing');
    }
  });

  api.put('/listings/:id', async (req, res) => {
    const existing = await getListing(db, Number(req.params.id));
    if (!existing) throw new HttpError(404, `No listing ${req.params.id}`);
    try {
      const listing = await updateListing(db, existing.id, req.body as Parameters<typeof updateListing>[2]);
      if (listing.status === 'active') await bumpLotToSelling((await getInventoryItem(db, listing.inventoryId))?.lotId ?? null);
      res.json(listing);
    } catch (err) {
      bad(err, 'Invalid listing update');
    }
  });

  api.delete('/listings/:id', async (req, res) => {
    await deleteListing(db, Number(req.params.id));
    res.json({ ok: true });
  });

  api.post('/inventory/:id/cut', async (req, res) => {
    const item = await itemOr404(req.params.id);
    const profile = await getProfile(db);
    const fraction = num((req.body as { fraction?: unknown }).fraction) ?? profile.priceCutFraction;
    try {
      res.json({ listings: await cutPrice(db, item.id, fraction) });
    } catch (err) {
      bad(err, 'Invalid cut');
    }
  });

  api.post('/inventory/:id/sold', async (req, res) => {
    const item = await itemOr404(req.params.id);
    const b = req.body as { amount?: number; qty?: number; soldAt?: string; channelId?: number | null; listingId?: number | null; shipped?: boolean; note?: string | null };
    if (num(b.amount) === undefined || b.amount! <= 0) throw new HttpError(400, 'amount must be a positive number');
    try {
      const result = await markSold(db, { inventoryId: item.id, amount: b.amount!, qty: b.qty, soldAt: b.soldAt, channelId: b.channelId ?? null, listingId: b.listingId ?? null, shipped: b.shipped, note: b.note });
      res.json(result);
    } catch (err) {
      bad(err, 'Could not record sale');
    }
  });

  api.post('/inventory/:id/draft', async (req, res) => {
    const item = await itemOr404(req.params.id);
    const b = req.body as { channelId?: number; ask?: number | null; useAi?: boolean; instructions?: string };
    const channel = b.channelId ? await getChannel(db, b.channelId) : null;
    const style = channel?.draftStyle ?? 'casual';
    const listings = await listListingsFor(db, item.id);
    const ask = num(b.ask) ?? listings.find((l) => l.channelId === channel?.id && l.status === 'active')?.ask ?? null;
    if (b.useAi && opts.aiDraft) {
      try {
        return res.json({ text: await opts.aiDraft(item.id, style, b.instructions), source: 'claude' });
      } catch (err) {
        throw new HttpError(502, err instanceof Error ? err.message : 'Draft failed');
      }
    }
    const profile = await getProfile(db);
    res.json({ text: draftListing({ item, ask, channelName: channel?.name ?? 'listing', style, pickupArea: profile.homeZip }), source: 'template' });
  });

  // ---- time card ----

  api.get('/punches/running', async (_req, res) => {
    const running = await getRunningPunch(db);
    res.json({ running: running ? { ...running, hours: Math.round(punchHours(running) * 100) / 100 } : null, categories: PUNCH_CATEGORIES });
  });

  api.post('/punches/clock-in', async (req, res) => {
    try {
      res.json(await clockIn(db, req.body as Parameters<typeof clockIn>[1]));
    } catch (err) {
      throw new HttpError(409, err instanceof Error ? err.message : 'Cannot clock in');
    }
  });

  api.post('/punches/clock-out', async (_req, res) => {
    try {
      res.json(await clockOut(db));
    } catch (err) {
      throw new HttpError(409, err instanceof Error ? err.message : 'Cannot clock out');
    }
  });

  api.post('/punches/switch', async (req, res) => {
    try {
      res.json(await switchTask(db, req.body as Parameters<typeof switchTask>[1]));
    } catch (err) {
      throw new HttpError(409, err instanceof Error ? err.message : 'Cannot switch');
    }
  });

  api.post('/punches', async (req, res) => {
    try {
      res.json(await addManualPunch(db, req.body as Parameters<typeof addManualPunch>[1]));
    } catch (err) {
      bad(err, 'Invalid punch');
    }
  });

  api.put('/punches/:id', async (req, res) => {
    try {
      res.json(await updatePunch(db, Number(req.params.id), req.body as Parameters<typeof updatePunch>[2]));
    } catch (err) {
      bad(err, 'Invalid punch');
    }
  });

  api.delete('/punches/:id', async (req, res) => {
    await deletePunch(db, Number(req.params.id));
    res.json({ ok: true });
  });

  /** Week grid (Mon–Sun) for the week containing ?date (default today). */
  api.get('/timecard', async (req, res) => {
    const profile = await getProfile(db);
    const tz = profile.timeZone;
    const t = today(profile);
    const anchor = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : t;
    const weekStart = startOfWeek(anchor);
    const weekEnd = addDays(weekStart, 6);
    const all = await listPunches(db);
    const week = all.filter((p) => { const d = localDay(p.startedAt, tz); return d >= weekStart && d <= weekEnd; });
    const byDay = hoursByDay(week, tz);
    const lots = await listLots(db);
    const lotName = new Map(lots.map((l) => [l.id, l.name]));
    const summary = await moneySummary(db, profile, '90d', t);
    res.json({
      weekStart,
      weekEnd,
      today: t,
      days: Array.from({ length: 7 }, (_, i) => { const d = addDays(weekStart, i); return { date: d, hours: byDay.get(d) ?? 0, isToday: d === t }; }),
      total: totalHours(week),
      byCategory: hoursByCategory(week),
      punches: week.map((p) => ({ ...p, hours: Math.round(punchHours(p) * 100) / 100, lotName: p.lotId ? lotName.get(p.lotId) ?? null : null })),
      running: await getRunningPunch(db),
      profitPerHour: summary.profitPerHour.value,
      categories: PUNCH_CATEGORIES,
    });
  });

  // ---- recurring expenses ----

  api.get('/recurring', async (_req, res) => {
    const profile = await getProfile(db);
    await postDueRecurring(db, today(profile));
    res.json({ recurring: await listRecurring(db), burn: await monthlyBurn(db), today: today(profile) });
  });
  api.post('/recurring', async (req, res) => {
    try {
      const r = await addRecurring(db, req.body as Parameters<typeof addRecurring>[1]);
      const profile = await getProfile(db);
      await postDueRecurring(db, today(profile));
      res.json(r);
    } catch (err) {
      bad(err, 'Invalid recurring expense');
    }
  });
  api.put('/recurring/:id', async (req, res) => {
    try {
      res.json(await updateRecurring(db, Number(req.params.id), req.body as Parameters<typeof updateRecurring>[2]));
    } catch (err) {
      bad(err, 'Invalid recurring expense');
    }
  });
  api.delete('/recurring/:id', async (req, res) => {
    await deleteRecurring(db, Number(req.params.id));
    res.json({ ok: true });
  });

  // ---- money ----

  function periodOf(q: unknown): Period {
    return typeof q === 'string' && (PERIODS as string[]).includes(q) ? (q as Period) : '90d';
  }
  function lotOf(q: unknown): number | null {
    const n = Number(q);
    return typeof q === 'string' && q !== '' && Number.isInteger(n) ? n : null;
  }

  api.get('/money/summary', async (req, res) => {
    const profile = await getProfile(db);
    const t = today(profile);
    await postDueRecurring(db, t);
    const summary = await moneySummary(db, profile, periodOf(req.query.period), t, lotOf(req.query.lot));
    // Labor is costed at the configured rate, else trailing profit/hour — never a negative rate.
    const hourly = profile.hourlyValue ?? Math.max(0, summary.profitPerHour.value);
    const year = t.slice(0, 4);
    const [sales, expenses] = await Promise.all([listSales(db), listExpenses(db)]);
    const ytdRev = sales.filter((s) => s.soldAt.startsWith(year)).reduce((a, s) => a + s.amount - s.fees, 0);
    const ytdExp = expenses.filter((e) => e.spentAt.startsWith(year)).reduce((a, e) => a + e.amount, 0);
    res.json({
      ...summary,
      scoreboard: await scoreboard(db, profile, hourly),
      hourlyValue: hourly,
      tax: { year: Number(year), ...estimateSetAside(ytdRev - ytdExp, profile.estimatedFederalRate) },
      burn: await monthlyBurn(db),
    });
  });

  api.get('/reports/:kind', async (req, res) => {
    const kind = req.params.kind;
    if (!(REPORT_KINDS as string[]).includes(kind)) throw new HttpError(404, `Unknown report "${kind}"`);
    const profile = await getProfile(db);
    res.json(await report(db, profile, kind as ReportKind, periodOf(req.query.period), today(profile), lotOf(req.query.lot)));
  });

  // ---- today ----

  api.get('/today', async (_req, res) => {
    const profile = await getProfile(db);
    res.json(await todayView(db, profile));
  });

  // ---- exports ----

  const csv = (rows: Record<string, unknown>[]): string => {
    if (rows.length === 0) return '';
    const cols = Object.keys(rows[0]);
    const cell = (v: unknown): string => {
      const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [cols.join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n';
  };

  api.get('/export/:table.csv', async (req, res) => {
    const table = req.params.table;
    let rows: Record<string, unknown>[];
    switch (table) {
      case 'lots': {
        const lots = await listLots(db);
        rows = await Promise.all(lots.map(async (l) => ({ id: l.id, name: l.name, seller: l.seller, stage: await getStage(db, l.id), createdAt: l.createdAt, currentBid: l.context.currentBid, freightQuote: l.context.freightQuote, buyersPremiumRate: l.context.buyersPremiumRate })));
        break;
      }
      case 'inventory':
        rows = (await listInventory(db)).map((i) => ({ ...i }));
        break;
      case 'listings':
        rows = (await listAllListings(db)).map((l) => ({ ...l }));
        break;
      case 'sales':
        rows = (await listSales(db)).map((s) => ({ ...s }));
        break;
      case 'expenses':
        rows = (await listExpenses(db)).map((e) => ({ ...e }));
        break;
      case 'punches':
        rows = (await listPunches(db)).map((p) => ({ ...p, hours: Math.round(punchHours(p) * 100) / 100 }));
        break;
      default:
        throw new HttpError(404, `No export for "${table}"`);
    }
    res.type('text/csv').setHeader('Content-Disposition', `attachment; filename="${table}.csv"`).send(csv(rows));
  });

  api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = err instanceof HttpError ? err.status : 500;
    res.status(status).json({ error: err instanceof Error ? err.message : 'Internal error' });
  });

  return api;
}

export type { LotStage };
