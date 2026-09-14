import type { Db } from './db.ts';
import type { Profile } from '../types.ts';
import { listLots, getLineItems } from './lots.ts';
import { getOutcome } from './outcomes.ts';
import { getStage, stageEnteredAt, type LotStage } from './stages.ts';
import { listReceipts, summarizeReceipts } from './receipts.ts';
import { lotLandedUnitCost } from './receiving.ts';
import { getRunningPunch, listPunches, totalHours, localDay, punchHours } from './punches.ts';
import { listEvents } from './events.ts';
import { listSales } from './ledger.ts';
import { inventoryView } from './inventory-view.ts';
import { moneySummary, resolveWindow } from './reports.ts';
import { postDueRecurring } from './recurring.ts';
import { estimateSetAside } from '../calc/tax.ts';
import { daysBetween } from '../calc/aging.ts';

/** Everything the home screen shows, in one call. */
export async function todayView(db: Db, profile: Profile, now: Date = new Date()) {
  await postDueRecurring(db, now.toISOString().slice(0, 10));
  const tz = profile.timeZone;
  const today = localDay(now.toISOString(), tz);
  const monthStart = `${today.slice(0, 7)}-01`;

  const [running, punches, lots, events, sales, inv, month] = await Promise.all([
    getRunningPunch(db),
    listPunches(db),
    listLots(db),
    listEvents(db, today, addDays(today, 14)),
    listSales(db),
    inventoryView(db, profile, today),
    moneySummary(db, profile, '30d', today),
  ]);

  // Week = Monday..Sunday containing today (local).
  const weekStart = startOfWeek(today);
  const weekPunches = punches.filter((p) => localDay(p.startedAt, tz) >= weekStart && localDay(p.startedAt, tz) <= today);
  const lastWeekPunches = punches.filter((p) => localDay(p.startedAt, tz) >= addDays(weekStart, -7) && localDay(p.startedAt, tz) < weekStart);
  const w = resolveWindow('30d', today);
  void w;

  const checkin = [];
  const bidding = [];
  for (const lot of lots) {
    const stage: LotStage = await getStage(db, lot.id);
    if (stage === 'won') {
      const [items, receipts, landed, entered] = await Promise.all([
        getLineItems(db, lot.id), listReceipts(db, lot.id), lotLandedUnitCost(db, lot.id), stageEnteredAt(db, lot.id),
      ]);
      const summary = summarizeReceipts(items, receipts);
      const daysSinceWon = entered ? daysBetween(entered.slice(0, 10), today) : 0;
      checkin.push({ lot, summary, landedUnitCost: landed, daysSinceWon, overdue: daysSinceWon >= profile.checkinOverdueDays });
    } else if (stage === 'bid_placed' || stage === 'analyzing') {
      if (lot.context.endTime) bidding.push({ lot, stage, endTime: lot.context.endTime });
    }
  }
  checkin.sort((a, b) => b.daysSinceWon - a.daysSinceWon);
  bidding.sort((a, b) => a.endTime.localeCompare(b.endTime));

  const monthSales = sales.filter((s) => s.soldAt >= monthStart && s.soldAt <= today);
  const aging = inv.items.filter((i) => i.remaining > 0 && i.aging !== 'ok').sort((a, b) => b.daysOnShelf - a.daysOnShelf).slice(0, 6);
  const recent = sales.filter((s) => s.soldAt >= addDays(today, -6)).sort((a, b) => b.soldAt.localeCompare(a.soldAt) || b.id - a.id).slice(0, 8);
  const itemNames = new Map(inv.items.map((i) => [i.id, i.name]));
  const round2 = (n: number): number => Math.round(n * 100) / 100;

  const monthNet = month.netProfit.value;
  return {
    today,
    timeCard: {
      running: running ? { ...running, hours: round2(punchHours(running, now)) } : null,
      weekHours: totalHours(weekPunches, now),
      lastWeekHours: totalHours(lastWeekPunches, now),
      profitPerHour: month.profitPerHour.value,
    },
    checkin,
    bidding: bidding.slice(0, 3),
    money: {
      monthRevenue: round2(monthSales.reduce((s, x) => s + x.amount, 0)),
      monthNet,
      revenueDelta: month.revenue.delta,
      costTiedUp: inv.summary.costTiedUp,
      taxSetAside: estimateSetAside(Math.max(0, monthNet), profile.estimatedFederalRate).totalSetAside,
    },
    aging: aging.map((i) => ({
      id: i.id, name: i.name, cost: i.cost, daysOnShelf: i.daysOnShelf, aging: i.aging, carryingCost: i.carryingCost,
      listings: i.listings.filter((l) => l.status === 'active').map((l) => ({ id: l.id, channelName: l.channelName, ask: l.ask })),
      bestAsk: i.listings.find((l) => l.status === 'active')?.ask ?? null,
    })),
    carryingRatePerItemDay: inv.summary.carryingRatePerItemDay,
    events: events.map((e) => ({ ...e, itemName: e.inventoryId ? itemNames.get(e.inventoryId) ?? null : null })),
    recentSales: recent.map((s) => ({ ...s, itemName: s.inventoryId ? itemNames.get(s.inventoryId) ?? null : null })),
    quickSell: inv.items.filter((i) => i.state === 'listed').slice(0, 5).map((i) => ({ id: i.id, name: i.name, bestNet: i.bestNet, remaining: i.remaining })),
  };
}

const DAY_MS = 86_400_000;
export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Monday of the week containing the date. */
export function startOfWeek(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(date, -dow);
}
