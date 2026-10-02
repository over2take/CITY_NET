/**
 * The bank handlers in a custom system's currencies (3c2a3). Each acts on the currency the
 * message names, or the main one, and on that currency's switches (bank/moneyRules.js): no
 * borrowing without debt on, no going below zero without negative on, the GM's edit held to the
 * same; a refusal is told to the player. A currency the system lacks moves nothing. A built-in
 * system, and a custom one with no currencies of its own, keep today's bank, which
 * bank_own_account.test.js pins.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';
const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');

const require_ = createRequire(import.meta.url);
const runtime = require_('../systemBuilder/runtime');
const money = require_('../bank/currencies');
const socketsFactory = (await import('../sockets/index.js')).default;

const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const PLAIN = 'sys_bbbbbbbbbbbbbbbb';
const CURRENCIES = [
  { id: 'gold', name: 'Gold', debt: true, denominations: [{ id: 'gp', name: 'Gold', value: 100 }, { id: 'cp', name: 'Copper', value: 1 }] },
  { id: 'favor', name: 'Favor' },
  { id: 'dollars', name: 'Dollars', symbol: '$', decimals: 2, negative: true },
];

const call = (fn, ...args) => new Promise((resolve, reject) => fn(...args, (err, value) => (err ? reject(err) : resolve(value))));

let db;
let nextSocket = 0;
const running = async (system) => {
  await run(db, `INSERT OR REPLACE INTO global_settings (key, value) VALUES ('game_system', ?)`, [system]);
  const sent = [];
  let connect;
  socketsFactory({ on: (e, cb) => { if (e === 'connection') connect = cb; }, emit: (event, data) => sent.push({ event, data }), to: () => ({ emit: () => {} }) },
    db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
  const handlers = {};
  connect({ id: `cur-sock-${(nextSocket += 1)}`, on: (e, fn) => { handlers[e] = fn; }, emit: (event, data) => sent.push({ event, data, direct: true }),
    broadcast: { emit: () => {} }, use: () => {}, join: () => {} });
  handlers.identify('GHOST');
  await drain(db);
  sent.length = 0;
  return { handlers, sent };
};
const balance = (currency) => call(money.get, db, 'GHOST', HEARTH, currency);
const refusals = (sent) => sent.filter((e) => e.event === 'bankRefused').map((e) => e.data);

beforeEach(async () => {
  db = await makeTestDb();
  const hearth = JSON.stringify({ format: 1, name: 'Hearth', currencies: CURRENCIES });
  const plain = JSON.stringify({ format: 1, name: 'Plain' });
  await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1), (?, ?, ?, ?, 1)',
    [HEARTH, 'Hearth', hearth, hearth, PLAIN, 'Plain', plain, plain]);
  await new Promise((resolve) => runtime.load(db, resolve));
  await call(money.put, db, 'GHOST', HEARTH, 'gold', 1000, 0);
  await call(money.put, db, 'GHOST', HEARTH, 'favor', 50, 0);
  await call(money.put, db, 'GHOST', HEARTH, 'dollars', 434, 0);
});

describe('withdrawing', () => {
  it('takes from the main currency when the message names none, and only what is there without negative on', async () => {
    const { handlers, sent } = await running(HEARTH);
    handlers.withdrawFunds({ amount: 300 });
    await drain(db);
    expect(await balance('gold')).toEqual({ balance: 700, debt: 0 });
    handlers.withdrawFunds({ amount: 701 });
    await drain(db);
    expect(await balance('gold')).toEqual({ balance: 700, debt: 0 });
    expect(refusals(sent)).toEqual([{ action: 'withdraw', reason: 'funds', currency: 'gold' }]);
  });

  it('takes from the currency the message names, below zero where that currency allows it', async () => {
    const { handlers, sent } = await running(HEARTH);
    handlers.withdrawFunds({ amount: 60, currency: 'favor' });
    handlers.withdrawFunds({ amount: 500, currency: 'dollars' });
    await drain(db);
    expect(await balance('favor')).toEqual({ balance: 50, debt: 0 });
    expect(await balance('dollars')).toEqual({ balance: -66, debt: 0 });
    expect(refusals(sent)).toEqual([{ action: 'withdraw', reason: 'funds', currency: 'favor' }]);
  });

  it('moves nothing in a currency the system lacks', async () => {
    const { handlers, sent } = await running(HEARTH);
    handlers.withdrawFunds({ amount: 10, currency: 'silver' });
    await drain(db);
    expect([await balance('gold'), await balance('favor'), await balance('dollars')].map((b) => b.balance)).toEqual([1000, 50, 434]);
    expect(sent.filter((e) => e.event === 'bankUpdate')).toEqual([]);
  });
});

describe('borrowing and paying debt', () => {
  it('borrows only where the currency has debt on', async () => {
    const { handlers, sent } = await running(HEARTH);
    handlers.borrowFunds({ amount: 200 });
    handlers.borrowFunds({ amount: 5, currency: 'favor' });
    await drain(db);
    expect(await balance('gold')).toEqual({ balance: 1000, debt: 200 });
    expect(await balance('favor')).toEqual({ balance: 50, debt: 0 });
    expect(refusals(sent)).toEqual([{ action: 'borrow', reason: 'no_debt', currency: 'favor' }]);
  });

  it('pays debt in its own currency, never more than is owed or held', async () => {
    await call(money.put, db, 'GHOST', HEARTH, 'gold', 1000, 300);
    const { handlers } = await running(HEARTH);
    handlers.payDebt({ amount: 9999, currency: 'gold' });
    await drain(db);
    expect(await balance('gold')).toEqual({ balance: 700, debt: 0 });
  });
});

describe('the GM', () => {
  it('pays players in the currency named, each a whole share rounded up', async () => {
    const { handlers } = await running(HEARTH);
    handlers.adminPayPlayers({ token: GM, usernames: ['GHOST', 'ROOK'], totalAmount: 7, currency: 'favor' });
    await drain(db);
    expect(await balance('favor')).toEqual({ balance: 54, debt: 0 });
    expect(await call(money.get, db, 'ROOK', HEARTH, 'favor')).toEqual({ balance: 4, debt: 0 });
    expect(await balance('gold')).toEqual({ balance: 1000, debt: 0 });
  });

  it('sets an account only within its currency\'s switches', async () => {
    const { handlers, sent } = await running(HEARTH);
    handlers.adminUpdateBank({ token: GM, username: 'GHOST', balance: 500, debt: 100 });
    handlers.adminUpdateBank({ token: GM, username: 'GHOST', balance: 10, debt: 5, currency: 'favor' });
    handlers.adminUpdateBank({ token: GM, username: 'GHOST', balance: -1, debt: 0, currency: 'favor' });
    handlers.adminUpdateBank({ token: GM, username: 'GHOST', balance: -250, debt: 0, currency: 'dollars' });
    await drain(db);
    expect(await balance('gold')).toEqual({ balance: 500, debt: 100 });
    expect(await balance('favor')).toEqual({ balance: 50, debt: 0 });
    expect(await balance('dollars')).toEqual({ balance: -250, debt: 0 });
    // In either order: each GM message checks its token on its own before acting.
    expect(refusals(sent).sort((a, b) => a.reason.localeCompare(b.reason))).toEqual([
      { action: 'set', reason: 'no_debt', currency: 'favor' },
      { action: 'set', reason: 'no_negative', currency: 'favor' },
    ]);
  });
});

describe('telling a balance', () => {
  it('tells every currency, the main one first, beside the main currency\'s usual fields', async () => {
    const { handlers, sent } = await running(HEARTH);
    handlers.requestBankBalance({ username: 'GHOST' });
    await drain(db);
    expect(sent.find((e) => e.event === 'bankUpdate').data).toMatchObject({
      username: 'GHOST', balance: 1000, debt: 0,
      currencies: [{ id: 'gold', balance: 1000, debt: 0 }, { id: 'favor', balance: 50, debt: 0 }, { id: 'dollars', balance: 434, debt: 0 }],
    });
  });

  it('tells only today\'s fields under a built-in system, and a custom one with no currencies', async () => {
    for (const system of ['cyberpunk_red', PLAIN]) {
      await run(db, 'INSERT OR REPLACE INTO bank_accounts (username, system, balance, debt) VALUES (?, ?, 20, 0)', ['GHOST', system]);
      const { handlers, sent } = await running(system);
      handlers.requestBankBalance({ username: 'GHOST' });
      await drain(db);
      const update = sent.find((e) => e.event === 'bankUpdate').data;
      expect(update.currencies, system).toBeUndefined();
      expect(update.balance, system).toBe(20);
    }
  });
});

describe('a custom system with no currencies of its own', () => {
  it('keeps today\'s bank: overdrawing and borrowing open', async () => {
    await run(db, 'INSERT INTO bank_accounts (username, system, balance, debt) VALUES (?, ?, 20, 0)', ['GHOST', PLAIN]);
    const { handlers, sent } = await running(PLAIN);
    handlers.withdrawFunds({ amount: 50 });
    handlers.borrowFunds({ amount: 30 });
    await drain(db);
    expect(await get(db, 'SELECT balance, debt FROM bank_accounts WHERE username = ? AND system = ?', ['GHOST', PLAIN])).toEqual({ balance: -30, debt: 30 });
    expect(refusals(sent)).toEqual([]);
  });
});
