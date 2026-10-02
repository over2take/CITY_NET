/**
 * The cart's totals in a custom system's currencies (3c2b2): what the player is shown before they
 * commit, one total per currency the cart touches. The server works the same thing out again when
 * the cart is checked out (backend/shops/checkout.js planCheckoutInCurrencies) and refuses if the
 * two differ, so the two are held to each other here on many generated carts.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { cartTotalsIn, type CartBuy, type CartSell } from '../shopCart';
import type { Currency } from '../../sheets/currencies';
import type { OwnedLine } from '../../sheets/ownedItems';

const server = createRequire(import.meta.url)('../../../../backend/shops/checkout.js');

const coin = (id: string, value: number) => ({ id, name: id, short: id, value });
const GOLD: Currency = { id: 'gold', name: 'Gold', decimals: 0, decimalMark: '.', debt: false, negative: false, denominations: [coin('gp', 100), coin('sp', 10), coin('cp', 1)] };
const FAVOR: Currency = { id: 'favor', name: 'Favor', decimals: 0, decimalMark: '.', debt: true, negative: false, denominations: [] };
const DOLLARS: Currency = { id: 'dollars', name: 'Dollars', symbol: '$', decimals: 2, decimalMark: '.', debt: true, negative: true, denominations: [] };
const MARKS: Currency = { id: 'marks', name: 'Marks', decimals: 0, decimalMark: '.', debt: false, negative: true, denominations: [] };
const CURRENCIES = [GOLD, FAVOR, DOLLARS, MARKS];
const IN: Record<string, Currency> = { weapons: GOLD, weapon_mods: FAVOR, gear: DOLLARS, vehicles: MARKS };
// As sheets/currencies.ts catalogueCurrencyFor answers: the catalogue's own, else the main one.
const currencyOf = (catalogue: string) => IN[catalogue] ?? GOLD;

const noop = () => {};
const buy = (catalogue: string, itemId: string, price: number, qty: number): CartBuy =>
  ({ key: `${catalogue}/${itemId}`, catalogue: catalogue as CartBuy['catalogue'], itemId, label: itemId, price, qty, place: noop, enc: 0 });
const line = (catalogue: string | null, id: string): OwnedLine => ({ key: `${catalogue}:${id}`, catalogue, id, label: id, unitPrice: 0, qty: 1, at: [] });
const sell = (uid: number, catalogue: string | null, id: string, each: number): CartSell => ({ uid, line: line(catalogue, id), each, installed: false });

describe('the totals per currency', () => {
  const accounts = { gold: { balance: 2047, debt: 0 }, favor: { balance: 5, debt: 2 }, dollars: { balance: 1000, debt: 500 } };

  it('give each currency the cart touches its own total, the main one first', () => {
    const totals = cartTotalsIn(
      [buy('weapon_mods', 'rune', 3, 2), buy('weapons', 'sword', 1500, 1)],
      [sell(1, 'weapons', 'dagger', 90)],
      CURRENCIES, currencyOf, accounts,
    );
    expect(totals.map((t) => t.currency.id)).toEqual(['gold', 'favor']);
    expect(totals[0]).toMatchObject({ buyTotal: 1500, payout: 90, net: 1410, balance: 2047, debt: 0, after: 637, short: 0, options: [] });
    expect(totals[1]).toMatchObject({ buyTotal: 6, payout: 0, net: 6, balance: 5, debt: 2, after: -1, short: 1, options: ['debt'] });
  });

  it('offer only what a short currency allows, in the server\'s order, and nothing where it allows nothing', () => {
    const short = (catalogue: string) => cartTotalsIn([buy(catalogue, 'x', 999999, 1)], [], CURRENCIES, currencyOf, {})[0];
    expect(short('weapons').options).toEqual([]);
    expect(short('weapon_mods').options).toEqual(['debt']);
    expect(short('vehicles').options).toEqual(['balance']);
    expect(short('gear').options).toEqual(['balance', 'debt']);
  });

  it('count a shortfall from a balance already below zero, as the cart always has', () => {
    const [t] = cartTotalsIn([buy('gear', 'rope', 434, 1)], [], CURRENCIES, currencyOf, { dollars: { balance: -100, debt: 0 } });
    expect(t).toMatchObject({ net: 434, after: -534, short: 534 });
  });

  it('never call a sale short, even to a balance below zero', () => {
    const [t] = cartTotalsIn([], [sell(1, 'gear', 'lamp', 125)], CURRENCIES, currencyOf, { dollars: { balance: -500, debt: 0 } });
    expect(t).toMatchObject({ net: -125, after: -375, short: 0, options: [] });
  });

  it('pay a sale into the currency of the catalogue it came from, and the main one for a thing from none', () => {
    const totals = cartTotalsIn([], [sell(1, 'gear', 'lamp', 125), sell(2, null, 'oddity', 7)], CURRENCIES, currencyOf, {});
    expect(totals.map((t) => [t.currency.id, t.net])).toEqual([['gold', -7], ['dollars', -125]]);
  });

  it('are none for an empty cart, and leave out a catalogue with no currency', () => {
    expect(cartTotalsIn([], [], CURRENCIES, currencyOf, {})).toEqual([]);
    expect(cartTotalsIn([buy('weapons', 'sword', 1500, 1)], [], CURRENCIES, () => null, {})).toEqual([]);
  });
});

describe('against the server\'s checkout', () => {
  // A seeded generator, so a failure names a cart that can be rebuilt.
  const rng = (seed: number) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  const CATALOGUES = ['weapons', 'weapon_mods', 'gear', 'vehicles'];

  it('agrees on every total, every shortfall and how each may be covered, on 2,000 carts', () => {
    const r = rng(20261002);
    const pick = <T>(list: T[]) => list[Math.floor(r() * list.length)];
    for (let n = 0; n < 2000; n += 1) {
      const buys: CartBuy[] = [];
      for (let i = 0; i < Math.floor(r() * 4); i += 1) buys.push(buy(pick(CATALOGUES), `item${i}`, Math.floor(r() * 3000), 1 + Math.floor(r() * 3)));
      const sells: CartSell[] = [];
      for (let i = 0; i < Math.floor(r() * 3); i += 1) sells.push(sell(i, pick(CATALOGUES), `old${i}`, Math.floor(r() * 2000)));
      const accounts = Object.fromEntries(CURRENCIES.map((c) => [c.id, { balance: Math.floor(r() * 6000) - 1000, debt: Math.floor(r() * 500) }]));
      const totals = cartTotalsIn(buys, sells, CURRENCIES, currencyOf, accounts);
      const at = `cart ${n}`;

      const plan = (settle: Record<string, string>) => server.planCheckoutInCurrencies({
        buys: buys.map((b) => ({ catalogue: b.catalogue, itemId: b.itemId, qty: b.qty })),
        priceOf: (catalogue: string, itemId: string) => buys.find((b) => b.catalogue === catalogue && b.itemId === itemId)!.price,
        shelved: CATALOGUES,
        sale: { sold: sells.map((s) => ({ catalogue: s.line.catalogue, each: s.each, qty: 1 })) },
        currencyOf, accounts, settle,
        expectedNet: Object.fromEntries(totals.map((t) => [t.currency.id, t.net])),
      });

      if (!totals.length) { expect(plan({}), at).toMatchObject({ ok: false, reason: 'empty' }); continue; }
      // Each short currency covered the first way it allows: refused only where one allows none.
      const settle = Object.fromEntries(totals.filter((t) => t.options.length).map((t) => [t.currency.id, t.options[0]]));
      const settled = plan(settle);
      const refused = totals.find((t) => t.short && !t.options.length);
      if (refused) {
        expect(settled.ok, at).toBe(false);
        expect(['funds'], at).toContain(settled.reason);
        expect(totals.find((t) => t.currency.id === settled.currency)?.options, at).toEqual([]);
        continue;
      }
      expect(settled.ok, `${at}: ${settled.reason} ${settled.currency}`).toBe(true);
      for (const t of totals) {
        const s = settled.currencies[t.currency.id];
        expect([s.buyTotal, s.payout, s.net], `${at} ${t.currency.id}`).toEqual([t.buyTotal, t.payout, t.net]);
        // Where nothing was short, the balance after is the one the cart showed.
        if (!t.short) expect(s.balance, `${at} ${t.currency.id}`).toBe(t.after);
      }
      expect(Object.keys(settled.currencies).sort(), at).toEqual(totals.map((t) => t.currency.id).sort());

      // Unsettled, the server asks about a short currency in exactly the ways the cart offers.
      const asked = plan({});
      if (totals.some((t) => t.short)) {
        expect(asked.reason, at).toBe('needs_choice');
        expect(asked.options, at).toEqual(totals.find((t) => t.currency.id === asked.currency)?.options);
      } else expect(asked.ok, at).toBe(true);
    }
  });
});
