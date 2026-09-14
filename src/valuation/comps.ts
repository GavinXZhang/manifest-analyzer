import type { LineItem } from '../types.ts';

/**
 * The seam for pricing-comps sources. v1 ships only manual entry (the user
 * looks up sold prices for the top-value items and types them in); an eBay
 * Marketplace Insights client is the planned fast-follow and would implement
 * this same interface. Nothing here may ever fetch from bstock.com.
 */
export interface CompsSource {
  name: string;
  /** Recent sold prices for an item; empty when no comps are available. */
  getSoldPrices(item: LineItem): Promise<number[]>;
}

export class ManualCompsSource implements CompsSource {
  name = 'manual';
  #pricesByItemId: Map<number, number[]>;

  constructor(pricesByItemId: Map<number, number[]>) {
    this.#pricesByItemId = pricesByItemId;
  }

  async getSoldPrices(item: LineItem): Promise<number[]> {
    return this.#pricesByItemId.get(item.id) ?? [];
  }
}

export function median(values: number[]): number {
  if (values.length === 0) throw new Error('median of empty list');
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The top-N items by extended MSRP — the ones worth manually pulling comps
 * for. In a typical lot these carry most of the value.
 */
export function topValueItems(items: LineItem[], n: number): LineItem[] {
  return [...items]
    .sort(
      (a, b) => b.quantity * (b.unitMsrp ?? 0) - a.quantity * (a.unitMsrp ?? 0),
    )
    .slice(0, n);
}
