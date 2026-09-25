// The shop's cart: what is being bought and sold, and what it all comes to.
//
// Pure, so the arithmetic that decides what a player is charged is tested on its own
// rather than through the window. The server works the same totals out again from its own
// prices when the cart is checked out (backend/shops/checkout.js) and refuses if they
// differ, so this is what the player is SHOWN, never what they are charged by.

import type { ShopStock } from '../data/buildingTypes';
import type { OwnedLine } from '../sheets/ownedItems';
import { readInventory } from '../sheets/inventory';
import { carriedEnc, encLimits } from '../sheets/cwnEncumbrance';

/** One thing being bought, as many times as it is wanted. */
export interface CartBuy {
  /** catalogue/itemId: one line per thing, whatever it is called. */
  key: string;
  catalogue: ShopStock;
  itemId: string;
  label: string;
  price: number;
  qty: number;
  /** What to write onto the sheet for ONE of it, once the checkout is paid. */
  place: () => void;
  /** Encumbrance of one, which arrives Stowed. 0 where the system has none. */
  enc: number;
  /** A numbered sheet slot it needs, which the cart cannot hand out twice. */
  slot?: 'weapon' | 'vehicle';
}

/** One thing being sold. Always one: two of the same are two lines. */
export interface CartSell {
  uid: number;
  line: OwnedLine;
  /** What the shop pays for it. */
  each: number;
  /** Currently in somebody's body. */
  installed: boolean;
}

/** Add one of something, onto its line if it already has one. */
export const addBuy = (cart: CartBuy[], item: Omit<CartBuy, 'qty'>): CartBuy[] => {
  const i = cart.findIndex((l) => l.key === item.key);
  if (i < 0) return [...cart, { ...item, qty: 1 }];
  return cart.map((l, n) => (n === i ? { ...l, qty: l.qty + 1 } : l));
};

/** One more or one fewer; a line that reaches none leaves the cart. */
export const stepBuy = (cart: CartBuy[], key: string, delta: number): CartBuy[] =>
  cart
    .map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l))
    .filter((l) => l.qty > 0);

/** How many of each owned line are already in the cart to be sold. */
export const sellCounts = (sells: CartSell[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const s of sells) out[s.line.key] = (out[s.line.key] ?? 0) + 1;
  return out;
};

/**
 * Money in both directions, and the difference.
 *
 * `net` is positive when the player pays the shop and negative when the shop pays the
 * player - the same sign the cart prints on each line.
 */
export const cartTotals = (buys: CartBuy[], sells: CartSell[]) => {
  const buyTotal = buys.reduce((sum, l) => sum + l.price * l.qty, 0);
  const payout = sells.reduce((sum, s) => sum + s.each, 0);
  return { buyTotal, payout, net: buyTotal - payout };
};

/** The sell half as the server takes it: one entry per thing, with a count. */
export const groupSells = (sells: CartSell[]) => {
  const byKey = new Map<string, { catalogue: string | null; id: string | null; label: string; qty: number }>();
  for (const s of sells) {
    const had = byKey.get(s.line.key);
    if (had) had.qty += 1;
    else byKey.set(s.line.key, { catalogue: s.line.catalogue, id: s.line.id, label: s.line.label, qty: 1 });
  }
  return [...byKey.values()];
};

/** How many of a kind of sheet slot the cart already wants. */
export const slotsWanted = (buys: CartBuy[], slot: 'weapon' | 'vehicle') =>
  buys.reduce((n, l) => n + (l.slot === slot ? l.qty : 0), 0);

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * What the `unit`-th one of an owned line weighs, and where it is carried.
 *
 * The server empties an owned line in the order its places are listed, so the first one
 * sold comes out of the first place, and so on. Stashed, installed and parked things are
 * not being carried, so selling them frees nothing.
 */
export const unitEnc = (
  data: Record<string, unknown>, line: OwnedLine, unit: number,
): { readied: number; stowed: number } => {
  let skip = unit;
  for (const at of line.at) {
    if (skip >= at.qty) { skip -= at.qty; continue; }
    if (at.source === 'weapon' && at.slot !== undefined) {
      const enc = num(data[`weapon${at.slot}_enc`]);
      return String(data[`weapon${at.slot}_carry`] ?? '') === 'readied'
        ? { readied: enc, stowed: 0 } : { readied: 0, stowed: enc };
    }
    if (at.source === 'inventory' && at.index !== undefined) {
      const item = readInventory(data)[at.index];
      const enc = num(item?.enc);
      return item?.carry === 'readied' ? { readied: enc, stowed: 0 } : { readied: 0, stowed: enc };
    }
    return { readied: 0, stowed: 0 };
  }
  return { readied: 0, stowed: 0 };
};

/**
 * What the character would be carrying after checkout, against what they can carry.
 *
 * Bought things arrive Stowed. Sold things leave from wherever they are. Counted the
 * way the sheet's own GEAR line counts (CWN p48), so the two agree.
 */
export const cartCarry = (data: Record<string, unknown>, buys: CartBuy[], sells: CartSell[]) => {
  const now = carriedEnc(data);
  let { readied, stowed } = now;
  stowed += buys.reduce((sum, l) => sum + l.enc * l.qty, 0);
  const seen: Record<string, number> = {};
  for (const s of sells) {
    const n = seen[s.line.key] ?? 0;
    seen[s.line.key] = n + 1;
    const off = unitEnc(data, s.line, n);
    readied -= off.readied;
    stowed -= off.stowed;
  }
  const limits = encLimits(data);
  return {
    readied: Math.max(0, readied),
    stowed: Math.max(0, stowed),
    readiedMax: limits.readied,
    stowedMax: limits.stowed,
    over: readied > limits.readied || stowed > limits.stowed,
  };
};
