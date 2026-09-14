import type { Db } from './db.ts';
import type { Profile } from '../types.ts';
import { listInventory, type InventoryItem } from './inventory.ts';
import { listAllListings, type Listing } from './listings.ts';
import { listChannels, type Channel } from './channels.ts';
import { monthlyBurn } from './recurring.ts';
import { netAfterFees, bestNet } from '../calc/fees.ts';
import { floorPrice, targetPrice } from '../calc/pricing.ts';
import { daysBetween, daysInMonth, carryingRatePerItemDay, accruedCarryingCost, agingLevel, type AgingLevel } from '../calc/aging.ts';

export interface ListingView extends Listing {
  channelName: string;
  net: number;
}

export interface InventoryView extends InventoryItem {
  remaining: number;
  /** 'unlisted' | 'listed' | 'sold' — the derived status in UI terms. */
  state: 'unlisted' | 'listed' | 'sold';
  listings: ListingView[];
  bestNet: { channelName: string; net: number; listingId: number } | null;
  daysOnShelf: number;
  carryingCost: number;
  aging: AgingLevel;
  pricing: { floor: number | null; target: number | null; ceiling: number | null } | null;
}

export interface InventorySummary {
  onHandUnits: number;
  costTiedUp: number;
  listedItems: number;
  avgDaysOnShelf: number;
  carryingRatePerItemDay: number;
  burnMonthly: number;
}

/** Share of current retail a used item can realistically ask for, by condition. */
const CONDITION_FACTORS: Record<string, number> = { 'like-new': 0.65, good: 0.55, fair: 0.45, poor: 0.3 };

export function enrichInventory(
  items: InventoryItem[],
  listings: Listing[],
  channels: Channel[],
  profile: Profile,
  storageMonthly: number,
  today: string,
): { items: InventoryView[]; summary: InventorySummary } {
  const byItem = new Map<number, Listing[]>();
  for (const l of listings) byItem.set(l.inventoryId, [...(byItem.get(l.inventoryId) ?? []), l]);
  const chan = new Map(channels.map((c) => [c.id, c]));
  const margin = profile.requiredProfit.kind === 'percent' ? profile.requiredProfit.percent : 0.3;

  const onHand = items.filter((i) => i.qty - i.qtySold > 0);
  const onHandUnits = onHand.reduce((s, i) => s + (i.qty - i.qtySold), 0);
  const rate = carryingRatePerItemDay(storageMonthly, daysInMonth(today), onHandUnits);

  const views: InventoryView[] = items.map((item) => {
    const remaining = Math.max(0, item.qty - item.qtySold);
    const ls = (byItem.get(item.id) ?? []).map((l) => {
      const c = chan.get(l.channelId);
      return { ...l, channelName: c?.name ?? '?', net: c ? netAfterFees(l.ask, c, l.shipped) : l.ask };
    });
    const active = ls.filter((l) => l.status === 'active');
    const best = bestNet(active.map((l) => ({ source: l, net: l.net })));
    const from = item.receivedAt ?? item.acquiredAt ?? item.createdAt.slice(0, 10);
    const days = remaining > 0 ? daysBetween(from, today) : 0;
    const factor = item.condition ? CONDITION_FACTORS[item.condition] : null;
    const ceiling =
      item.currentRetail !== null && factor !== null ? Math.round((item.currentRetail * factor) / 5) * 5 : item.currentRetail;
    return {
      ...item,
      remaining,
      state: remaining === 0 ? 'sold' : active.length > 0 ? 'listed' : 'unlisted',
      listings: ls,
      bestNet: best ? { channelName: best.source.channelName, net: best.net, listingId: best.source.id } : null,
      daysOnShelf: days,
      carryingCost: accruedCarryingCost(days, rate),
      aging: remaining > 0 ? agingLevel(days, profile.agingWarnDays, profile.agingCutDays) : 'ok',
      pricing:
        item.cost === null && ceiling === null
          ? null
          : {
              floor: item.cost !== null ? floorPrice(item.cost, profile.sellingFeeRate) : null,
              target: item.cost !== null ? targetPrice(item.cost, profile.sellingFeeRate, margin) : null,
              ceiling,
            },
    };
  });

  const onHandViews = views.filter((v) => v.remaining > 0);
  const round2 = (n: number): number => Math.round(n * 100) / 100;
  return {
    items: views,
    summary: {
      onHandUnits,
      costTiedUp: round2(onHandViews.reduce((s, v) => s + (v.cost ?? 0) * v.remaining, 0)),
      listedItems: onHandViews.filter((v) => v.state === 'listed').length,
      avgDaysOnShelf: onHandViews.length ? Math.round(onHandViews.reduce((s, v) => s + v.daysOnShelf, 0) / onHandViews.length) : 0,
      carryingRatePerItemDay: Math.round(rate * 10000) / 10000,
      burnMonthly: storageMonthly,
    },
  };
}

export async function inventoryView(db: Db, profile: Profile, today: string = new Date().toISOString().slice(0, 10)) {
  const [items, listings, channels, burn] = await Promise.all([listInventory(db), listAllListings(db), listChannels(db), monthlyBurn(db)]);
  return enrichInventory(items, listings, channels, profile, burn.storageMonthly, today);
}
