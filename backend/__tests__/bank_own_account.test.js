/**
 * The bank's player-facing handlers act on the sender's own account.
 *
 * These three used to read a username out of the message and act on whatever account it
 * named, with nothing checking that the sender was that person. The tests below are in two
 * halves, and both halves matter:
 *
 *   - the ordinary cases still work exactly as they did, because the only legitimate use
 *     was ever a player acting on themselves, and this was not supposed to change that;
 *   - naming somebody else does nothing to them.
 *
 * Admin movement of other people's money is a different path - adminUpdateBank and
 * adminPayPlayers, both token-checked - and is deliberately not touched here.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';

const socketsFactory = (await import('../sockets/index.js')).default;

let nextSocket = 0;
function boot(db, id = `bank-sock-${(nextSocket += 1)}`) {
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
    id,
    on: (event, fn) => { handlers[event] = fn; },
    emit: (event, data) => emitted.push({ event, data, direct: true }),
    broadcast: { emit: (event, data) => emitted.push({ event, data, broadcast: true }) },
    use: () => {}, join: () => {},
  };
  connectionCb(socket);
  return { handlers, emitted };
}

let db;
beforeEach(async () => {
  db = await makeTestDb();
  await run(db, `CREATE TABLE IF NOT EXISTS player_banks (
    username TEXT PRIMARY KEY, balance REAL, debt REAL,
    first_pay_done INTEGER DEFAULT 0, high_roller_done INTEGER DEFAULT 0)`);
  await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'cities_without_number')`);
  await run(db, `INSERT INTO player_banks (username, balance, debt) VALUES ('GHOST', 1000, 500)`);
  await run(db, `INSERT INTO player_banks (username, balance, debt) VALUES ('VICTIM', 8000, 0)`);
});

const identified = async (name = 'GHOST') => {
  const booted = boot(db);
  booted.handlers['identify'](name);
  await drain(db);
  return booted;
};

const bank = async (username) =>
  get(db, 'SELECT balance, debt FROM player_banks WHERE username = ?', [username]);

describe('what these handlers still do, unchanged', () => {
  it('withdraws from the caller\'s own balance', async () => {
    const { handlers } = await identified('GHOST');
    handlers['withdrawFunds']({ username: 'GHOST', amount: 250 });
    await drain(db);
    expect((await bank('GHOST')).balance).toBe(750);
  });

  it('borrows onto the caller\'s own debt', async () => {
    const { handlers } = await identified('GHOST');
    handlers['borrowFunds']({ username: 'GHOST', amount: 300 });
    await drain(db);
    expect((await bank('GHOST')).debt).toBe(800);
  });

  it('pays debt down from the caller\'s own balance', async () => {
    const { handlers } = await identified('GHOST');
    handlers['payDebt']({ username: 'GHOST', amount: 200 });
    await drain(db);
    expect(await bank('GHOST')).toMatchObject({ balance: 800, debt: 300 });
  });

  it('still clamps a payment to what is owed and what is held', async () => {
    // The existing rule: you cannot overpay a debt, or pay with money you do not have.
    const { handlers } = await identified('GHOST');
    handlers['payDebt']({ username: 'GHOST', amount: 999999 });
    await drain(db);
    expect(await bank('GHOST')).toMatchObject({ balance: 500, debt: 0 });
  });

  it('still ignores a nonsense amount', async () => {
    const { handlers } = await identified('GHOST');
    for (const amount of [0, -100, 'abc', undefined]) {
      handlers['withdrawFunds']({ username: 'GHOST', amount });
    }
    await drain(db);
    expect((await bank('GHOST')).balance).toBe(1000);
  });
});

describe('whose account it is', () => {
  it('will not withdraw from someone else by naming them', async () => {
    const { handlers } = await identified('GHOST');
    handlers['withdrawFunds']({ username: 'VICTIM', amount: 5000 });
    await drain(db);

    expect((await bank('VICTIM')).balance).toBe(8000);
    // The message named VICTIM, so the money came out of GHOST - the sender's own
    // account - rather than nobody's. Ignoring the field beats honouring it.
    expect((await bank('GHOST')).balance).toBe(1000 - 5000);
  });

  it('will not saddle someone else with debt', async () => {
    const { handlers } = await identified('GHOST');
    handlers['borrowFunds']({ username: 'VICTIM', amount: 5000 });
    await drain(db);
    expect((await bank('VICTIM')).debt).toBe(0);
  });

  it('will not spend someone else\'s balance on their debt', async () => {
    await run(db, `UPDATE player_banks SET debt = 1000 WHERE username = 'VICTIM'`);
    const { handlers } = await identified('GHOST');
    handlers['payDebt']({ username: 'VICTIM', amount: 500 });
    await drain(db);
    expect(await bank('VICTIM')).toMatchObject({ balance: 8000, debt: 1000 });
  });

  it('does nothing for a socket that never identified', async () => {
    const { handlers } = boot(db);
    handlers['withdrawFunds']({ username: 'GHOST', amount: 100 });
    handlers['borrowFunds']({ username: 'GHOST', amount: 100 });
    handlers['payDebt']({ username: 'GHOST', amount: 100 });
    await drain(db);
    expect(await bank('GHOST')).toMatchObject({ balance: 1000, debt: 500 });
  });
});
