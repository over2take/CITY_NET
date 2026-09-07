/**
 * Awarding experience over the socket.
 *
 * awardXp decides what the numbers do and is tested on its own in award_xp.test.js.
 * These cover the wiring, which is the part that had none: that only an admin can fire
 * it, that the SLOW ADVANCEMENT house rule actually reaches the award, that the result
 * comes back, and that every player whose sheet moved is told to reload it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, run } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';

const socketsFactory = (await import('../sockets/index.js')).default;

const flush = (ms = 60) => new Promise((r) => setTimeout(r, ms));

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
    id: 'sock-1',
    on: (event, fn) => { handlers[event] = fn; },
    emit: (event, data) => emitted.push({ event, data, direct: true }),
    broadcast: { emit: (event, data) => emitted.push({ event, data, broadcast: true }) },
    use: () => {}, join: () => {},
  };
  connectionCb(socket);
  return { handlers, emitted };
}

const adminToken = () => jwt.sign({ username: 'gm', role: 'admin' }, 'test-secret');
const playerToken = () => jwt.sign({ username: 'bob', role: 'player' }, 'test-secret');

let db;
beforeEach(async () => {
  db = await makeTestDb();
  await run(db, `CREATE TABLE IF NOT EXISTS player_banks (username TEXT PRIMARY KEY, balance REAL, debt REAL)`);
  await run(db, `INSERT OR REPLACE INTO global_settings (key, value) VALUES ('game_system', 'cities_without_number')`);
  await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('ghost', 'cities_without_number', ?, 0)`,
    [JSON.stringify({ level: 1, xp: 0 })]);
});

const sheetOf = async (username = 'ghost') =>
  JSON.parse((await get(db, `SELECT data FROM character_sheets WHERE username = ?`, [username])).data);

const setRule = (value) =>
  run(db, `INSERT OR REPLACE INTO global_settings (key, value) VALUES ('cwn_slow_advancement', ?)`, [value]);

describe('who may award experience', () => {
  it('lets an admin', async () => {
    const { handlers } = boot(db);
    handlers['adminAwardXp']({ token: adminToken(), usernames: ['ghost'], amount: 3 });
    await flush();
    expect((await sheetOf()).xp).toBe(3);
  });

  it('refuses a player', async () => {
    const { handlers } = boot(db);
    handlers['adminAwardXp']({ token: playerToken(), usernames: ['ghost'], amount: 3 });
    await flush();
    expect((await sheetOf()).xp).toBe(0);
  });

  it('refuses a forged token', async () => {
    const { handlers } = boot(db);
    handlers['adminAwardXp']({ token: jwt.sign({ username: 'gm', role: 'admin' }, 'wrong-secret'), usernames: ['ghost'], amount: 3 });
    await flush();
    expect((await sheetOf()).xp).toBe(0);
  });
});

describe('the house rule reaches the award', () => {
  it('advances on the fast column when SLOW ADVANCEMENT is off', async () => {
    // 12 XP is level 4 on fast.
    const { handlers } = boot(db);
    handlers['adminAwardXp']({ token: adminToken(), usernames: ['ghost'], amount: 12 });
    await flush();
    expect(await sheetOf()).toMatchObject({ xp: 12, level: 4 });
  });

  it('advances on the slow column when it is on', async () => {
    // The same 12 XP is only level 2 on slow, where level 3 costs 15. If the setting did
    // not reach the award this would read level 4 and nobody would notice for months.
    await setRule('1');
    const { handlers } = boot(db);
    handlers['adminAwardXp']({ token: adminToken(), usernames: ['ghost'], amount: 12 });
    await flush();
    expect(await sheetOf()).toMatchObject({ xp: 12, level: 2 });
  });

  it('treats the rule being absent as fast', async () => {
    const { handlers } = boot(db);
    handlers['adminAwardXp']({ token: adminToken(), usernames: ['ghost'], amount: 6 });
    await flush();
    expect((await sheetOf()).level).toBe(3);
  });
});

describe('what comes back', () => {
  it('tells the GM what each character ended on', async () => {
    const { handlers, emitted } = boot(db);
    handlers['adminAwardXp']({ token: adminToken(), usernames: ['ghost'], amount: 6 });
    await flush();
    const result = emitted.find((e) => e.event === 'xpAwardResult');
    expect(result.data).toMatchObject({ ok: true, amount: 6 });
    expect(result.data.results[0]).toMatchObject({ username: 'ghost', ok: true, xp: 6, level: 3 });
  });

  it('tells the player their sheet moved, so the bar redraws', async () => {
    const { handlers, emitted } = boot(db);
    handlers['adminAwardXp']({ token: adminToken(), usernames: ['ghost'], amount: 3 });
    await flush();
    expect(emitted.some((e) => e.event === 'sheetUpdated' && e.data.username === 'ghost')).toBe(true);
  });

  it('says why when the award was refused, rather than going quiet', async () => {
    const { handlers, emitted } = boot(db);
    handlers['adminAwardXp']({ token: adminToken(), usernames: ['ghost'], amount: 0 });
    await flush();
    expect(emitted.find((e) => e.event === 'xpAwardResult').data)
      .toMatchObject({ ok: false, reason: expect.stringContaining('zero') });
  });

  it('does not announce a sheet that never moved', async () => {
    const { handlers, emitted } = boot(db);
    handlers['adminAwardXp']({ token: adminToken(), usernames: ['nobody'], amount: 3 });
    await flush();
    expect(emitted.some((e) => e.event === 'sheetUpdated')).toBe(false);
  });
});

describe('correcting a level over the socket', () => {
  it('lets an admin step one down', async () => {
    await run(db, `UPDATE character_sheets SET data = ? WHERE username = 'ghost'`,
      [JSON.stringify({ level: 4, xp: 12 })]);
    const { handlers } = boot(db);
    handlers['adminAdjustLevel']({ token: adminToken(), usernames: ['ghost'], delta: -1 });
    await flush();
    expect(await sheetOf()).toMatchObject({ level: 3, xp: 12 });
  });

  it('refuses a player', async () => {
    const { handlers } = boot(db);
    handlers['adminAdjustLevel']({ token: playerToken(), usernames: ['ghost'], delta: 1 });
    await flush();
    expect((await sheetOf()).level).toBe(1);
  });

  it('tells the player, so their sheet redraws', async () => {
    const { handlers, emitted } = boot(db);
    handlers['adminAdjustLevel']({ token: adminToken(), usernames: ['ghost'], delta: 1 });
    await flush();
    expect(emitted.some((e) => e.event === 'sheetUpdated' && e.data.username === 'ghost')).toBe(true);
  });
});
