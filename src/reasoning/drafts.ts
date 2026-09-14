import type { InventoryItem } from '../store/inventory.ts';
import type { DraftStyle } from '../store/channels.ts';

/**
 * Template listing drafts, one voice per channel style. These are the
 * no-API-key fallback; the Claude endpoint uses the same inputs.
 */

export interface DraftInput {
  item: InventoryItem;
  ask: number | null;
  channelName: string;
  style: DraftStyle;
  pickupArea?: string | null;
}

const money = (n: number | null): string => (n === null ? '' : `$${Math.round(n)}`);

const conditionLine: Record<string, string> = {
  'like-new': 'Like new — inspected and working, barely any signs of use.',
  good: 'Good used condition — tested and working, light cosmetic wear.',
  fair: 'Fair condition — works, with visible wear; priced accordingly.',
  poor: 'For parts or repair — see notes.',
};

export function draftListing(input: DraftInput): string {
  const { item, ask, style } = input;
  const cond = conditionLine[item.condition ?? 'good'];
  const retail = item.currentRetail !== null ? `Retails for ${money(item.currentRetail)}.` : '';
  const desc = item.description?.trim() ? item.description.trim() : '';
  const parts = item.kind === 'parts' ? 'Sold as a part pulled from a non-working unit.' : '';

  switch (style) {
    case 'ebay': {
      const title = `${item.name}${item.condition === 'like-new' ? ' - Excellent' : ''}`.slice(0, 80);
      return [
        title,
        '',
        `Condition: ${item.condition ?? 'used - good'}`,
        cond,
        parts,
        retail,
        desc,
        '',
        'What you see in the photos is what ships. Tested before listing. Ships within 1 business day, carefully packed.',
        'Questions welcome — happy to send more photos.',
      ].filter(Boolean).join('\n');
    }
    case 'furniture':
      return [
        `${item.name}`,
        '',
        desc || '[dimensions · materials · brand]',
        cond,
        retail,
        ask !== null ? `Asking ${money(ask)}.` : '',
        'Smoke-free home. Pickup or delivery available for a fee within the area.',
      ].filter(Boolean).join('\n');
    case 'short':
      return [`${item.name} — ${cond.split(' — ')[0].toLowerCase()}.`, retail, ask !== null ? `${money(ask)}.` : '', parts].filter(Boolean).join(' ');
    case 'plain':
      return [
        `${item.name}${ask !== null ? ` - ${money(ask)}` : ''}`,
        '',
        cond,
        retail,
        desc,
        'Cash on pickup. No holds without a deposit.',
      ].filter(Boolean).join('\n');
    case 'casual':
    default:
      return [
        `${item.name}${ask !== null ? ` — ${money(ask)}` : ''}`,
        '',
        retail ? `${retail.replace('.', '')} — yours for ${money(ask)}.` : '',
        cond,
        parts,
        desc,
        `Pickup ${input.pickupArea ? `in ${input.pickupArea}` : 'local'}; can deliver nearby for a small fee. Cash, Venmo or Zelle.`,
        'Message me with any questions.',
      ].filter(Boolean).join('\n');
  }
}
