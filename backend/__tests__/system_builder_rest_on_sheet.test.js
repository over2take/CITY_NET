/**
 * Resting from the sheet, the server's side (R3a; approved mockup docs/mockups/rest-on-sheet.html and
 * the user's calls of 2026-10-30): a player takes one of the game's rests on their own character
 * from their sheet, in a system whose rests are finished on each sheet; the GM may on anyone's,
 * always. It does what a called rest does: refills, uses, recovery dice given back, the token, a
 * dice-log line. A rest the GM called on the sheet is finished with it. The sheet is told the rests
 * by name and which ones the dice are spent at.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';

const require_ = createRequire(import.meta.url);
const { restingShown, restCallOf, REST_CALL_KEY, RECOVERY_KEY } = require_('../systemBuilder/recovery');
const { PICKS_KEY } = require_('../systemBuilder/choices');
const { checkDefinition } = require_('../systemBuilder/definition');
const { REST_AT_CALL } = require_('../sockets/choices');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = (await import('../sockets/index.js')).default;

const FORGE = {
  format: 1, name: 'Forge',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Constitution' }] }],
  choices: [{ id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [
    { id: 'fighter', label: 'Fighter', die: 10, features: [{ id: 'second_wind', label: 'Second Wind', uses: { count: '1', refill: 'short_rest' } }] },
  ] }],
  rests: {
    short_rest: { refills: [{ what: 'health', how: 'by', amount: '2' }] },
    long_rest: { refills: [{ what: 'health', how: 'full' }] },
    end_of_scene: { on: false },
    camp: { name: 'Camp' },
  },
  resting: { finish: 'sheet', recovery: { name: 'Hit Dice', spent_at: ['short_rest', 'camp'], back: [{ rest: 'long_rest', how: 'all' }] } },
};
const atCall = { ...FORGE, resting: { ...FORGE.resting, finish: 'call' } };
const ROOK = { name: 'Rook', con: 12, [PICKS_KEY]: { classes: [{ option: 'fighter', level: 3 }] }, _uses: { second_wind: 1 }, [RECOVERY_KEY]: { fighter: 2 } };

describe('what the sheet is told', () => {
  it('the systems check clean', () => {
    expect(checkDefinition(FORGE).problems).toEqual([]);
  });

  it('who finishes a called rest, and each rest that is on by name, with whether the dice are spent at it', () => {
    expect(restingShown(FORGE)).toEqual({ finish: 'sheet', rests: [
      { id: 'short_rest', name: 'Short rest', spends: true },
      { id: 'long_rest', name: 'Long rest', spends: false },
      { id: 'end_of_session', name: 'End of session', spends: false },
      { id: 'camp', name: 'Camp', spends: true },
    ] });
    const any = { ...FORGE, resting: { recovery: { ...FORGE.resting.recovery, spent_at: 'any' } } };
    expect(restingShown(any).rests.every((r) => r.spends)).toBe(true);
    expect(restingShown({ ...FORGE, resting: undefined })).toMatchObject({ finish: 'call' });
    expect(restingShown({ ...FORGE, resting: undefined }).rests.some((r) => r.spends)).toBe(false);
  });

  it('in the sheet\'s template', () => {
    expect(runtime.renderOf('sys_x', FORGE).resting).toEqual(restingShown(FORGE));
  });

  it('a rest called on a sheet, read safely', () => {
    expect(restCallOf({ [REST_CALL_KEY]: { rest: 'short_rest', name: 'Short rest' } })).toEqual({ rest: 'short_rest', name: 'Short rest' });
    expect(restCallOf({ [REST_CALL_KEY]: { rest: 'camp' } })).toEqual({ rest: 'camp', name: 'camp' });
    for (const bad of [{}, { [REST_CALL_KEY]: 'short_rest' }, { [REST_CALL_KEY]: { rest: 3 } }, null]) expect(restCallOf(bad), JSON.stringify(bad)).toBeNull();
  });
});

describe('through the socket', () => {
  let db;
  const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
  const ID = 'sys_restonsheetsheet';

  const install = async (definition) => {
    const def = JSON.stringify(definition);
    await run(db, 'DELETE FROM custom_systems');
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, definition.name, def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
  };
  const table = async () => {
    const shared = [];
    let connection;
    const io = { on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: (event, data) => shared.push({ event, data }), to: () => ({ emit: () => {} }) };
    socketsFactory(io, db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const join = async (who, identity) => {
      const heard = [];
      const handlers = {};
      connection({ id: `s-${who}`, on: (e, fn) => { handlers[e] = fn; }, emit: (event, d) => heard.push({ event, data: d }), broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
      handlers.identify(identity);
      await drain(db);
      const said = (event) => heard.filter((e) => e.event === event).map((e) => e.data.error);
      return { handlers, refused: () => said('restRefused'), said };
    };
    return { shared, gm: await join('gm', { userName: 'gm', isAdmin: true, token: GM }), rook: await join('rook', 'rook') };
  };
  const stored = async (who = 'rook') => JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', [who])).data);
  const token = async () => (await get(db, `SELECT hp_current FROM locations WHERE owner = 'rook'`)).hp_current;
  const lines = () => new Promise((ok) => db.all('SELECT username, historyString FROM dice_rolls ORDER BY id', (e, rows) => ok(rows || [])));

  beforeEach(async () => {
    db = await makeTestDb();
    await run(db, `CREATE TABLE IF NOT EXISTS dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, total INTEGER NOT NULL,
      results TEXT NOT NULL, color TEXT NOT NULL, historyString TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await install(FORGE);
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [ID]);
    for (const who of ['rook', 'ash']) {
      await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)`, [who, ID, JSON.stringify({ ...ROOK, name: who === 'rook' ? 'Rook' : 'Ash' })]);
    }
    await run(db, 'INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max, hp_temp, conditions) VALUES (?, 0, 0, 0, ?, ?, ?, ?, 0, ?)', ['Rook', 'rhombus', 'rook', 10, 30, '[]']);
  });

  it('a player takes a short rest on their own: refilled, healed, a line in the log; others untouched', async () => {
    const { rook, shared } = await table();
    rook.handlers.restTake({ rest: 'short_rest', username: 'ash' });
    await until(async () => (await stored())._uses.second_wind === 0, { label: 'the use refilled' });
    expect(await token()).toBe(12);
    expect((await lines()).map((l) => l.historyString)).toEqual(['SHORT REST · Rook: HP 10 → 12, Second Wind uses 0 → 1']);
    expect((await stored('ash'))._uses.second_wind).toBe(1);
    expect(shared.some((e) => e.event === 'sheetUpdated' && e.data.username === 'rook')).toBe(true);
    expect(shared.some((e) => e.event === 'dataUpdated')).toBe(true);
    expect(rook.refused()).toEqual([]);
  });

  it('a long rest gives the recovery dice back, and finishes a long rest the GM called on that sheet', async () => {
    await run(db, 'UPDATE character_sheets SET data = ? WHERE username = ?', [JSON.stringify({ ...ROOK, [REST_CALL_KEY]: { rest: 'long_rest', name: 'Long rest' } }), 'rook']);
    const { rook } = await table();
    rook.handlers.restTake({ rest: 'long_rest' });
    await until(async () => (await stored())[RECOVERY_KEY].fighter === 0, { label: 'the dice back' });
    expect(await token()).toBe(30);
    expect((await stored())[REST_CALL_KEY]).toBeUndefined();
  });

  it('a different rest leaves a called one waiting; a rest that changes nothing still finishes a call', async () => {
    await run(db, 'UPDATE character_sheets SET data = ? WHERE username = ?', [JSON.stringify({ ...ROOK, [REST_CALL_KEY]: { rest: 'long_rest', name: 'Long rest' } }), 'rook']);
    const { rook } = await table();
    rook.handlers.restTake({ rest: 'short_rest' });
    await until(async () => (await lines()).length === 1, { label: 'the short rest' });
    expect((await stored())[REST_CALL_KEY]).toEqual({ rest: 'long_rest', name: 'Long rest' });
    // End of session refills nothing for Rook, but was the one called.
    await run(db, 'UPDATE character_sheets SET data = ? WHERE username = ?', [JSON.stringify({ name: 'Rook', [REST_CALL_KEY]: { rest: 'end_of_session', name: 'End of session' } }), 'rook']);
    rook.handlers.restTake({ rest: 'end_of_session' });
    await until(async () => (await stored())[REST_CALL_KEY] === undefined, { label: 'the call finished' });
    expect((await lines()).at(-1).historyString).toBe('END OF SESSION · Rook: nothing changed');
  });

  it('where rests are taken at the GM\'s call, a player is refused and nothing is written; the GM may on anyone', async () => {
    await install(atCall);
    const { rook, gm } = await table();
    rook.handlers.restTake({ rest: 'short_rest' });
    await until(() => rook.refused().length === 1, { label: 'the refusal' });
    expect(rook.refused()).toEqual([REST_AT_CALL]);
    expect(REST_AT_CALL).toBe('In this game, rests are taken when the GM calls them');
    expect((await stored())._uses.second_wind).toBe(1);
    gm.handlers.restTake({ rest: 'short_rest', username: 'rook' });
    await until(async () => (await stored())._uses.second_wind === 0, { label: 'the GM\'s rest' });
    expect(gm.refused()).toEqual([]);
  });

  it('says why not: a rest the game hasn\'t got or has turned off, a character with no sheet; bad asks ignored', async () => {
    const { rook, gm } = await table();
    rook.handlers.restTake({ rest: 'nap' });
    rook.handlers.restTake({ rest: 'end_of_scene' });
    await until(() => rook.refused().length === 2, { label: 'both refused' });
    expect(rook.refused()).toEqual(['Not one of this game\'s rests', 'Not one of this game\'s rests']);
    gm.handlers.restTake({ rest: 'short_rest', username: 'ghost' });
    await until(() => gm.refused().length === 1, { label: 'no sheet' });
    expect(gm.refused()).toEqual(['That character has no sheet yet']);
    for (const bad of [null, {}, { rest: 3 }]) rook.handlers.restTake(bad);
    await drain(db);
    expect(rook.refused()).toHaveLength(2);
    expect(await lines()).toEqual([]);
  });

  it('a game on a built-in system has no rests to take here', async () => {
    await run(db, `UPDATE global_settings SET value = 'cities_without_number' WHERE key = 'game_system'`);
    const { rook } = await table();
    rook.handlers.restTake({ rest: 'short_rest' });
    await until(() => rook.refused().length === 1, { label: 'the refusal' });
    expect(rook.refused()).toEqual(['This game\'s rests are its own buttons']);
    // And no recovery dice to spend, in its own words.
    rook.handlers.recoverySpend({ pool: 'fighter', count: 1 });
    await until(() => rook.said('recoveryRefused').length === 1, { label: 'the spend refused' });
    expect(rook.said('recoveryRefused')).toEqual(['This game has no recovery dice']);
  });
});
