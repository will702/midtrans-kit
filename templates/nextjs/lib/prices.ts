/**
 * SERVER-SIDE price catalog — the single source of truth for amounts.
 *
 * SECURITY RULE: the client sends an item id, never an amount.
 * If the client could name a price, anyone could pay Rp 1 for a Rp 1.000.000 item.
 * Add your products here (or move this to your database later).
 */
export interface PricedItem {
  id: string;
  name: string;
  priceIdr: number;
}

const PRICES: PricedItem[] = [
  { id: "tshirt", name: "Ambis T-shirt", priceIdr: 50000 },
  { id: "sticker-pack", name: "Sticker Pack", priceIdr: 15000 },
  { id: "premium", name: "Premium Membership", priceIdr: 250000 },
];

export function resolvePricedItem(itemId: string): PricedItem | null {
  return PRICES.find((item) => item.id === itemId) ?? null;
}
