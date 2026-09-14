import type { Db } from './db.ts';
import { addSale, type Sale } from './ledger.ts';
import { getInventoryItem, updateInventoryItem } from './inventory.ts';
import { getChannel } from './channels.ts';
import { applyDerivedStatus, getListing, listListingsFor, updateListing } from './listings.ts';
import { feeFor } from '../calc/fees.ts';

/**
 * Mark units of an inventory item sold: records the sale with the channel's
 * fee, decrements what's left, closes the listing when the item is gone, and
 * re-derives the item's status.
 */
export async function markSold(
  db: Db,
  input: {
    inventoryId: number;
    amount: number;
    qty?: number;
    soldAt?: string;
    channelId?: number | null;
    listingId?: number | null;
    shipped?: boolean;
    note?: string | null;
  },
): Promise<{ sale: Sale; remaining: number }> {
  const item = await getInventoryItem(db, input.inventoryId);
  if (!item) throw new Error(`No inventory item ${input.inventoryId}`);
  const qty = input.qty ?? 1;
  const remainingBefore = item.qty - item.qtySold;
  if (qty > remainingBefore) throw new Error(`Only ${remainingBefore} unit${remainingBefore === 1 ? '' : 's'} left to sell`);

  let channelId = input.channelId ?? null;
  let shipped = input.shipped ?? false;
  const listing = input.listingId ? await getListing(db, input.listingId) : null;
  if (listing) {
    channelId = channelId ?? listing.channelId;
    shipped = input.shipped ?? listing.shipped;
  }
  const channel = channelId !== null ? await getChannel(db, channelId) : null;
  const fees = channel ? feeFor(input.amount, channel, shipped) : 0;

  const sale = await addSale(db, {
    lotId: item.lotId,
    amount: input.amount,
    fees,
    qty,
    inventoryId: item.id,
    channelId,
    note: input.note ?? `${item.name}${channel ? ` · ${channel.name}` : ''}`,
    soldAt: input.soldAt ?? new Date().toISOString().slice(0, 10),
  });

  const qtySold = item.qtySold + qty;
  await updateInventoryItem(db, item.id, { qtySold });
  const remaining = item.qty - qtySold;
  if (remaining === 0) {
    for (const l of await listListingsFor(db, item.id)) {
      if (l.status === 'active' || l.status === 'draft') {
        await updateListing(db, l.id, { status: l.id === listing?.id ? 'sold' : 'ended' });
      }
    }
    if (listing && listing.status !== 'sold') await updateListing(db, listing.id, { status: 'sold' });
  }
  await applyDerivedStatus(db, item.id);
  return { sale, remaining };
}
