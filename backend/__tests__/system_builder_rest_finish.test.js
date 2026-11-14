/**
 * The GM's side of a rest finished on each sheet (R4; approved mockup docs/mockups/rest-on-sheet.html,
 * pane 4): after calling one, the GAME tab sees each player in it finished (by them or by the GM,
 * with what it changed and the recovery dice spent), resting (dice spent, not finished) or waiting,
 * how many are left and how many NPCs rested at once; and FINISH FOR <name> or FOR EVERYONE finishes
 * it for those still resting, as they would have.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';
import sheetsRouteFactory from '../routes/sheets.js';

const require_ = createRequire(import.meta.url);
const runtime = require_('../systemBuilder/runtime');
const { REST_CALL_KEY, RECOVERY_KEY, restCallOf, callOn, finishedCall, restCallsShown, spentNow } = require_('../systemBuilder/recovery');
const { PICKS_KEY } = require_('../systemBuilder/choices');
const { takeRest, finishCalled } = require_('../sheets/rests');
const { elevatedUsers } = require_('../middleware/auth');

const sign = (payload) => jwt.sign(payload, 'test-secret');
const GM = sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false });
const EDITOR = sign({ username: 'ghost', isTemporary: true });
const PLAYER = sign({ username: 'rook', role: 'player' });

const ID = 'sys_restfinishfinish';
const FORGE = {
  format: 1, name: 'Forge',
  choices: [{ id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'fighter', label: 'Fighter', die: 10 }] }],
  rests: { short_rest: { refills: [{ what: 'health', how: 'by', amount: '2' }] }, long_rest: { refills: [{ what: 'health', how: 'full' }] } },
  resting: { finish: 'sheet', recovery: { name: 'Hit Dice', spent_at: ['short_rest'], back: [{ rest: 'long_rest', how: 'all' }] } },
};
const FIGHTER = (name, spent = 0) => ({ name, [PICKS_KEY]: { classes: [{ option: 'fighter', level: 3 }] }, [RECOVERY_KEY]: { fighter: spent } });
const SHORT = { id: 'short_rest', name: 'Short rest' };

describe('the call as a sheet keeps it', () => {
  it('names the call, the rest, the NPCs rested and the dice spent when called', () => {
    expect(spentNow(FORGE, FIGHTER('Rook', 2))).toBe(2);
    expect(spentNow(FORGE, { name: 'Nobody' })).toBe(0);
    expect(callOn(FORGE, SHORT, { id: 'c1', at: '2026-10-31T10:00:00.000Z', npcs: 2 }, FIGHTER('Rook', 1)))
      .toEqual({ id: 'c1', at: '2026-10-31T10:00:00.000Z', rest: 'short_rest', name: 'Short rest', npcs: 2, before: 1 });
  });

  it('finished, says by whom, what it changed and the dice spent since; and no longer opens on the sheet', () => {
    const call = callOn(FORGE, SHORT, { id: 'c1', at: 'x', npcs: 0 }, FIGHTER('Rook', 1));
    const data = { ...FIGHTER('Rook', 3), [REST_CALL_KEY]: call };
    expect(restCallOf(data)).toEqual({ rest: 'short_rest', name: 'Short rest' });
    const done = finishedCall(FORGE, data, 'gm', [{ what: 'health', label: 'HP', from: 3, to: 5 }]);
    expect(done).toEqual({ ...call, done: true, by: 'gm', changes: [{ what: 'health', label: 'HP', from: 3, to: 5 }], spent: 2 });
    expect(restCallOf({ ...data, [REST_CALL_KEY]: done })).toBeNull();
    // Dice given back before it was called can't count as spent.
    expect(finishedCall(FORGE, { ...FIGHTER('Rook', 0), [REST_CALL_KEY]: call }, 'player', []).spent).toBe(0);
  });
});

describe('the GM\'s view of the latest call', () => {
  const kept = (c, extra = {}) => ({ ...callOn(FORGE, SHORT, c, FIGHTER('x')), ...extra });
  const one = { id: 'c1', at: '2026-10-31T10:00:00.000Z', npcs: 3 };
  const two = { id: 'c2', at: '2026-10-31T11:00:00.000Z', npcs: 0 };

  it('each player in it finished, resting or waiting, sorted by name, with how many are left', () => {
    const view = restCallsShown(FORGE, [
      { username: 'vex', data: { ...FIGHTER('Vex'), [REST_CALL_KEY]: kept(one) } },
      { username: 'rook', data: { ...FIGHTER('Rook', 1), [REST_CALL_KEY]: kept(one) } },
      { username: 'ash', data: { ...FIGHTER(''), [REST_CALL_KEY]: kept(one, { done: true, by: 'player', changes: [{ what: 'health', label: 'HP', from: 9, to: 11 }], spent: 1 }) } },
      { username: 'juno', data: { name: 'Juno' } },
    ]);
    expect(view).toEqual({
      id: 'c1', rest: 'short_rest', name: 'Short rest', at: one.at, npcs: 3, waiting: 2, players: [
        { username: 'ash', name: 'ash', state: 'finished', by: 'player', changes: [{ what: 'health', label: 'HP', from: 9, to: 11 }], spent: 1 },
        { username: 'rook', name: 'Rook', state: 'resting', changes: [], spent: 1 },
        { username: 'vex', name: 'Vex', state: 'waiting', changes: [], spent: 0 },
      ],
    });
  });

  it('is the latest call only; finished by the GM says so; nothing kept, or only older records, is null', () => {
    const view = restCallsShown(FORGE, [
      { username: 'rook', data: { ...FIGHTER('Rook'), [REST_CALL_KEY]: kept(one) } },
      { username: 'ash', data: { ...FIGHTER('Ash'), [REST_CALL_KEY]: kept(two, { done: true, by: 'gm', spent: 'x' }) } },
    ]);
    expect(view.id).toBe('c2');
    expect(view.players).toEqual([{ username: 'ash', name: 'Ash', state: 'finished', by: 'gm', changes: [], spent: 0 }]);
    expect(view.waiting).toBe(0);
    expect(restCallsShown(FORGE, [{ username: 'rook', data: FIGHTER('Rook') }])).toBeNull();
    // A call kept from before the GM's list (R3b) had no id.
    expect(restCallsShown(FORGE, [{ username: 'rook', data: { [REST_CALL_KEY]: { rest: 'short_rest', name: 'Short rest' } } }])).toBeNull();
    expect(restCallsShown(FORGE, [])).toBeNull();
  });
});

describe('at the table', () => {
  let db;
  let app;
  let dog;
  const io = { emit: () => {} };

  afterEach(() => { elevatedUsers.delete('ghost'); });
  beforeEach(async () => {
    elevatedUsers.add('ghost');
    db = await makeTestDb();
    await run(db, `CREATE TABLE IF NOT EXISTS dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, total INTEGER NOT NULL,
      results TEXT NOT NULL, color TEXT NOT NULL, historyString TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    const text = JSON.stringify(FORGE);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Forge', text, text]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [ID]);
    for (const [who, name] of [['rook', 'Rook'], ['ash', 'Ash']]) {
      await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)', [who, ID, JSON.stringify(FIGHTER(name))]);
    }
    await run(db, 'INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max, hp_temp, conditions) VALUES (?, 0, 0, 0, ?, ?, ?, ?, 0, ?)', ['ROOK', 'rhombus', 'rook', 10, 30, '[]']);
    dog = (await run(db, 'INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max, hp_temp, conditions) VALUES (?, 0, 0, 0, ?, ?, ?, ?, 0, ?)', ['DOG', 'enemy_rhombus', 'gm', 3, 9, '[]'])).lastID;
    app = express();
    app.use(express.json());
    app.use('/api/sheets', sheetsRouteFactory(db, io));
  });

  const call = (body) => request(app).post('/api/sheets/rest').set('Authorization', `Bearer ${GM}`).send(body);
  const finish = (body, as = GM) => request(app).post('/api/sheets/rest/finish').set('Authorization', `Bearer ${as}`).send(body);
  const view = async (as = GM) => (await request(app).get('/api/sheets/rests').set('Authorization', `Bearer ${as}`)).body.call;
  const stored = async (who) => JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', [who])).data);
  const states = (v) => v.players.map((p) => [p.name, p.state, p.by ?? null, p.spent]);

  it('the GM sees each player waiting, resting, finished by them or by the GM, and how many NPCs rested', async () => {
    expect(await view()).toBeNull();
    expect((await call({ rest: 'short_rest', players: true, npcs: [dog] })).status).toBe(200);
    let v = await view(EDITOR);
    expect({ name: v.name, rest: v.rest, npcs: v.npcs, waiting: v.waiting }).toEqual({ name: 'Short rest', rest: 'short_rest', npcs: 1, waiting: 2 });
    expect(states(v)).toEqual([['Ash', 'waiting', null, 0], ['Rook', 'waiting', null, 0]]);
    expect((await stored('rook'))[REST_CALL_KEY]).toMatchObject({ id: v.id, at: v.at, rest: 'short_rest', npcs: 1, before: 0 });

    // Rook spends a hit die, then finishes on their own sheet.
    await run(db, 'UPDATE character_sheets SET data = ? WHERE username = ?', [JSON.stringify({ ...(await stored('rook')), [RECOVERY_KEY]: { fighter: 1 } }), 'rook']);
    expect(states(await view())).toEqual([['Ash', 'waiting', null, 0], ['Rook', 'resting', null, 1]]);
    expect((await takeRest(db, io, { system: ID, definition: FORGE, restId: 'short_rest', username: 'rook' })).error).toBeUndefined();
    v = await view();
    expect(states(v)).toEqual([['Ash', 'waiting', null, 0], ['Rook', 'finished', 'player', 1]]);
    expect(v.players[1].changes.map((c) => [c.label, c.from, c.to])).toEqual([['HP', 10, 12]]);
    expect(v.waiting).toBe(1);
    expect(restCallOf(await stored('rook'))).toBeNull();

    // FINISH FOR ASH: as Ash would, kept as the GM's.
    const done = await finish({ players: ['ASH'] });
    expect(done.status).toBe(200);
    expect(done.body.finished).toBe(1);
    expect(states(done.body.call)).toEqual([['Ash', 'finished', 'gm', 0], ['Rook', 'finished', 'player', 1]]);
    expect(done.body.call.waiting).toBe(0);
    // Nobody left: FOR EVERYONE finishes nobody, and Rook's rest isn't taken twice.
    expect((await finish({ players: true })).body.finished).toBe(0);
    expect((await get(db, `SELECT hp_current FROM locations WHERE owner = 'rook'`)).hp_current).toBe(12);
  });

  it('FINISH FOR one leaves the others resting; FOR EVERYONE finishes those left; the next call starts the list again', async () => {
    await call({ rest: 'short_rest', players: true, npcs: [] });
    const one = await finish({ players: ['rook'] });
    expect([one.body.finished, states(one.body.call)]).toEqual([1, [['Ash', 'waiting', null, 0], ['Rook', 'finished', 'gm', 0]]]);
    expect((await finish({ players: ['ghost'] })).body.finished).toBe(0);
    const done = await finish({ players: true });
    expect(done.body.finished).toBe(1);
    expect(states(done.body.call)).toEqual([['Ash', 'finished', 'gm', 0], ['Rook', 'finished', 'gm', 0]]);
    await call({ rest: 'long_rest', players: ['ash'], npcs: [] });
    const v = await view();
    expect([v.name, v.npcs, states(v)]).toEqual(['Long rest', 0, [['Ash', 'waiting', null, 0]]]);
  });

  it('counts only the rests it could take: one turned off since it was called stays waiting', async () => {
    await call({ rest: 'short_rest', players: ['rook'], npcs: [] });
    const off = { ...FORGE, rests: { ...FORGE.rests, short_rest: { ...FORGE.rests.short_rest, on: false } } };
    const done = await finishCalled(db, io, { system: ID, definition: off, players: true });
    expect([done.finished, states(done.call)]).toEqual([0, [['Rook', 'waiting', null, 0]]]);
  });

  it('says why not: a bad list, no rest waiting, a player, a built-in game', async () => {
    for (const bad of [{}, { players: false }, { players: [] }, { players: [3] }, { players: 'all' }]) {
      const res = await finish(bad);
      expect(res.status, JSON.stringify(bad)).toBe(400);
      expect(res.body.error).toBe('players: true, or a list of up to 100 player names');
    }
    const none = await finish({ players: true });
    expect([none.status, none.body.error]).toEqual([409, 'No rest is waiting to be finished']);
    expect((await finish({ players: true }, PLAYER)).status).toBe(403);
    await run(db, `UPDATE global_settings SET value = 'cities_without_number' WHERE key = 'game_system'`);
    const builtIn = await finish({ players: true });
    expect([builtIn.status, builtIn.body.error]).toEqual([409, 'This game\'s rests are its own buttons']);
    expect(await view()).toBeNull();
  });
});
