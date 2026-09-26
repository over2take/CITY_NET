/**
 * The cart's arithmetic, on its own.
 *
 * What the player is shown before they commit: totals in both directions, one line per
 * thing bought, one per thing sold, and what they would be carrying afterwards. The server
 * works the money out again (backend/shops/checkout.js); this is the half on screen.
 */

import { describe, it, expect } from 'vitest';
import {
  addBuy, stepBuy, sellCounts, cartTotals, groupSells, slotsWanted, unitEnc, cartCarry,
  type CartBuy, type CartSell,
} from '../shopCart';
import type { OwnedLine } from '../../sheets/ownedItems';

const noop = () => {};
const pistol = { key: 'weapons/heavy_pistol', catalogue: 'weapons' as const, itemId: 'heavy_pistol', label: 'Heavy Pistol', price: 200, place: noop, enc: 1, slot: 'weapon' as const };
const kit = { key: 'gear/climbing_kit', catalogue: 'gear' as const, itemId: 'climbing_kit', label: 'Climbing kit', price: 150, place: noop, enc: 2 };

const kitLine: OwnedLine = {
  key: 'gear:climbing_kit', catalogue: 'gear', id: 'climbing_kit', label: 'Climbing kit', unitPrice: 150, qty: 2,
  at: [{ source: 'inventory', qty: 2, index: 0 }],
};
const sell = (uid: number, line: OwnedLine, each: number): CartSell => ({ uid, line, each, installed: false });

describe('buying', () => {
  it('puts the same thing on one line and counts it', () => {
    let cart: CartBuy[] = [];
    cart = addBuy(cart, pistol);
    cart = addBuy(cart, kit);
    cart = addBuy(cart, pistol);
    expect(cart.map((l) => [l.label, l.qty])).toEqual([['Heavy Pistol', 2], ['Climbing kit', 1]]);
  });

  it('steps a line up and down, and drops it at none', () => {
    let cart = addBuy([], pistol);
    cart = stepBuy(cart, pistol.key, 2);
    expect(cart[0].qty).toBe(3);
    cart = stepBuy(cart, pistol.key, -3);
    expect(cart).toEqual([]);
  });

  it('counts the slots the cart already wants', () => {
    const cart = stepBuy(addBuy(addBuy([], pistol), kit), pistol.key, 1);
    expect(slotsWanted(cart, 'weapon')).toBe(2);
    expect(slotsWanted(cart, 'vehicle')).toBe(0);
  });
});

describe('the totals', () => {
  it('are plus for what the player pays and minus for what the shop pays', () => {
    const buys = stepBuy(addBuy([], pistol), pistol.key, 1); // 400
    expect(cartTotals(buys, [])).toEqual({ buyTotal: 400, payout: 0, net: 400 });
    expect(cartTotals([], [sell(1, kitLine, 67), sell(2, kitLine, 67)])).toEqual({ buyTotal: 0, payout: 134, net: -134 });
    expect(cartTotals(buys, [sell(1, kitLine, 67)]).net).toBe(333);
  });
});

describe('selling', () => {
  it('keeps each thing its own line, but sends one entry per kind', () => {
    const sells = [sell(1, kitLine, 67), sell(2, kitLine, 67)];
    expect(sellCounts(sells)).toEqual({ 'gear:climbing_kit': 2 });
    expect(groupSells(sells)).toEqual([{ catalogue: 'gear', id: 'climbing_kit', label: 'Climbing kit', qty: 2 }]);
  });
});

describe('what would be carried', () => {
  const data = {
    str: 10,
    inventory: JSON.stringify([{ name: 'Climbing kit', qty: 2, enc: '2', carry: 'stowed' }]),
    weapon1_name: 'Rifle', weapon1_enc: '2', weapon1_carry: 'readied',
  };

  it('knows where the n-th one of a line comes from', () => {
    const rifle: OwnedLine = { key: 'r', catalogue: 'weapons', id: 'rifle', label: 'Rifle', unitPrice: 1, qty: 1, at: [{ source: 'weapon', qty: 1, slot: 1 }] };
    expect(unitEnc(data, rifle, 0)).toEqual({ readied: 2, stowed: 0 });
    expect(unitEnc(data, kitLine, 1)).toEqual({ readied: 0, stowed: 2 });
    // Past what is owned, nothing.
    expect(unitEnc(data, kitLine, 5)).toEqual({ readied: 0, stowed: 0 });
  });

  it('adds what is bought as Stowed and takes off what is sold', () => {
    expect(cartCarry(data, [], [])).toMatchObject({ readied: 2, stowed: 4, readiedMax: 5, stowedMax: 10, over: false });
    const buys = stepBuy(addBuy([], kit), kit.key, 3); // four kits, 8 Enc
    expect(cartCarry(data, buys, [])).toMatchObject({ stowed: 12, over: true });
    expect(cartCarry(data, buys, [sell(1, kitLine, 67)])).toMatchObject({ stowed: 10, over: false });
  });
});
