/**
 * A player's money in each of a custom system's currencies (3c1b). The first, main currency is
 * the bank account every player already has, so a balance already held is that currency's and
 * nothing moves; each further currency keeps its own balance and debt in bank_balances, which
 * starts empty. A currency the system does not have is refused, and a built-in system has none
 * here at all. What a handler may do with these (owe, go below zero) is 3c2a's.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { makeTestDb, get as getRow, run } from './helpers/testDb.js';

const require_ = createRequire(import.meta.url);
const runtime = require_('../systemBuilder/runtime');
const money = require_('../bank/currencies');

const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const OTHER = 'sys_bbbbbbbbbbbbbbbb';
const CURRENCIES = [
  { id: 'gold', name: 'Gold', denominations: [{ id: 'gp', name: 'Gold', value: 100 }, { id: 'cp', name: 'Copper', value: 1 }] },
  { id: 'honor', name: 'Honor' },
  { id: 'dollars', name: 'Dollars', symbol: '$', decimals: 2 },
];

const call = (fn, ...args) => new Promise((resolve, reject) => fn(...args, (err, value) => (err ? reject(err) : resolve(value))));

let db;
beforeEach(async () => {
  db = await makeTestDb();
  const text = JSON.stringify({ format: 1, name: 'Hearth', currencies: CURRENCIES });
  await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [HEARTH, 'Hearth', text, text]);
  await new Promise((resolve) => runtime.load(db, resolve));
});

const accountRow = (username, system) => getRow(db, 'SELECT balance, debt FROM bank_accounts WHERE username = ? AND system = ?', [username, system]);
const balanceRow = (username, system, currency) => getRow(db, 'SELECT balance, debt FROM bank_balances WHERE username = ? AND system = ? AND currency = ?', [username, system, currency]);

describe('the main currency', () => {
  it('is the account a player already has, so a balance already held is in it and nothing moves', async () => {
    await run(db, 'INSERT INTO bank_accounts (username, system, balance, debt) VALUES (?, ?, 12345, 200)', ['GHOST', HEARTH]);
    expect(await call(money.get, db, 'GHOST', HEARTH, 'gold')).toEqual({ balance: 12345, debt: 200 });
    expect(await getRow(db, 'SELECT COUNT(*) AS n FROM bank_balances')).toEqual({ n: 0 });
  });

  it('is written to that account and nowhere else', async () => {
    await call(money.put, db, 'GHOST', HEARTH, 'gold', 500, 0);
    await call(money.addToBalance, db, 'GHOST', HEARTH, 'gold', 250);
    expect(await call(money.adjust, db, 'GHOST', HEARTH, 'gold', { balance: -100, debt: 30 })).toBe(1);
    expect(await accountRow('GHOST', HEARTH)).toEqual({ balance: 650, debt: 30 });
    expect(await getRow(db, 'SELECT COUNT(*) AS n FROM bank_balances')).toEqual({ n: 0 });
  });
});

describe('a further currency', () => {
  it('starts at nothing, and is kept apart from the main account', async () => {
    expect(await call(money.get, db, 'GHOST', HEARTH, 'honor')).toEqual({ balance: 0, debt: 0 });
    await call(money.addToBalance, db, 'GHOST', HEARTH, 'honor', 40);
    await call(money.addToBalance, db, 'GHOST', HEARTH, 'honor', 2);
    expect(await balanceRow('GHOST', HEARTH, 'honor')).toEqual({ balance: 42, debt: 0 });
    expect(await accountRow('GHOST', HEARTH)).toBeUndefined();
  });

  it('is set, set again, and moved by an amount once it is held', async () => {
    await call(money.put, db, 'GHOST', HEARTH, 'dollars', 434, 0);
    expect(await call(money.adjust, db, 'GHOST', HEARTH, 'dollars', { balance: -34, debt: 100 })).toBe(1);
    expect(await call(money.get, db, 'GHOST', HEARTH, 'dollars')).toEqual({ balance: 400, debt: 100 });
    await call(money.put, db, 'GHOST', HEARTH, 'dollars', 50, 0);
    expect(await call(money.get, db, 'GHOST', HEARTH, 'dollars')).toEqual({ balance: 50, debt: 0 });
  });

  it('is told apart from the player\'s other currencies', async () => {
    await call(money.put, db, 'GHOST', HEARTH, 'dollars', 999, 5);
    await call(money.put, db, 'GHOST', HEARTH, 'honor', 7, 0);
    expect(await call(money.get, db, 'GHOST', HEARTH, 'honor')).toEqual({ balance: 7, debt: 0 });
    expect(await call(money.get, db, 'GHOST', HEARTH, 'dollars')).toEqual({ balance: 999, debt: 5 });
  });

  it('is not opened by a move when the player holds none of it, as the main account is not', async () => {
    expect(await call(money.adjust, db, 'GHOST', HEARTH, 'honor', { balance: -5 })).toBe(0);
    expect(await balanceRow('GHOST', HEARTH, 'honor')).toBeUndefined();
    expect(await call(money.adjust, db, 'GHOST', HEARTH, 'gold', { balance: -5 })).toBe(0);
    expect(await accountRow('GHOST', HEARTH)).toBeUndefined();
  });

  it('belongs to its player and its system only', async () => {
    await call(money.put, db, 'GHOST', HEARTH, 'honor', 7, 0);
    expect(await call(money.get, db, 'ROOK', HEARTH, 'honor')).toEqual({ balance: 0, debt: 0 });
    expect(await balanceRow('GHOST', OTHER, 'honor')).toBeUndefined();
  });
});

describe('every currency at once', () => {
  it('comes in the system\'s order, the main one first, with nothing held as zero', async () => {
    await call(money.put, db, 'GHOST', HEARTH, 'gold', 1234, 0);
    await call(money.put, db, 'GHOST', HEARTH, 'dollars', 999, 50);
    expect(await call(money.all, db, 'GHOST', HEARTH)).toEqual([
      { id: 'gold', balance: 1234, debt: 0 },
      { id: 'honor', balance: 0, debt: 0 },
      { id: 'dollars', balance: 999, debt: 50 },
    ]);
  });

  it('is none for a built-in system, which keeps its single account', async () => {
    for (const system of ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic']) {
      expect(await call(money.all, db, 'GHOST', system), system).toEqual([]);
    }
  });
});

describe('a currency the system does not have', () => {
  it('is refused, and nothing is written', async () => {
    for (const fn of [
      () => call(money.get, db, 'GHOST', HEARTH, 'silver'),
      () => call(money.put, db, 'GHOST', HEARTH, 'silver', 5, 0),
      () => call(money.addToBalance, db, 'GHOST', HEARTH, 'silver', 5),
      () => call(money.adjust, db, 'GHOST', HEARTH, 'silver', { balance: 5 }),
      () => call(money.put, db, 'GHOST', 'cyberpunk_red', 'gold', 5, 0),
    ]) await expect(fn()).rejects.toThrow(/has no currency/);
    expect(await getRow(db, 'SELECT COUNT(*) AS n FROM bank_balances')).toEqual({ n: 0 });
    expect(await getRow(db, 'SELECT COUNT(*) AS n FROM bank_accounts')).toEqual({ n: 0 });
  });
});
