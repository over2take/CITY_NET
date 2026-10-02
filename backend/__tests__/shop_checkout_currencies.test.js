/**
 * A checkout in a custom system's currencies (3c2a4a): each catalogue priced in its own
 * currency, every currency the cart touches settled on its own account, all or nothing. A
 * shortfall is covered only as that currency allows: debt with debt on, below zero with
 * negative on, refused with neither (decided with the user, 2026-10-02). The built-in checkout
 * (planCheckout) is untouched; shop_checkout.test.js holds it.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { planCheckoutInCurrencies } = require_('../shops/checkout');

const GOLD = { id: 'gold', name: 'Gold', debt: false, negative: false };
const FAVOR = { id: 'favor', name: 'Favor', debt: true, negative: false };
const SCRIP = { id: 'scrip', name: 'Scrip', debt: false, negative: true };
const CURRENCY = { weapons: GOLD, gear: GOLD, cyberware: FAVOR, armor: SCRIP };
const PRICES = { weapons: { sword: 1500 }, gear: { rope: 20 }, cyberware: { relic: 3 }, armor: { mail: 400 } };

const plan = (over = {}) => planCheckoutInCurrencies({
  buys: [], priceOf: (c, id) => (PRICES[c] && PRICES[c][id] !== undefined ? PRICES[c][id] : null),
  shelved: ['weapons', 'gear', 'cyberware', 'armor'], sale: null, currencyOf: (c) => CURRENCY[c] || null,
  accounts: { gold: { balance: 2000, debt: 0 }, favor: { balance: 5, debt: 0 }, scrip: { balance: 100, debt: 0 } },
  settle: {}, ...over,
});

describe('a cart in one currency', () => {
  it('is paid from that currency\'s account', () => {
    expect(plan({ buys: [{ catalogue: 'weapons', itemId: 'sword', qty: 1 }, { catalogue: 'gear', itemId: 'rope', qty: 2 }] })).toEqual({
      ok: true,
      lines: [
        { catalogue: 'weapons', itemId: 'sword', qty: 1, price: 1500, currency: 'gold' },
        { catalogue: 'gear', itemId: 'rope', qty: 2, price: 20, currency: 'gold' },
      ],
      currencies: { gold: { buyTotal: 1540, payout: 0, net: 1540, balance: 460, debt: 0, settled: 'balance' } },
    });
  });
});

describe('a cart in two currencies', () => {
  it('settles each on its own account', () => {
    const out = plan({ buys: [{ catalogue: 'weapons', itemId: 'sword', qty: 1 }, { catalogue: 'cyberware', itemId: 'relic', qty: 1 }] });
    expect(out.ok).toBe(true);
    expect(out.currencies).toEqual({
      gold: { buyTotal: 1500, payout: 0, net: 1500, balance: 500, debt: 0, settled: 'balance' },
      favor: { buyTotal: 3, payout: 0, net: 3, balance: 2, debt: 0, settled: 'balance' },
    });
  });

  it('goes through for neither when one currency falls short', () => {
    expect(plan({ buys: [{ catalogue: 'cyberware', itemId: 'relic', qty: 1 }, { catalogue: 'weapons', itemId: 'sword', qty: 2 }] }))
      .toMatchObject({ ok: false, reason: 'funds', currency: 'gold', net: 3000 });
  });
});

describe('a shortfall', () => {
  it('is refused in a currency with neither debt nor negative on', () => {
    expect(plan({ buys: [{ catalogue: 'weapons', itemId: 'sword', qty: 2 }], settle: { gold: 'debt' } }))
      .toMatchObject({ ok: false, reason: 'funds', currency: 'gold' });
  });

  it('asks how to cover it, offering only what the currency allows', () => {
    expect(plan({ buys: [{ catalogue: 'cyberware', itemId: 'relic', qty: 3 }] }))
      .toMatchObject({ ok: false, reason: 'needs_choice', currency: 'favor', options: ['debt'] });
    expect(plan({ buys: [{ catalogue: 'cyberware', itemId: 'relic', qty: 3 }], settle: { favor: 'balance' } }))
      .toMatchObject({ ok: false, reason: 'needs_choice', currency: 'favor', options: ['debt'] });
    expect(plan({ buys: [{ catalogue: 'armor', itemId: 'mail', qty: 1 }] }))
      .toMatchObject({ ok: false, reason: 'needs_choice', currency: 'scrip', options: ['balance'] });
  });

  it('is covered by borrowing the rest where debt is on, cash first', () => {
    expect(plan({ buys: [{ catalogue: 'cyberware', itemId: 'relic', qty: 3 }], settle: { favor: 'debt' } }).currencies.favor)
      .toEqual({ buyTotal: 9, payout: 0, net: 9, balance: 0, debt: 4, settled: 'debt' });
  });

  it('is covered by going below zero where negative is on', () => {
    expect(plan({ buys: [{ catalogue: 'armor', itemId: 'mail', qty: 1 }], settle: { scrip: 'balance' } }).currencies.scrip)
      .toEqual({ buyTotal: 400, payout: 0, net: 400, balance: -300, debt: 0, settled: 'balance' });
  });
});

describe('selling back', () => {
  const sale = { ok: true, payout: 0, sold: [{ catalogue: 'weapons', id: 'sword', label: 'Sword', qty: 1, each: 675.6 }, { catalogue: 'cyberware', id: 'relic', label: 'Relic', qty: 2, each: 1.5 }] };

  it('pays each item in its catalogue\'s currency, in whole units', () => {
    const out = plan({ sale });
    expect(out.currencies).toEqual({
      gold: { buyTotal: 0, payout: 675, net: -675, balance: 2675, debt: 0, settled: 'balance' },
      favor: { buyTotal: 0, payout: 3, net: -3, balance: 8, debt: 0, settled: 'balance' },
    });
  });

  it('counts a sale against a purchase in the same currency', () => {
    const out = plan({ sale, buys: [{ catalogue: 'weapons', itemId: 'sword', qty: 1 }] });
    expect(out.currencies.gold).toEqual({ buyTotal: 1500, payout: 675, net: 825, balance: 1175, debt: 0, settled: 'balance' });
  });

  it('leaves debt alone when the shop pays the player', () => {
    const out = plan({ sale, accounts: { gold: { balance: 0, debt: 50 }, favor: { balance: 0, debt: 0 } } });
    expect(out.currencies.gold).toMatchObject({ balance: 675, debt: 50 });
  });
});

describe('what is refused before any money moves', () => {
  it('an empty cart, a bad quantity, a catalogue the shop does not sell, and a price that is not there', () => {
    expect(plan()).toEqual({ ok: false, reason: 'empty' });
    expect(plan({ buys: [{ catalogue: 'gear', itemId: 'rope', qty: 0 }] })).toMatchObject({ ok: false, reason: 'qty' });
    expect(plan({ buys: [{ catalogue: 'gear', itemId: 'rope', qty: 100 }] })).toMatchObject({ ok: false, reason: 'qty' });
    expect(plan({ buys: [{ catalogue: 'vehicles', itemId: 'cart', qty: 1 }] })).toMatchObject({ ok: false, reason: 'not_sold' });
    expect(plan({ buys: [{ catalogue: 'gear', itemId: 'lantern', qty: 1 }] })).toMatchObject({ ok: false, reason: 'price' });
    // A shelf with no currency to price it in sells nothing, rather than for nothing.
    PRICES.vehicles = { cart: 10 };
    try {
      expect(plan({ shelved: ['vehicles'], buys: [{ catalogue: 'vehicles', itemId: 'cart', qty: 1 }] }))
        .toEqual({ ok: false, reason: 'price', catalogue: 'vehicles', itemId: 'cart' });
    } finally {
      delete PRICES.vehicles;
    }
  });

  it('a total the player was not shown, per currency', () => {
    const buys = [{ catalogue: 'gear', itemId: 'rope', qty: 1 }, { catalogue: 'cyberware', itemId: 'relic', qty: 1 }];
    expect(plan({ buys, expectedNet: { gold: 20, favor: 3 } }).ok).toBe(true);
    expect(plan({ buys, expectedNet: { gold: 20, favor: 2 } })).toMatchObject({ ok: false, reason: 'total_changed', currency: 'favor', net: 3 });
  });
});
