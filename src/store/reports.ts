import type { Db } from './db.ts';
import type { Profile } from '../types.ts';
import { listSales, listExpenses, type Sale, type Expense } from './ledger.ts';
import { listPunches, totalHours, hoursByDay, punchHours, localDay, type Punch } from './punches.ts';
import { listAllStageEvents, LOT_STAGES, STAGE_LABELS, type LotStage, type StageEvent } from './stages.ts';
import { listRecurring } from './recurring.ts';
import { listLots } from './lots.ts';
import { listOutcomes } from './outcomes.ts';

/**
 * Money reports: every chart on the Money screen is one of these server-side
 * aggregates. The client only draws. Periods compare against the immediately
 * preceding window of the same length.
 */

export type Period = '30d' | '90d' | 'ytd' | 'all';
export const PERIODS: Period[] = ['30d', '90d', 'ytd', 'all'];

export interface Window {
  /** YYYY-MM-DD inclusive */
  from: string;
  /** YYYY-MM-DD inclusive */
  to: string;
  /** Preceding window of equal length (null for `all`). */
  previous: { from: string; to: string } | null;
}

const DAY_MS = 86_400_000;
const iso = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (date: string, n: number): string => iso(new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS));

export function resolveWindow(period: Period, today: string): Window {
  if (period === 'all') return { from: '0000-01-01', to: today, previous: null };
  if (period === 'ytd') {
    const from = `${today.slice(0, 4)}-01-01`;
    const len = daysBetweenInclusive(from, today);
    return { from, to: today, previous: { from: addDays(from, -len), to: addDays(from, -1) } };
  }
  const len = period === '30d' ? 30 : 90;
  const from = addDays(today, -(len - 1));
  return { from, to: today, previous: { from: addDays(from, -len), to: addDays(from, -1) } };
}

function daysBetweenInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

const inRange = (date: string, from: string, to: string): boolean => date >= from && date <= to;
const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface Scorecard {
  value: number;
  previous: number | null;
  /** Fractional change vs previous (null when previous is 0 or unavailable). */
  delta: number | null;
}

function card(value: number, previous: number | null): Scorecard {
  return {
    value: round2(value),
    previous: previous === null ? null : round2(previous),
    delta: previous === null || previous === 0 ? null : Math.round(((value - previous) / Math.abs(previous)) * 1000) / 1000,
  };
}

export interface MoneySummary {
  period: Period;
  window: Window;
  revenue: Scorecard;
  fees: Scorecard;
  expenses: Scorecard;
  netProfit: Scorecard;
  hours: Scorecard;
  profitPerHour: Scorecard;
  sellThrough: { sold: number; total: number; rate: number | null; avgDaysToSell: number | null };
}

function sumSales(sales: Sale[], from: string, to: string, lotId: number | null): { gross: number; fees: number } {
  let gross = 0;
  let fees = 0;
  for (const s of sales) {
    if (!inRange(s.soldAt, from, to)) continue;
    if (lotId !== null && s.lotId !== lotId) continue;
    gross += s.amount;
    fees += s.fees;
  }
  return { gross, fees };
}

function sumExpenses(expenses: Expense[], from: string, to: string, lotId: number | null): number {
  return expenses.filter((e) => inRange(e.spentAt, from, to) && (lotId === null || e.lotId === lotId)).reduce((s, e) => s + e.amount, 0);
}

function punchesIn(punches: Punch[], from: string, to: string, tz: string, lotId: number | null): Punch[] {
  return punches.filter((p) => inRange(localDay(p.startedAt, tz), from, to) && (lotId === null || p.lotId === lotId));
}

export async function moneySummary(db: Db, profile: Profile, period: Period, today: string, lotId: number | null = null): Promise<MoneySummary> {
  const w = resolveWindow(period, today);
  const [sales, expenses, punches, sold] = await Promise.all([listSales(db), listExpenses(db), listPunches(db), soldThrough(db, w, today)]);
  const tz = profile.timeZone;
  const cur = { s: sumSales(sales, w.from, w.to, lotId), e: sumExpenses(expenses, w.from, w.to, lotId), h: totalHours(punchesIn(punches, w.from, w.to, tz, lotId)) };
  const prev = w.previous
    ? { s: sumSales(sales, w.previous.from, w.previous.to, lotId), e: sumExpenses(expenses, w.previous.from, w.previous.to, lotId), h: totalHours(punchesIn(punches, w.previous.from, w.previous.to, tz, lotId)) }
    : null;
  const net = (x: { s: { gross: number; fees: number }; e: number }) => x.s.gross - x.s.fees - x.e;
  const pph = (x: { s: { gross: number; fees: number }; e: number; h: number }) => (x.h > 0 ? net(x) / x.h : 0);
  return {
    period,
    window: w,
    revenue: card(cur.s.gross, prev ? prev.s.gross : null),
    fees: card(cur.s.fees, prev ? prev.s.fees : null),
    expenses: card(cur.e, prev ? prev.e : null),
    netProfit: card(net(cur), prev ? net(prev) : null),
    hours: card(cur.h, prev ? prev.h : null),
    profitPerHour: card(pph(cur), prev && prev.h > 0 ? pph(prev) : null),
    sellThrough: sold,
  };
}

/** Units sold vs units received in the window, and how long they took. */
async function soldThrough(db: Db, w: Window, today: string) {
  const rows = await db.all<{ qty: number; qty_sold: number; received_at: string | null; created_at: string }>(
    'SELECT qty, qty_sold, received_at, created_at FROM inventory WHERE kind = ?',
    ['unit'],
  );
  let total = 0;
  let sold = 0;
  for (const r of rows) {
    const from = r.received_at ?? r.created_at.slice(0, 10);
    if (!inRange(from, w.from, w.to)) continue;
    total += r.qty;
    sold += Math.min(r.qty, r.qty_sold);
  }
  const sales = await db.all<{ sold_at: string; received_at: string | null; created_at: string; qty: number }>(
    `SELECT s.sold_at, i.received_at, i.created_at, s.qty FROM sales s JOIN inventory i ON i.id = s.inventory_id
     WHERE s.sold_at >= ? AND s.sold_at <= ?`,
    [w.from, w.to],
  );
  let days = 0;
  let n = 0;
  for (const s of sales) {
    const from = s.received_at ?? s.created_at.slice(0, 10);
    days += Math.max(0, daysBetweenInclusive(from, s.sold_at) - 1) * s.qty;
    n += s.qty;
  }
  void today;
  return { sold, total, rate: total > 0 ? Math.round((sold / total) * 1000) / 1000 : null, avgDaysToSell: n > 0 ? Math.round(days / n) : null };
}

// ---- charts ----

export type ReportKind = 'revenue-goal' | 'net' | 'funnel' | 'cycle' | 'hours' | 'storage';
export const REPORT_KINDS: ReportKind[] = ['revenue-goal', 'net', 'funnel', 'cycle', 'hours', 'storage'];

export interface Report {
  kind: ReportKind;
  window: Window;
  headline: string;
  series: { key: string; label: string; value: number; extra?: Record<string, number | string | null> }[];
  meta: Record<string, number | string | null>;
}

function monthsIn(w: Window, today: string): string[] {
  const start = w.from === '0000-01-01' ? null : w.from.slice(0, 7);
  const end = today.slice(0, 7);
  const out: string[] = [];
  let m = start ?? end;
  while (m <= end) {
    out.push(m);
    const [y, mo] = m.split('-').map(Number);
    m = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 7);
  }
  return out;
}

/** "Sep" for the current year, "Sep ’25" otherwise — never something that reads like a day. */
const monthLabel = (m: string): string => {
  const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1));
  const mon = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return m.slice(0, 4) === String(new Date().getUTCFullYear()) ? mon : `${mon} ’${m.slice(2, 4)}`;
};

export async function report(db: Db, profile: Profile, kind: ReportKind, period: Period, today: string, lotId: number | null = null): Promise<Report> {
  const w = resolveWindow(period, today);
  switch (kind) {
    case 'revenue-goal': {
      const sales = await listSales(db);
      let months = monthsIn(w, today);
      if (w.from === '0000-01-01') {
        const first = sales.map((s) => s.soldAt.slice(0, 7)).sort()[0];
        months = first ? monthsIn({ ...w, from: `${first}-01` }, today) : [today.slice(0, 7)];
      }
      const series = months.map((m) => ({
        key: m,
        label: monthLabel(m),
        value: round2(sales.filter((s) => s.soldAt.startsWith(m) && (lotId === null || s.lotId === lotId)).reduce((a, s) => a + s.amount, 0)),
        extra: { goal: profile.monthlyRevenueGoal, toDate: m === today.slice(0, 7) ? 1 : 0 },
      }));
      const cur = series[series.length - 1];
      const goal = profile.monthlyRevenueGoal;
      const daysLeft = daysInMonthOf(today) - Number(today.slice(8, 10));
      const headline = goal
        ? `${monthLabel(cur.key)} is ${Math.round((cur.value / goal) * 100)}% of the $${goal.toLocaleString()} goal with ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`
        : 'Set a monthly revenue goal in Settings to see progress';
      return { kind, window: w, headline, series, meta: { goal } };
    }
    case 'net': {
      const [sales, expenses] = await Promise.all([listSales(db), listExpenses(db)]);
      const months = monthsIn(w.from === '0000-01-01' ? { ...w, from: earliest(sales, expenses) } : w, today);
      const series = months.map((m) => {
        const rev = sales.filter((s) => s.soldAt.startsWith(m) && (lotId === null || s.lotId === lotId));
        const gross = rev.reduce((a, s) => a + s.amount, 0);
        const fees = rev.reduce((a, s) => a + s.fees, 0);
        const exp = expenses.filter((e) => e.spentAt.startsWith(m) && (lotId === null || e.lotId === lotId)).reduce((a, e) => a + e.amount, 0);
        return { key: m, label: monthLabel(m), value: round2(gross - fees - exp), extra: { revenue: round2(gross), fees: round2(fees), expenses: round2(exp) } };
      });
      const total = round2(series.reduce((a, s) => a + s.value, 0));
      return { kind, window: w, headline: `${total >= 0 ? 'Net profit' : 'Net loss'} of $${Math.abs(total).toLocaleString()} over the period`, series, meta: { total } };
    }
    case 'funnel': {
      const events = await listAllStageEvents(db);
      const lots = await listLots(db);
      const created = new Map(lots.map((l) => [l.id, l.createdAt.slice(0, 10)]));
      const inWindow = new Set(lots.filter((l) => inRange(l.createdAt.slice(0, 10), w.from, w.to) && (lotId === null || l.id === lotId)).map((l) => l.id));
      const reached = (stage: LotStage): Set<number> => new Set(events.filter((e) => inWindow.has(e.lotId) && stageIndex(e.stage) >= stageIndex(stage)).map((e) => e.lotId));
      const analyzed = inWindow.size;
      const counts: Record<string, number> = { analyzed };
      for (const s of ['bid_placed', 'won', 'received', 'selling', 'closed'] as LotStage[]) counts[s] = reached(s).size;
      const order: { key: string; label: string }[] = [
        { key: 'analyzed', label: 'Analyzed' },
        { key: 'bid_placed', label: 'Bid placed' },
        { key: 'won', label: 'Won' },
        { key: 'received', label: 'Received' },
        { key: 'selling', label: 'Selling' },
        { key: 'closed', label: 'Closed' },
      ];
      const series = order.map((o, i) => ({
        key: o.key,
        label: o.label,
        value: counts[o.key],
        extra: { fromPrevious: i === 0 ? null : counts[order[i - 1].key] > 0 ? Math.round((counts[o.key] / counts[order[i - 1].key]) * 100) : null },
      }));
      const winRate = analyzed > 0 ? Math.round((counts.won / analyzed) * 100) : null;
      void created;
      return { kind, window: w, headline: winRate === null ? 'No lots analyzed in this period' : `Win rate is ${winRate}% — ${counts.won} of ${analyzed} analyzed lots were won`, series, meta: { winRate } };
    }
    case 'cycle': {
      const events = (await listAllStageEvents(db)).filter((e) => !e.inferred);
      const byLot = new Map<number, StageEvent[]>();
      for (const e of events) byLot.set(e.lotId, [...(byLot.get(e.lotId) ?? []), e]);
      const spans: { key: string; label: string; from: LotStage; to: LotStage }[] = [
        { key: 'won-received', label: 'Won → received', from: 'won', to: 'received' },
        { key: 'received-selling', label: 'Received → selling', from: 'received', to: 'selling' },
        { key: 'selling-closed', label: 'Selling → closed', from: 'selling', to: 'closed' },
      ];
      const series = spans.map((sp) => {
        let days = 0;
        let n = 0;
        for (const [id, evs] of byLot) {
          if (lotId !== null && id !== lotId) continue;
          const a = evs.find((e) => e.stage === sp.from);
          const b = evs.find((e) => e.stage === sp.to);
          if (!a || !b || !inRange(b.at.slice(0, 10), w.from, w.to)) continue;
          days += Math.max(0, (Date.parse(b.at) - Date.parse(a.at)) / DAY_MS);
          n += 1;
        }
        return { key: sp.key, label: sp.label, value: n > 0 ? Math.round(days / n) : 0, extra: { lots: n } };
      });
      const total = series.reduce((a, s) => a + s.value, 0);
      const any = series.some((s) => (s.extra?.lots as number) > 0);
      return { kind, window: w, headline: any ? `Average cycle from won to closed is about ${total} days` : 'No completed stage transitions in this period yet', series, meta: { totalDays: total } };
    }
    case 'hours': {
      const punches = punchesIn(await listPunches(db), w.from, w.to, profile.timeZone, lotId);
      const byDay = hoursByDay(punches, profile.timeZone);
      const days: string[] = [];
      const start = w.from === '0000-01-01' ? (punches.length ? localDay(punches[punches.length - 1].startedAt, profile.timeZone) : today) : w.from;
      for (let d = start; d <= today; d = addDays(d, 1)) days.push(d);
      const series = days.map((d) => ({ key: d, label: d.slice(5), value: byDay.get(d) ?? 0 }));
      const total = round2(punches.reduce((a, p) => a + punchHours(p), 0));
      return { kind, window: w, headline: `${total} hours over ${days.length} days`, series, meta: { total } };
    }
    case 'storage': {
      const [sales, expenses, recurring] = await Promise.all([listSales(db), listExpenses(db), listRecurring(db)]);
      const months = monthsIn(w.from === '0000-01-01' ? { ...w, from: earliest(sales, expenses) } : w, today);
      const series = months.map((m) => ({
        key: m,
        label: monthLabel(m),
        value: round2(expenses.filter((e) => e.spentAt.startsWith(m) && e.category === 'storage').reduce((a, e) => a + e.amount, 0)),
        extra: { revenue: round2(sales.filter((s) => s.soldAt.startsWith(m)).reduce((a, s) => a + s.amount, 0)) },
      }));
      const burn = recurring.filter((r) => r.active && r.category === 'storage').reduce((a, r) => a + r.amount, 0);
      return { kind, window: w, headline: `Storage burn is $${round2(burn)} per month`, series, meta: { burn: round2(burn) } };
    }
  }
}

function stageIndex(s: LotStage): number {
  return LOT_STAGES.indexOf(s);
}

function earliest(sales: Sale[], expenses: Expense[]): string {
  const dates = [...sales.map((s) => s.soldAt), ...expenses.map((e) => e.spentAt)].sort();
  return dates[0] ? `${dates[0].slice(0, 7)}-01` : new Date().toISOString().slice(0, 10);
}

function daysInMonthOf(today: string): number {
  const [y, m] = today.slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export interface ScoreboardRow {
  lotId: number;
  name: string;
  seller: string;
  wonAt: string;
  predictedRevenue: number | null;
  actualRevenue: number;
  cost: number;
  laborHours: number;
  laborCost: number;
  profit: number;
  stage: LotStage;
  stageLabel: string;
  cycleDays: number | null;
}

/** Predicted vs actual per won lot, with labor and cycle time. */
export async function scoreboard(db: Db, profile: Profile, hourlyValue: number): Promise<ScoreboardRow[]> {
  const [lots, outcomes, sales, expenses, punches, events] = await Promise.all([
    listLots(db), listOutcomes(db), listSales(db), listExpenses(db), listPunches(db), listAllStageEvents(db),
  ]);
  const won = outcomes.filter((o) => o.won);
  return won.map((o) => {
    const lot = lots.find((l) => l.id === o.lotId)!;
    const rev = sales.filter((s) => s.lotId === o.lotId);
    const gross = rev.reduce((a, s) => a + s.amount - s.fees, 0);
    const actualRevenue = gross > 0 ? gross : o.grossRecovered ?? 0;
    const cost = expenses.filter((e) => e.lotId === o.lotId).reduce((a, e) => a + e.amount, 0);
    const hours = totalHours(punches.filter((p) => p.lotId === o.lotId));
    const laborCost = round2(hours * hourlyValue);
    const evs = events.filter((e) => e.lotId === o.lotId && !e.inferred);
    const wonAt = evs.find((e) => e.stage === 'won')?.at ?? o.recordedAt;
    const closedAt = evs.find((e) => e.stage === 'closed')?.at ?? null;
    const stage = lot ? ((lot as { stage?: LotStage }).stage ?? 'won') : 'won';
    return {
      lotId: o.lotId,
      name: lot?.name ?? `Lot ${o.lotId}`,
      seller: lot?.seller ?? '',
      wonAt,
      predictedRevenue: o.predictedRevenue,
      actualRevenue: round2(actualRevenue),
      cost: round2(cost),
      laborHours: hours,
      laborCost,
      profit: round2(actualRevenue - cost - laborCost),
      stage,
      stageLabel: STAGE_LABELS[stage],
      cycleDays: closedAt ? Math.round((Date.parse(closedAt) - Date.parse(wonAt)) / DAY_MS) : null,
    };
  });
}

void profileUnused;
function profileUnused(_p: Profile): void {}
