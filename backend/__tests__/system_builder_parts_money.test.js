/**
 * A custom system with the bank turned off (3b2a): no money on its sheets, and no money moves.
 *
 * The server is the authority, so this half comes first; the windows stop offering the bank
 * in 3b2b. What is defended:
 *
 *   - a sheet loses the fields linked to the bank, and a section left with nothing else;
 *   - every money handler does nothing, and the shop's checkout says why;
 *   - no balance is told to anyone;
 *   - nothing is deleted: the accounts stay exactly as they were, and turning the bank back on
 *     brings the money back;
 *   - the bank works as before under a custom system that kept it, and under the built-ins.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain, untilValue } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';
const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');

const require_ = createRequire(import.meta.url);
const runtime = require_('../systemBuilder/runtime');
const { effectiveSheet, fieldsOf } = require_('../systemBuilder/sheet');
const socketsFactory = (await import('../sockets/index.js')).default;

const NOBANK = 'sys_aaaaaaaaaaaaaaaa';
const BANKED = 'sys_bbbbbbbbbbbbbbbb';
const withBank = (on) => JSON.stringify({ format: 1, name: 'Hearth', parts: { bank: { on } } });

let nextSocket = 0;
function boot(db) {
  const emitted = [];
  let connectionCb;
  const io = {
    on: (event, cb) => { if (event === 'connection') connectionCb = cb; },
    emit: (event, data) => emitted.push({ event, data }),
    to: () => ({ emit: (event, data) => emitted.push({ event, data }) }),
  };
  socketsFactory(io, db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
  const handlers = {};
  const socket = {
    id: `money-sock-${(nextSocket += 1)}`,
    on: (event, fn) => { handlers[event] = fn; },
    emit: (event, data) => emitted.push({ event, data, direct: true }),
    broadcast: { emit: (event, data) => emitted.push({ event, data, broadcast: true }) },
    use: () => {}, join: () => {},
  };
  connectionCb(socket);
  return { handlers, emitted };
}

let db;
const running = async (system) => {
  await run(db, `INSERT OR REPLACE INTO global_settings (key, value) VALUES ('game_system', ?)`, [system]);
  await run(db, `INSERT INTO bank_accounts (username, system, balance, debt) VALUES ('GHOST', ?, 1000, 500)`, [system]);
  await run(db, `INSERT INTO bank_accounts (username, system, balance, debt) VALUES ('ROOK', ?, 50, 0)`, [system]);
  const booted = boot(db);
  booted.handlers.identify('GHOST');
  await drain(db);
  booted.emitted.length = 0;
  return booted;
};
const account = (username, system) =>
  get(db, 'SELECT balance, debt, first_pay_done, high_roller_done FROM bank_accounts WHERE username = ? AND system = ?', [username, system]);

beforeEach(async () => {
  db = await makeTestDb();
  await run(db, `INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, 'Hearth', ?, ?, 1), (?, 'Kept', ?, ?, 1)`,
    [NOBANK, withBank(false), withBank(false), BANKED, withBank(true), withBank(true)]);
  await new Promise((resolve) => runtime.load(db, resolve));
});

/**
 * Every way money moves or is told, run once. Where the bank is on (`system` given), it waits for
 * the pay to reach ROOK (50 + 200) before the GM's own edit, and for the edit to land, rather than
 * a fixed number of rounds: on a slow CI machine the pay once landed after them, its write
 * overtaking the edit (2026-10-06).
 */
const everything = async ({ handlers }, system = null) => {
  const rook = () => account('ROOK', system);
  handlers.withdrawFunds({ amount: 100 });
  handlers.borrowFunds({ amount: 100 });
  handlers.payDebt({ amount: 100 });
  handlers.markFirstPayDone({ username: 'GHOST' });
  handlers.markHighRollerDone({ username: 'GHOST' });
  handlers.adminPayPlayers({ token: GM, usernames: ['GHOST', 'ROOK'], totalAmount: 400 });
  // The pay lands before the GM's own edit of ROOK, so the edit is the last word.
  await drain(db);
  if (system) await untilValue(rook, (a) => a && a.balance === 250, { label: 'the pay reaching ROOK' });
  handlers.adminUpdateBank({ token: GM, username: 'ROOK', balance: 9999, debt: 0 });
  handlers.requestBankBalance({ username: 'GHOST' });
  handlers.checkoutShop({ locationId: 1, buys: [] });
  await drain(db);
  if (system) await untilValue(rook, (a) => a && a.balance === 9999, { label: 'the GM\'s edit of ROOK' });
};

describe('a custom system with the bank off', () => {
  it('moves no money and tells no balance, and the checkout says why', async () => {
    const booted = await running(NOBANK);
    await everything(booted);
    expect(await account('GHOST', NOBANK)).toEqual({ balance: 1000, debt: 500, first_pay_done: 0, high_roller_done: 0 });
    expect(await account('ROOK', NOBANK)).toMatchObject({ balance: 50, debt: 0 });
    expect(booted.emitted.filter((e) => e.event === 'bankUpdate')).toEqual([]);
    expect(booted.emitted.find((e) => e.event === 'shopCheckout').data).toEqual({ ok: false, reason: 'no_bank' });
  });

  it('keeps every account, so turning the bank back on brings the money back', async () => {
    const booted = await running(NOBANK);
    await everything(booted);
    await run(db, 'UPDATE custom_systems SET published = ?, version = 2 WHERE id = ?', [withBank(true), NOBANK]);
    await new Promise((resolve) => runtime.refresh(db, NOBANK, resolve));
    booted.handlers.withdrawFunds({ amount: 250 });
    booted.handlers.requestBankBalance({ username: 'GHOST' });
    await drain(db);
    expect(await account('GHOST', NOBANK)).toMatchObject({ balance: 750, debt: 500 });
    expect(booted.emitted.some((e) => e.event === 'bankUpdate' && e.data.username === 'GHOST' && e.data.balance === 750)).toBe(true);
  });
});

describe('the bank, where it is on', () => {
  for (const system of [BANKED, 'cities_without_number', 'generic']) {
    it(`moves money and tells balances as before (${system})`, async () => {
      const booted = await running(system);
      await everything(booted, system);
      // 1000 - 100 withdrawn, + 100 borrowed onto the debt, 100 of it paid back, + 200 of the pay.
      expect(await account('GHOST', system)).toEqual({ balance: 1000, debt: 500, first_pay_done: 1, high_roller_done: 1 });
      expect(await account('ROOK', system)).toMatchObject({ balance: 9999 });
      expect(booted.emitted.some((e) => e.event === 'bankUpdate' && e.data.username === 'GHOST')).toBe(true);
      expect(booted.emitted.find((e) => e.event === 'shopCheckout').data.reason).not.toBe('no_bank');
    });
  }
});

describe('a custom system\'s sheet', () => {
  const ids = (definition) => fieldsOf(effectiveSheet(definition)).map((f) => f.id);
  const sections = (definition) => effectiveSheet(definition).sections.map((s) => s.id);

  it('has no money on the starter sheet while the bank is off', () => {
    expect(ids({ name: 'A' })).toContain('cash');
    expect(sections({ name: 'A' })).toContain('money');
    const off = { name: 'A', parts: { bank: { on: false } } };
    expect(ids(off)).not.toContain('cash');
    expect(sections(off)).not.toContain('money');
    // The rest of the starter is still there, empty inventory included.
    expect(sections(off)).toEqual(sections({ name: 'A' }).filter((s) => s !== 'money'));
  });

  it('drops only the fields linked to the bank from a designed sheet, and a section left empty by it', () => {
    const sheet = { tabs: ['MAIN'], sections: [
      { id: 'purse', label: 'PURSE', layout: 'list', fields: [{ id: 'cash', label: 'Cash', type: 'number', source: 'bank_balance' }] },
      { id: 'kit', label: 'KIT', layout: 'list', fields: [
        { id: 'gold', label: 'Gold', type: 'number', source: 'bank_balance' },
        { id: 'rope', label: 'Rope', type: 'text' },
      ] },
      { id: 'bag', label: 'BAG', layout: 'inventory', fields: [] },
    ] };
    const definition = { name: 'A', sheet, parts: { bank: { on: false } } };
    const before = JSON.stringify(sheet);
    expect(effectiveSheet(definition).sections).toEqual([
      { id: 'kit', label: 'KIT', layout: 'list', fields: [{ id: 'rope', label: 'Rope', type: 'text' }] },
      { id: 'bag', label: 'BAG', layout: 'inventory', fields: [] },
    ]);
    // The design itself is untouched: turning the bank back on shows it all again.
    expect(JSON.stringify(sheet)).toBe(before);
    expect(effectiveSheet({ ...definition, parts: {} })).toBe(sheet);
  });

  it('does not link a field to the bank, so no balance is read onto it', () => {
    expect(runtime.meta(NOBANK).linkedFields).not.toHaveProperty('cash');
    expect(runtime.meta(BANKED).linkedFields).toMatchObject({ cash: 'bank_balance' });
    expect(runtime.render(NOBANK).sheet.sections.map((s) => s.id)).not.toContain('money');
  });
});
