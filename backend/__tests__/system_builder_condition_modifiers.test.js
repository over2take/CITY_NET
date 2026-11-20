/**
 * A condition's modifiers with a way, applied where the GM says (8a5e1; approved mockup docs/mockups/condition-modifiers.html,
 * 2026-11-18): ADD, TIMES, SET TO or AT MOST, the amount a number or a formula; a condition APPLIED changes the numbers of a
 * character whose token has it, after every other bonus, and conditions don't stack ("they shouldn't stack"): the strongest
 * of each way on one number. Its ids follow the token onto the sheet, which is worked out again, unless the table keeps
 * them all a reminder. A visual change the GM explains: nothing enforced at the table.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';
import locationsRouteFactory from '../routes/locations.js';
import adminRouteFactory from '../routes/admin.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { checkDefinition } = require_('../systemBuilder/definition');
const { conditionsOf } = require_('../systemBuilder/conditions');
const { applyBonuses } = require_('../systemBuilder/bonuses');
const { metaOf } = require_('../systemBuilder/runtime');
const { CONDITIONS_KEY, workedOf, overlayOf } = require_('../systemBuilder/choices');
const { conditionsToKeep, syncConditionsOnSheet, CONDITIONS_SETTING } = require_('../sheets/conditionsOnSheet');
const { WORN_KEY } = require_('../systemBuilder/items');
const { stepFieldOf } = require_('../systemBuilder/ranks');
const runtime = require_('../systemBuilder/runtime');

const SLOW = {
  format: 1, name: 'Slow', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'speed', label: 'Speed' }, { id: 'might', label: 'Might' }] }],
  derived: [{ id: 'dash', label: 'Dash', formula: '@speed * 2' }, { id: 'carry', label: 'Carry', formula: '@might * 10' }],
  items: { list: [{ id: 'ring', label: 'Ring of Striding', features: [{ id: 'striding', label: 'Striding', modifiers: [{ target: 'speed', amount: '5' }] }] }] },
  conditions: {
    slowed: { name: 'Slowed', applied: true, modifiers: [{ target: 'speed', way: 'times', amount: 0.5 }] },
    crawling: { name: 'Crawling', applied: true, modifiers: [{ target: 'speed', way: 'times', amount: '0.25' }, { target: 'speed', way: 'add', amount: -2 }] },
    weary: { name: 'Weary', applied: true, modifiers: [{ target: 'speed', amount: '@might * -1' }, { target: 'carry', way: 'most', amount: 40 }] },
    pinned: { name: 'Pinned', applied: true, modifiers: [{ target: 'speed', way: 'set', amount: 0 }, { target: 'all_rolls', amount: -1 }] },
    hobbled: { name: 'Hobbled', modifiers: [{ target: 'speed', way: 'times', amount: 0.5 }] },
  },
};
const worn = { inventory: JSON.stringify([{ name: 'Ring of Striding', qty: 1, carry: 'readied' }]), [WORN_KEY]: { ring: { worn: true } } };
const save = (data, def = SLOW) => { metaOf(def).recompute(data); return data; };

describe('the checks', () => {
  const problems = (modifiers, more = {}) => checkDefinition({ ...SLOW, conditions: { x: { name: 'X', modifiers, ...more } } }).problems;

  it('a way of four, ALL ROLLS adding only; the amount a number or a formula that reads', () => {
    expect(checkDefinition(SLOW).problems).toEqual([]);
    expect(problems([{ target: 'speed', way: 'halve', amount: 1 }])).toEqual([{ where: 'condition x, modifier 1, way', message: 'ADD, TIMES, SET TO or AT MOST' }]);
    expect(problems([{ target: 'all_rolls', way: 'times', amount: 2 }])).toEqual([{ where: 'condition x, modifier 1, way', message: 'All rolls only take an ADD' }]);
    expect(problems([{ target: 'all_rolls', amount: '@might' }])).toEqual([{ where: 'condition x, modifier 1, amount', message: 'A whole number from -99 to 99, not 0' }]);
    expect(problems([{ target: 'speed', amount: '@might *' }]).map((p) => p.where)).toEqual(['condition x, modifier 1, amount']);
    expect(problems([{ target: 'speed', amount: ' ' }])).toEqual([{ where: 'condition x, modifier 1, amount', message: 'A number, or formula text' }]);
    expect(problems([{ target: 'speed', amount: 'x'.repeat(201) }])).toEqual([{ where: 'condition x, modifier 1, amount', message: 'Longer than 200 characters' }]);
    expect(problems([{ target: 'speed', amount: true }])).toEqual([{ where: 'condition x, modifier 1, amount', message: 'A number, or formula text' }]);
    expect(problems([{ target: 'speed', way: 'times', amount: -1 }])).toEqual([{ where: 'condition x, modifier 1, amount', message: 'Times 0 to 100' }]);
    expect(problems([{ target: 'speed', way: 'times', amount: 101 }])).toEqual([{ where: 'condition x, modifier 1, amount', message: 'Times 0 to 100' }]);
    expect(problems([{ target: 'speed', way: 'set', amount: 10000 }])).toEqual([{ where: 'condition x, modifier 1, amount', message: 'From -9999 to 9999' }]);
    expect(problems([{ target: 'speed', way: 'set', amount: 0 }, { target: 'speed', way: 'times', amount: 0 }])).toEqual([]);
  });

  it('APPLIED is true or false; the conditions offered say their ways and whether applied', () => {
    expect(problems([], { applied: 'yes' })).toEqual([{ where: 'condition x, applied', message: 'Whether its modifiers are applied: true or false' }]);
    expect(checkDefinition({ ...SLOW, conditions: { prone: { applied: true } } }).problems).toEqual([]);
    const offered = Object.fromEntries(conditionsOf(SLOW).map((c) => [c.id, c]));
    expect(offered.slowed).toMatchObject({ applied: true, modifiers: [{ target: 'speed', way: 'times', amount: 0.5 }] });
    // An ADD said by nothing, however it was written.
    expect(offered.crawling.modifiers[1]).toEqual({ target: 'speed', amount: -2 });
    expect(offered.hobbled).not.toHaveProperty('applied');
    expect(offered.prone).not.toHaveProperty('applied');
  });
});

describe('the ways, after every other bonus', () => {
  it('ADDs, then AT LEAST, then TIMES rounded down, then SET TO, then AT MOST; each line says what it gave', () => {
    const done = applyBonuses(30, { adds: [{ feature: 'Ring', amount: 5 }], least: [{ feature: 'Belt', amount: 36 }], times: [{ feature: 'Slowed', amount: 0.5 }], most: [{ feature: 'Weary', amount: 10 }] });
    expect(done.value).toBe(10);
    expect(done.lines).toEqual([
      { feature: 'Ring', amount: 5, got: 5 }, { feature: 'Belt', amount: 36, got: 1, least: true },
      { feature: 'Slowed', amount: 0.5, got: -18, way: 'times' }, { feature: 'Weary', amount: 10, got: -8, way: 'most' },
    ]);
    expect(applyBonuses(35, { times: [{ feature: 'Slowed', amount: 0.5 }] }).value).toBe(17);
    expect(applyBonuses(35, { set: [{ feature: 'Pinned', amount: 0 }], most: [{ feature: 'W', amount: 20 }] }).value).toBe(0);
    expect(applyBonuses(5, { most: [{ feature: 'W', amount: 20 }] }).value).toBe(5);
  });
});

describe('on the sheet of a token that has them', () => {
  it('SLOWED: Speed halved after the ring\'s +5, a formula reading it following; said as the condition', () => {
    const data = save({ speed: 30, might: 4, ...worn, [CONDITIONS_KEY]: ['slowed'] });
    expect(overlayOf(SLOW, data).sheet.speed).toBe(17);
    expect(data.dash).toBe(34);
    expect(workedOf(SLOW, data, overlayOf(SLOW, data)).from.speed).toEqual([
      { feature: 'Ring of Striding', amount: 5 }, { feature: 'Slowed', amount: 0.5, got: -18, condition: true, way: 'times' },
    ]);
    // None on the token: as it was.
    expect(overlayOf(SLOW, save({ speed: 30, might: 4, ...worn })).sheet.speed).toBe(35);
  });

  it('a reminder changes nothing; nor ALL ROLLS; a formula\'s AT MOST; a formula amount worked out', () => {
    expect(overlayOf(SLOW, { speed: 30, [CONDITIONS_KEY]: ['hobbled'] }).sheet.speed ?? 30).toBe(30);
    const weary = save({ speed: 30, might: 4, [CONDITIONS_KEY]: ['weary'] });
    expect(overlayOf(SLOW, weary).sheet.speed).toBe(26);
    expect(weary.carry).toBe(40);
    expect(save({ speed: 30, might: 2, [CONDITIONS_KEY]: ['weary'] }).carry).toBe(20);
    expect(overlayOf(SLOW, { speed: 30, [CONDITIONS_KEY]: ['pinned'] }).sheet.speed).toBe(0);
  });

  it('they don\'t stack: of each way on one number only the strongest; a feature\'s bonus still counts beside them', () => {
    // SLOWED ×0.5 and CRAWLING ×0.25: only the quarter. CRAWLING's -2 and WEARY's -4: only the -4.
    const both = { speed: 30, might: 4, ...worn, [CONDITIONS_KEY]: ['slowed', 'crawling', 'weary'] };
    expect(overlayOf(SLOW, both).sheet.speed).toBe(Math.floor((30 + 5 - 4) * 0.25));
    const lines = workedOf(SLOW, save(both), overlayOf(SLOW, both)).from.speed;
    expect(lines.filter((l) => l.condition).map((l) => l.feature)).toEqual(['Weary', 'Crawling']);
    // The strongest TIMES whichever way it goes: ×3 beats ×0.5.
    const fast = { ...SLOW, conditions: { ...SLOW.conditions, hasted: { name: 'Hasted', applied: true, modifiers: [{ target: 'speed', way: 'times', amount: 3 }] } } };
    expect(overlayOf(fast, { speed: 10, [CONDITIONS_KEY]: ['slowed', 'hasted'] }).sheet.speed).toBe(30);
    // SET TO and AT MOST: the lowest.
    const two = { ...SLOW, conditions: { a: { name: 'A', applied: true, modifiers: [{ target: 'speed', way: 'set', amount: 12 }, { target: 'speed', way: 'most', amount: 20 }] },
      b: { name: 'B', applied: true, modifiers: [{ target: 'speed', way: 'set', amount: 15 }, { target: 'speed', way: 'most', amount: 8 }] } } };
    expect(overlayOf(two, { speed: 30, [CONDITIONS_KEY]: ['a', 'b'] }).sheet.speed).toBe(8);
    // The strongest whichever comes first.
    const first = { ...SLOW, conditions: { a: { name: 'A', applied: true, modifiers: [{ target: 'speed', way: 'times', amount: 0.25 }, { target: 'speed', amount: -6 }, { target: 'speed', way: 'set', amount: 40 }] },
      b: { name: 'B', applied: true, modifiers: [{ target: 'speed', way: 'times', amount: 0.5 }, { target: 'speed', amount: 3 }, { target: 'speed', way: 'set', amount: 50 }] } } };
    expect(workedOf(first, save({ speed: 30, [CONDITIONS_KEY]: ['a', 'b'] }, first), overlayOf(first, { speed: 30, [CONDITIONS_KEY]: ['a', 'b'] })).from.speed
      .map((l) => [l.feature, l.amount])).toEqual([['A', -6], ['A', 0.25], ['A', 40]]);
  });

  it('a stat held as ranks: changed on its step, its worth read from there; a formula\'s change said on the sheet too', () => {
    const ranked = { ...SLOW, stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'speed', label: 'Speed' }, { id: 'might', label: 'Might' }, { id: 'climb', label: 'Climb', rank: 'dots' }] }],
      ranks: [{ id: 'dots', label: 'DOTS', list: [{ name: 'NONE', worth: '0' }, { name: 'ONE', worth: '1' }, { name: 'TWO', worth: '5' }, { name: 'THREE', worth: '20' }] }],
      conditions: { tired: { name: 'Tired', applied: true, modifiers: [{ target: 'climb', way: 'times', amount: 0.5 }] } } };
    expect(checkDefinition(ranked).problems).toEqual([]);
    const data = { [stepFieldOf('climb')]: 3, [CONDITIONS_KEY]: ['tired'] };
    // Step 3 halved is step 1: worth 1, not 20 halved.
    expect(save(data, ranked).climb).toBe(1);
    const weary = save({ speed: 30, might: 4, [CONDITIONS_KEY]: ['weary'] });
    expect(workedOf(SLOW, weary, overlayOf(SLOW, weary)).from.carry).toEqual([{ feature: 'Weary', amount: 40, condition: true, way: 'most' }]);
  });

  it('a modifier whose amount can\'t be worked out is passed over; ids not a list read as none', () => {
    const odd = { ...SLOW, conditions: { drained: { name: 'Drained', applied: true, modifiers: [{ target: 'speed', amount: '@speed *' }, { target: 'nothing', amount: 2 }] } } };
    expect(overlayOf(odd, { speed: 30, [CONDITIONS_KEY]: ['drained'] }).sheet.speed ?? 30).toBe(30);
    expect(overlayOf(SLOW, { speed: 30, [CONDITIONS_KEY]: 'slowed' }).sheet.speed ?? 30).toBe(30);
  });
});

describe('the token\'s conditions on the sheet', () => {
  it('what to keep: the token\'s ids, sorted, each once; none with the table\'s switch off', () => {
    expect(conditionsToKeep('[{"id":"slowed"},{"id":"prone","left":2},{"id":"slowed"}]', true)).toEqual(['prone', 'slowed']);
    expect(conditionsToKeep('[{"id":"slowed"}]', false)).toEqual([]);
    expect(conditionsToKeep('junk', true)).toEqual([]);
  });

  let db;
  let app;
  const ID = 'sys_slowslowslowslow1';
  const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
  const was = process.env.SECURE_MODE;
  const io = { emit: vi.fn() };
  const sheet = async () => JSON.parse((await get(db, "SELECT data FROM character_sheets WHERE username = 'vex'")).data);
  beforeEach(async () => {
    process.env.SECURE_MODE = 'true';
    io.emit.mockClear();
    db = await makeTestDb();
    const def = JSON.stringify(SLOW);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Slow', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, 'INSERT INTO global_settings (key, value) VALUES (\'game_system\', ?)', [ID]);
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (\'vex\', ?, ?, 0)', [ID, JSON.stringify({ speed: 30, might: 4, ...worn })]);
    await run(db, "INSERT INTO locations (name, x, y, z, shape, owner, conditions) VALUES ('VEX', 0, 0, 0, 'rhombus', 'vex', '[]')");
    app = express();
    app.use(express.json());
    app.use('/api/locations', locationsRouteFactory(db, io, { emitUpdate: () => {}, recordAction: () => {} }));
    app.use('/api/admin', adminRouteFactory(db, io, { emitUpdate: () => {}, recordAction: () => {} }));
  });
  afterEach(() => { if (was === undefined) delete process.env.SECURE_MODE; else process.env.SECURE_MODE = was; });
  const tokenId = async () => (await get(db, "SELECT id FROM locations WHERE owner = 'vex'")).id;

  it('SLOWED put on the token: kept on the sheet, Speed worked out at once, the sheet told; off again, back', async () => {
    const res = await request(app).put(`/api/locations/${await tokenId()}/conditions`).set({ Authorization: `Bearer ${GM}` }).send({ conditions: [{ id: 'slowed' }] });
    expect(res.status).toBe(200);
    await until(async () => (await sheet()).dash === 34, { label: 'dash halved' });
    expect((await sheet())[CONDITIONS_KEY]).toEqual(['slowed']);
    expect(io.emit).toHaveBeenCalledWith('sheetUpdated', { username: 'vex', system: ID });
    await request(app).put(`/api/locations/${await tokenId()}/conditions`).set({ Authorization: `Bearer ${GM}` }).send({ conditions: [] });
    await until(async () => (await sheet()).dash === 70, { label: 'dash back' });
    expect(await sheet()).not.toHaveProperty(CONDITIONS_KEY);
  });

  it('the table\'s APPLY CONDITION MODIFIERS off: every player\'s numbers back as reminders; on again, applied', async () => {
    await run(db, "UPDATE locations SET conditions = '[{\"id\":\"slowed\"}]' WHERE owner = 'vex'");
    await syncConditionsOnSheet(db, { username: 'vex', io, runtime });
    expect((await sheet()).dash).toBe(34);
    await request(app).post('/api/admin/settings').set({ Authorization: `Bearer ${GM}` }).send({ key: CONDITIONS_SETTING, value: '0' });
    await until(async () => (await sheet()).dash === 70, { label: 'a reminder' });
    await request(app).post('/api/admin/settings').set({ Authorization: `Bearer ${GM}` }).send({ key: CONDITIONS_SETTING, value: '1' });
    await until(async () => (await sheet()).dash === 34, { label: 'applied again' });
  });

  it('nothing written: when nothing changed, for a system whose conditions apply nothing, without a sheet or a game', async () => {
    await syncConditionsOnSheet(db, { username: 'vex', io, runtime });
    await drain(db);
    expect(await sheet()).not.toHaveProperty(CONDITIONS_KEY);
    expect(io.emit).not.toHaveBeenCalled();
    const plain = JSON.stringify({ ...SLOW, conditions: { hobbled: SLOW.conditions.hobbled } });
    await run(db, 'UPDATE custom_systems SET published = ? WHERE id = ?', [plain, ID]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, "UPDATE locations SET conditions = '[{\"id\":\"hobbled\"}]' WHERE owner = 'vex'");
    await syncConditionsOnSheet(db, { username: 'vex', io, runtime });
    expect(await sheet()).not.toHaveProperty(CONDITIONS_KEY);
    await syncConditionsOnSheet(db, { username: 'nobody', io, runtime });
    await run(db, "DELETE FROM global_settings WHERE key = 'game_system'");
    await syncConditionsOnSheet(db, { username: 'vex', io, runtime });
    expect(io.emit).not.toHaveBeenCalled();
  });

  it('a sheet holding them, its token gone: taken off, as nothing is on it', async () => {
    await run(db, "UPDATE locations SET conditions = '[{\"id\":\"slowed\"}]' WHERE owner = 'vex'");
    await syncConditionsOnSheet(db, { username: 'vex', io, runtime });
    await run(db, "DELETE FROM locations WHERE owner = 'vex'");
    await syncConditionsOnSheet(db, { username: 'vex', io, runtime });
    expect(await sheet()).not.toHaveProperty(CONDITIONS_KEY);
    expect((await sheet()).dash).toBe(70);
  });
});

describe('what takes one off works the sheet out again (8a5e1)', () => {
  let db;
  const ID = 'sys_slowroundsslowrnd';
  const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
  const ROUNDS = { ...SLOW, resting: { finish: 'sheet' }, conditions: {
    slowed: { name: 'Slowed', applied: true, ends: 'rounds', rounds: 1, modifiers: [{ target: 'speed', way: 'set', amount: 5 }] },
    tired: { name: 'Tired', applied: true, ends: 'rest', at: ['short_rest'], modifiers: [{ target: 'might', way: 'times', amount: 0.5 }] },
  } };
  const sheet = async () => JSON.parse((await get(db, "SELECT data FROM character_sheets WHERE username = 'vex'")).data);
  const connect = async (who, identity) => {
    const connections = [];
    const io = { on: (e, cb) => { if (e === 'connection') connections.push(cb); }, emit: () => {}, to: () => ({ emit: () => {} }) };
    const socketsFactory = (await import('../sockets/index.js')).default;
    socketsFactory(io, db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const handlers = {};
    const socket = { id: `s-${who}-${Math.random()}`, on: (e, fn) => { handlers[e] = fn; }, emit: () => {}, broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} };
    connections.forEach((cb) => cb(socket));
    handlers.identify(identity);
    await drain(db);
    return handlers;
  };
  beforeEach(async () => {
    db = await makeTestDb();
    await run(db, `CREATE TABLE IF NOT EXISTS initiative_combat (id INTEGER PRIMARY KEY AUTOINCREMENT, turn_counter INTEGER DEFAULT 1,
      pass_counter INTEGER DEFAULT 1, system TEXT DEFAULT 'generic', mode TEXT DEFAULT 'individual', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await run(db, `CREATE TABLE IF NOT EXISTS initiative_scene (scene_key TEXT PRIMARY KEY, combat_id INTEGER NOT NULL, combatants TEXT NOT NULL DEFAULT '[]',
      sides TEXT NOT NULL DEFAULT '[]', turn_index INTEGER DEFAULT 0, turn_counter INTEGER DEFAULT 1, pass_counter INTEGER DEFAULT 1, begun INTEGER DEFAULT 0, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await run(db, `CREATE TABLE IF NOT EXISTS dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER, results TEXT, color TEXT, historyString TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    const def = JSON.stringify(ROUNDS);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Slow rounds', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, 'INSERT INTO global_settings (key, value) VALUES (\'game_system\', ?)', [ID]);
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (\'vex\', ?, ?, 0)', [ID, JSON.stringify(save({ name: 'Vex', speed: 30, might: 4, [CONDITIONS_KEY]: ['slowed', 'tired'] }, ROUNDS))]);
    await run(db, "INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max, hp_temp, conditions) VALUES ('VEX', 0, 0, 0, 'rhombus', 'vex', 10, 10, 0, ?)", ['[{"id":"slowed","left":1},{"id":"tired"}]']);
  });

  it('a new round ending SLOWED: Speed back at once', async () => {
    expect((await sheet()).dash).toBe(10);
    const combat = (await run(db, 'INSERT INTO initiative_combat (system, mode) VALUES (?, ?)', ['generic', 'individual'])).lastID;
    await run(db, 'INSERT INTO initiative_scene (scene_key, combat_id, combatants, sides, turn_index) VALUES (?, ?, ?, ?, ?)', ['main', combat, JSON.stringify([{ id: 'player:vex', score: 8 }]), '[]', 0]);
    const gm = await connect('gm', { userName: 'gm', isAdmin: true, token: GM });
    gm['initiative:next']({ sceneKey: 'main' });
    await until(async () => (await sheet())[CONDITIONS_KEY]?.join() === 'tired', { label: 'slowed gone from the sheet' });
    await until(async () => (await sheet()).dash === 60, { label: 'speed back' });
    expect((await sheet()).carry).toBe(20);
  });

  it('a short rest wearing TIRED off: Might back at once', async () => {
    expect((await sheet()).carry).toBe(20);
    const vex = await connect('vex', 'vex');
    vex.restTake({ rest: 'short_rest' });
    await until(async () => (await sheet())[CONDITIONS_KEY]?.join() === 'slowed', { label: 'tired gone from the sheet' });
    await until(async () => (await sheet()).carry === 40, { label: 'might back' });
    expect((await sheet()).dash).toBe(10);
  });
});

describe('said on the sheet in a system with no picks or items (8a5e3)', () => {
  it('a condition APPLIED on the token: the worked-out lines written; none on it, none written', () => {
    const plain = { ...SLOW, items: undefined };
    const on = save({ speed: 30, [CONDITIONS_KEY]: ['slowed'] }, plain);
    expect(on._worked.from.speed).toEqual([{ feature: 'Slowed', amount: 0.5, got: -15, condition: true, way: 'times' }]);
    expect(save({ speed: 30 }, plain)).not.toHaveProperty('_worked');
    // Only a reminder on the token: nothing to say.
    expect(save({ speed: 30, [CONDITIONS_KEY]: ['hobbled'] }, { ...plain, conditions: { hobbled: SLOW.conditions.hobbled } })).not.toHaveProperty('_worked');
  });
});
