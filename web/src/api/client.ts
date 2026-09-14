/**
 * Thin typed client over the Express API. Every function maps to one route;
 * response shapes are the server's own TypeScript types (imported type-only
 * through the @server alias, so nothing from the server is bundled).
 */
import type { Profile, Lot, LineItem, Analysis, RecoveryRates, ColumnMapping, MappingProposal, ListingContext, Outcome } from '@server/types.ts';
import type { LotStage, StageEvent } from '@server/store/stages.ts';
import type { ReceivingView } from '@server/store/receiving.ts';
import type { Receipt, ReceiptSummary } from '@server/store/receipts.ts';
import type { Family } from '@server/store/partsbook.ts';
import type { Channel } from '@server/store/channels.ts';
import type { Listing } from '@server/store/listings.ts';
import type { InventoryItem } from '@server/store/inventory.ts';
import type { InventoryView, InventorySummary } from '@server/store/inventory-view.ts';
import type { Punch, PunchCategory } from '@server/store/punches.ts';
import type { RecurringExpense, Burn } from '@server/store/recurring.ts';
import type { MoneySummary, Report, ScoreboardRow, Period, ReportKind } from '@server/store/reports.ts';
import type { Sale, Expense, ExpenseCategory, LedgerSummary } from '@server/store/ledger.ts';
import type { CalendarEvent, EventKind } from '@server/store/events.ts';
import type { todayView } from '@server/store/today.ts';
import type { SetAsideEstimate } from '@server/calc/tax.ts';

export type {
  Profile, Lot, LineItem, Analysis, RecoveryRates, ColumnMapping, MappingProposal, ListingContext, Outcome,
  LotStage, StageEvent, ReceivingView, Receipt, ReceiptSummary, Family, Channel, Listing, InventoryItem,
  InventoryView, InventorySummary, Punch, PunchCategory, RecurringExpense, Burn, MoneySummary, Report, ScoreboardRow,
  Period, ReportKind, Sale, Expense, ExpenseCategory, LedgerSummary, CalendarEvent, EventKind, SetAsideEstimate,
};

export type TodayView = Awaited<ReturnType<typeof todayView>>;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(method: string, path: string, body?: unknown, raw?: { data: Blob | ArrayBuffer; filename: string }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: raw
      ? { 'Content-Type': 'application/octet-stream', 'X-Filename': raw.filename }
      : body !== undefined
        ? { 'Content-Type': 'application/json' }
        : undefined,
    body: raw ? raw.data : body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new ApiError(401, 'Not signed in');
  }
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const msg = (json as { error?: string } | null)?.error ?? `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, msg);
  }
  return json as T;
}

const get = <T,>(path: string) => request<T>('GET', path);
const post = <T,>(path: string, body?: unknown) => request<T>('POST', path, body ?? {});
const put = <T,>(path: string, body: unknown) => request<T>('PUT', path, body);
const del = <T,>(path: string) => request<T>('DELETE', path);

// ---- shapes the server builds inline (mirrored here) ----

export interface BoardAnalysis {
  decision: 'BID' | 'PASS';
  maxBid: number | null;
  isEstimate: boolean;
  landedUnitPrice: number | null;
  passReasons: string[];
}
export interface BoardSelling {
  units: number; sold: number; recovered: number; cost: number; net: number; listed: number; canClose: boolean;
}
export interface BoardCard {
  id: number; name: string; seller: string; stage: LotStage; stageLabel: string; units: number; extRetail: number;
  mappingStatus: 'pending' | 'confirmed'; unmanifested: boolean; createdAt: string; context: ListingContext;
  outcome: Outcome | null; analysis: BoardAnalysis | null; landedUnitCost: number | null; landedTotal: number | null;
  checkin: ReceiptSummary | null; selling: BoardSelling | null; daysInStage: number; overdueCheckin: boolean; endsSoon: string | null;
}
export interface BoardColumn {
  stage: LotStage; label: string; count: number; total: { label: string; value: number } | null; lots: BoardCard[];
}
export interface Board { columns: BoardColumn[]; committed: number }

export interface LotListRow extends Lot { stage: LotStage; itemCount: number }
export interface LotDetail {
  lot: Lot & { stage: LotStage };
  items: LineItem[];
  pendingMapping: { proposal: MappingProposal; headers: string[]; sampleRows: string[][] } | null;
  outcome: Outcome | null;
}
export interface UploadResult { lot: Lot; mapping: MappingProposal | null; headers: string[]; sampleRows: string[][]; itemCount: number }
export interface TopItem { item: LineItem; comps: number[] }

export interface ListingView extends Listing { channelName: string; net: number }
export interface InventoryViewResponse {
  items: InventoryView[];
  summary: InventorySummary;
  channels: Channel[];
  settings: { agingWarnDays: number; agingCutDays: number; priceCutFraction: number };
}
export interface TimeCard {
  weekStart: string; weekEnd: string; today: string;
  days: { date: string; hours: number; isToday: boolean }[];
  total: number;
  byCategory: { category: PunchCategory; hours: number; share: number }[];
  punches: (Punch & { hours: number; lotName: string | null })[];
  running: Punch | null;
  profitPerHour: number;
  categories: readonly PunchCategory[];
}
export interface MoneyResponse extends MoneySummary {
  scoreboard: ScoreboardRow[];
  hourlyValue: number;
  tax: { year: number } & SetAsideEstimate;
  burn: Burn;
}
export interface Calibration {
  seller: string; category: string; currentMultiplier: number; suggestedMultiplier: number; sampleSize: number; reason?: string;
}

export const api = {
  // profile / settings
  profile: () => get<Profile>('/profile'),
  updateProfile: (patch: Partial<Profile>) => put<Profile>('/profile', patch),
  rates: () => get<RecoveryRates>('/rates'),
  saveRates: (rates: Partial<RecoveryRates>) => put<RecoveryRates>('/rates', rates),
  feedInfo: () => get<{ feedUrl: string; passwordEnabled: boolean }>('/feed-info'),
  aiStatus: () => get<{ enabled: boolean; model: string }>('/ai-status'),

  // lots
  board: () => get<Board>('/lots/board'),
  lots: () => get<LotListRow[]>('/lots'),
  lot: (id: number) => get<LotDetail>(`/lots/${id}`),
  createLot: (name: string, seller: string, unmanifested: boolean, file?: { data: ArrayBuffer; filename: string }) =>
    request<UploadResult>('POST', `/lots?name=${encodeURIComponent(name)}&seller=${encodeURIComponent(seller)}&unmanifested=${unmanifested}`, undefined, file),
  uploadManifest: (id: number, file: { data: ArrayBuffer; filename: string }) => request<UploadResult>('POST', `/lots/${id}/manifest`, undefined, file),
  deleteLot: (id: number) => del<{ ok: true }>(`/lots/${id}`),
  confirmMapping: (id: number, mapping: ColumnMapping) => post<{ lot: Lot; itemCount: number }>(`/lots/${id}/mapping`, mapping),
  saveContext: (id: number, patch: Partial<ListingContext>) => put<Lot>(`/lots/${id}/context`, patch),
  addItem: (id: number, item: { description: string; quantity: number; unitMsrp: number | null; condition: string; category: string | null }) =>
    post<LineItem>(`/lots/${id}/items`, item),
  topItems: (id: number, n = 10) => get<TopItem[]>(`/lots/${id}/top-items?n=${n}`),
  setComps: (itemId: number, prices: number[], currentRetail?: number | null) => put<{ itemId: number; comps: number[]; currentRetail: number | null }>(`/items/${itemId}/comps`, { prices, currentRetail }),
  analysis: (id: number) => get<Analysis>(`/lots/${id}/analysis`),
  outcome: (id: number, body: { won: boolean; finalPrice: number | null; grossRecovered: number | null }) => post<Outcome>(`/lots/${id}/outcome`, body),
  stage: (id: number) => get<{ stage: LotStage; events: StageEvent[] }>(`/lots/${id}/stage`),
  setStage: (id: number, stage: LotStage) => post<{ stage: LotStage; events: StageEvent[] }>(`/lots/${id}/stage`, { stage }),

  // receiving
  receiving: (id: number) => get<ReceivingView & { lot: Lot & { stage: LotStage }; outcome: Outcome | null }>(`/lots/${id}/receiving`),
  saveReceipt: (lotId: number, lineItemId: number, tally: { received: number; works: number; incomplete: number; weakBattery: number; dead: number; note: string | null }) =>
    put<{ receipt: Receipt; summary: ReceiptSummary }>(`/lots/${lotId}/receipts/${lineItemId}`, tally),
  transfer: (lotId: number) => post<{ created: number; updated: number; removed: number; unitsInInventory: number }>(`/lots/${lotId}/receiving/transfer`),
  finishCheckin: (lotId: number) => post<{ created: number; updated: number; removed: number; unitsInInventory: number; stage: LotStage }>(`/lots/${lotId}/receiving/finish`),
  createParts: (lotId: number) => post<{ created: number }>(`/lots/${lotId}/receiving/parts`),

  // parts book
  families: () => get<{ families: Family[] }>('/parts-book'),
  addFamily: (f: { family: string; keywords: string[]; parts: Family['parts'] }) => post<Family>('/parts-book', f),
  updateFamily: (id: number, patch: Partial<Pick<Family, 'family' | 'keywords' | 'parts' | 'estimated'>>) => put<Family>(`/parts-book/${id}`, patch),
  deleteFamily: (id: number) => del<{ ok: true }>(`/parts-book/${id}`),

  // channels
  channels: () => get<{ channels: Channel[] }>('/channels'),
  addChannel: (c: Partial<Channel> & { name: string }) => post<Channel>('/channels', c),
  updateChannel: (id: number, patch: Partial<Channel>) => put<Channel>(`/channels/${id}`, patch),
  deleteChannel: (id: number) => del<{ ok: true }>(`/channels/${id}`),

  // inventory
  inventory: () => get<InventoryViewResponse>('/inventory/view'),
  addInventory: (item: Partial<InventoryItem> & { name: string }) => post<InventoryItem>('/inventory', item),
  updateInventory: (id: number, patch: Partial<InventoryItem>) => put<InventoryItem>(`/inventory/${id}`, patch),
  deleteInventory: (id: number) => del<{ ok: true }>(`/inventory/${id}`),
  addListing: (itemId: number, body: { channelId: number; ask: number; url?: string | null; shipped?: boolean; status?: 'draft' | 'active' }) => post<Listing>(`/inventory/${itemId}/listings`, body),
  updateListing: (id: number, patch: Partial<Pick<Listing, 'ask' | 'url' | 'shipped' | 'status'>>) => put<Listing>(`/listings/${id}`, patch),
  deleteListing: (id: number) => del<{ ok: true }>(`/listings/${id}`),
  cutPrice: (itemId: number, fraction?: number) => post<{ listings: Listing[] }>(`/inventory/${itemId}/cut`, fraction === undefined ? {} : { fraction }),
  markSold: (itemId: number, body: { amount: number; qty?: number; soldAt?: string; channelId?: number | null; listingId?: number | null; shipped?: boolean; note?: string | null }) =>
    post<{ sale: Sale; remaining: number }>(`/inventory/${itemId}/sold`, body),
  draft: (itemId: number, body: { channelId?: number; ask?: number | null; useAi?: boolean; instructions?: string }) => post<{ text: string; source: 'template' | 'claude' }>(`/inventory/${itemId}/draft`, body),

  // time card
  running: () => get<{ running: (Punch & { hours: number }) | null; categories: readonly PunchCategory[] }>('/punches/running'),
  clockIn: (body: { category?: PunchCategory; lotId?: number | null; note?: string | null }) => post<Punch>('/punches/clock-in', body),
  clockOut: () => post<Punch>('/punches/clock-out'),
  switchTask: (body: { category?: PunchCategory; lotId?: number | null; note?: string | null }) => post<Punch>('/punches/switch', body),
  addPunch: (body: { startedAt: string; endedAt: string; category?: PunchCategory; lotId?: number | null; note?: string | null }) => post<Punch>('/punches', body),
  updatePunch: (id: number, patch: Partial<Pick<Punch, 'startedAt' | 'endedAt' | 'category' | 'lotId' | 'note'>>) => put<Punch>(`/punches/${id}`, patch),
  deletePunch: (id: number) => del<{ ok: true }>(`/punches/${id}`),
  timecard: (date?: string) => get<TimeCard>(`/timecard${date ? `?date=${date}` : ''}`),

  // recurring
  recurring: () => get<{ recurring: RecurringExpense[]; burn: Burn; today: string }>('/recurring'),
  addRecurring: (body: { name: string; amount: number; category?: ExpenseCategory; dueDay: number; note?: string | null }) => post<RecurringExpense>('/recurring', body),
  updateRecurring: (id: number, patch: Partial<Pick<RecurringExpense, 'name' | 'amount' | 'category' | 'dueDay' | 'active' | 'note'>>) => put<RecurringExpense>(`/recurring/${id}`, patch),
  deleteRecurring: (id: number) => del<{ ok: true }>(`/recurring/${id}`),

  // money
  money: (period: Period, lot?: number | null) => get<MoneyResponse>(`/money/summary?period=${period}${lot ? `&lot=${lot}` : ''}`),
  report: (kind: ReportKind, period: Period, lot?: number | null) => get<Report>(`/reports/${kind}?period=${period}${lot ? `&lot=${lot}` : ''}`),
  ledger: () => get<{ sales: Sale[]; expenses: Expense[]; summary: LedgerSummary; categories: readonly ExpenseCategory[] }>('/ledger'),
  addSale: (body: { lotId?: number | null; amount: number; note?: string | null; soldAt: string }) => post<Sale>('/sales', body),
  deleteSale: (id: number) => del<{ ok: true }>(`/sales/${id}`),
  addExpense: (body: { lotId?: number | null; amount: number; category: ExpenseCategory; note?: string | null; spentAt: string }) => post<Expense>('/expenses', body),
  deleteExpense: (id: number) => del<{ ok: true }>(`/expenses/${id}`),
  calibration: () => get<Calibration[]>('/calibration'),
  applyCalibration: (body: { seller: string; category: string; multiplier: number }) => post<{ ok: true }>('/calibration/apply', body),

  // today + events
  today: () => get<TodayView>('/today'),
  events: (from?: string, to?: string) => get<{ events: CalendarEvent[]; kinds: readonly EventKind[] }>(`/events${from && to ? `?from=${from}&to=${to}` : ''}`),
  addEvent: (body: { title: string; kind: EventKind; date: string; time?: string | null; contact?: string | null; note?: string | null; inventoryId?: number | null }) => post<CalendarEvent>('/events', body),
  deleteEvent: (id: number) => del<{ ok: true }>(`/events/${id}`),
};

/** Google Calendar "add event" link (no OAuth, opens a prefilled form). */
export function gcalUrl(e: CalendarEvent): string {
  const d = e.date.replace(/-/g, '');
  const dates = e.time
    ? `${d}T${e.time.replace(':', '')}00/${d}T${String(Number(e.time.slice(0, 2)) + 1).padStart(2, '0')}${e.time.slice(3)}00`
    : `${d}/${d}`;
  const params = new URLSearchParams({ action: 'TEMPLATE', text: `[${e.kind}] ${e.title}`, dates, details: [e.contact, e.note].filter(Boolean).join(' — ') });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
