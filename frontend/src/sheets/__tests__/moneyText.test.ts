import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseAmount, type Currency } from '../currencies';
import { amountProblem, bankRefusal, shortQuestion, cartRefusal, celebrationsFor, BUILT_IN_WHALE } from '../moneyText';
import { registerCustomTemplate, clearCustomTemplates, customTemplate, type CustomRender } from '../customTemplates';

/**
 * What the money windows say in a custom system's currencies, and whether the bank celebrates
 * (3c2b2). The sentences are the approved mockup's (docs/mockups/currency-windows.html).
 */

const GOLD: Currency = {
  id: 'gold', name: 'Gold', decimals: 0, decimalMark: '.', debt: false, negative: false,
  denominations: [{ id: 'gp', name: 'Gold', short: 'gp', value: 100 }, { id: 'sp', name: 'Silver', short: 'sp', value: 10 }, { id: 'cp', name: 'Copper', short: 'cp', value: 1 }],
};
const DOLLARS: Currency = { id: 'dollars', name: 'Dollars', symbol: '$', symbolAfter: false, decimals: 2, decimalMark: '.', debt: true, negative: true, denominations: [] };
const EURO: Currency = { id: 'euro', name: 'Euro', symbol: '€', symbolAfter: true, decimals: 1, decimalMark: ',', debt: false, negative: false, denominations: [] };
const YEN: Currency = { id: 'yen', name: 'Yen', symbol: '¥', symbolAfter: false, decimals: 0, decimalMark: '.', debt: false, negative: false, denominations: [] };

describe('an amount typed into a box', () => {
  const say = (c: Currency, text: string, positive = false) => amountProblem(c, parseAmount(c, text), { positive });

  it('says nothing when it can be used, or when the box is empty', () => {
    expect(say(GOLD, '2 gp 5 sp')).toBeNull();
    expect(say(DOLLARS, '$4.34')).toBeNull();
    expect(say(GOLD, '')).toBeNull();
    expect(say(GOLD, '   ', true)).toBeNull();
    // The GM may set a balance to nothing, or below zero where the currency allows it.
    expect(say(DOLLARS, '0')).toBeNull();
    expect(say(DOLLARS, '-$5.00')).toBeNull();
  });

  it('asks for something above zero where it must be', () => {
    expect(say(DOLLARS, '0', true)).toBe('Write an amount above zero.');
    expect(say(GOLD, '-2 gp', true)).toBe('Write an amount above zero.');
    expect(say(DOLLARS, '0.01', true)).toBeNull();
  });

  it('says why it can\'t be read, in the currency\'s own terms', () => {
    expect(say(GOLD, '15')).toBe('Which coin? Write it like "15 gp" (gp, sp, cp).');
    expect(say(GOLD, '2 pp')).toBe('Gold has no coin by that name. Its coins: gp, sp, cp.');
    expect(say(DOLLARS, '4.345')).toBe('Dollars has only 2 decimal places.');
    expect(say(EURO, '4,34')).toBe('Euro has only 1 decimal place.');
    expect(say(YEN, '¥4.5')).toBe('Yen has no decimal places.');
    expect(say(DOLLARS, 'lots')).toBe('That isn\'t an amount of Dollars.');
  });
});

describe('a refusal from the bank', () => {
  const account = { balance: 2047, debt: 0 };

  it('says why, in the currency it was refused in', () => {
    expect(bankRefusal(GOLD, 'withdraw', 'funds', account)).toBe('Not enough Gold. You have 20 gp 4 sp 7 cp.');
    expect(bankRefusal(GOLD, 'borrow', 'no_debt', account)).toBe('Gold can\'t be borrowed in this game.');
    expect(bankRefusal(GOLD, 'set', 'no_debt', account)).toBe('Nobody can owe Gold in this game.');
    expect(bankRefusal(GOLD, 'set', 'no_negative', account)).toBe('Gold can\'t go below zero in this game.');
    expect(bankRefusal(GOLD, 'withdraw', 'amount', account)).toBe('Write an amount above zero.');
  });

  it('tells nothing owed from nothing to pay with', () => {
    expect(bankRefusal(DOLLARS, 'pay', 'nothing', { balance: 500, debt: 0 })).toBe('You owe no Dollars.');
    expect(bankRefusal(DOLLARS, 'pay', 'nothing', { balance: 0, debt: 500 })).toBe('You have no Dollars to pay with.');
  });

  it('names the app\'s money under a built-in system, and says something for a reason it doesn\'t know', () => {
    expect(bankRefusal(null, 'withdraw', 'funds', account)).toBe('Not enough credits.');
    expect(bankRefusal(null, 'withdraw', 'funds', account, 'eddies')).toBe('Not enough eddies.');
    expect(bankRefusal(GOLD, 'withdraw', 'gremlins', account)).toBe('The bank did nothing.');
  });
});

describe('the cart, short in a currency', () => {
  const short = { currency: GOLD, net: 3000, balance: 2047, short: 953 };

  it('asks how to cover it, in that currency', () => {
    expect(shortQuestion(short)).toBe('The Gold total comes to 30 gp and you have 20 gp 4 sp 7 cp. How do you want to cover the 9 gp 5 sp 3 cp short?');
  });

  it('says why a checkout was refused where the reason names a currency, and leaves the rest to today\'s words', () => {
    expect(cartRefusal('funds', short)).toBe('Not enough Gold: it comes to 30 gp and you have 20 gp 4 sp 7 cp. Gold can\'t be owed or go below zero in this game. Nothing was charged.');
    expect(cartRefusal('total_changed', { currency: DOLLARS, net: 45000, balance: 0, short: 0 }))
      .toBe('Prices changed while this sat in the cart: the Dollars total is now $450.00. Check it, then CHECK OUT again.');
    for (const reason of ['qty', 'price', 'needs_choice', 'no_shops']) expect(cartRefusal(reason, short), reason).toBeNull();
  });
});

describe('whether the bank celebrates', () => {
  const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
  const render = (bank?: CustomRender['bank']): CustomRender => ({ id: HEARTH, name: 'Hearth', words: {}, parts: {}, derived: [], sheet: { sections: [] }, ...(bank ? { bank } : {}) });
  beforeEach(() => clearCustomTemplates());
  afterEach(() => clearCustomTemplates());

  it('does, as today, in every built-in system', () => {
    for (const system of ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic', null, undefined]) {
      expect(celebrationsFor(system), String(system)).toEqual({ on: true, whale: BUILT_IN_WHALE });
    }
    expect(BUILT_IN_WHALE).toBe(10000);
  });

  it('does in a custom system only when its GM turned it on, whale status only with their own threshold', () => {
    registerCustomTemplate(render({ celebrations: true, whale: 50000 }));
    expect(customTemplate(HEARTH)?.bank).toEqual({ celebrations: true, whale: 50000 });
    expect(celebrationsFor(HEARTH)).toEqual({ on: true, whale: 50000 });
    registerCustomTemplate(render({ celebrations: true, whale: null }));
    expect(celebrationsFor(HEARTH)).toEqual({ on: true, whale: null });
    registerCustomTemplate(render({ celebrations: false, whale: null }));
    expect(celebrationsFor(HEARTH)).toEqual({ on: false, whale: null });
  });

  it('doesn\'t in a custom system that says nothing, one not loaded yet, or with a threshold it can\'t use', () => {
    expect(celebrationsFor(HEARTH)).toEqual({ on: false, whale: null });
    registerCustomTemplate(render());
    expect(celebrationsFor(HEARTH)).toEqual({ on: false, whale: null });
    registerCustomTemplate(render({ celebrations: false, whale: 50000 }));
    expect(celebrationsFor(HEARTH)).toEqual({ on: false, whale: null });
    registerCustomTemplate(render({ celebrations: true, whale: 0 }));
    expect(celebrationsFor(HEARTH)).toEqual({ on: true, whale: null });
    // Only true turns them on; the server sends nothing else, and nothing else is trusted.
    registerCustomTemplate(render({ celebrations: 'yes' as unknown as boolean, whale: null }));
    expect(celebrationsFor(HEARTH)).toEqual({ on: false, whale: null });
  });
});
