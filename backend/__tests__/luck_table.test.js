/**
 * Luck at the table (8c5a; approved mockup docs/mockups/rule-library.html, answers 6 and 7): points set aside on the strip are
 * spent by the next roll from the sheet, +1 or a die each, taken off the sheet as it is then; a roll luck isn't on, or asking for
 * more than is left, rolls nothing. The GM's REFILL LUCK puts every player's character back to their most.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import jwt from 'jsonwebtoken';
import { makeTestDb, run, get } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';
const require_ = createRequire(import.meta.url);
const runtime = require_('../systemBuilder/runtime');
const { LUCK_KEY } = require_('../systemBuilder/luck');
const socketsFactory = (await import('../sockets/index.js')).default;

const ID = 'sys_luckluckluckluck1';
const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
const SYSTEM = (luck) => ({
  format: 1, name: 'Luckfall', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'aim', label: 'Aim' }, { id: 'luck', label: 'Luck' }] }],
  rolls: [
    { id: 'shoot', label: 'Shoot', dice: [{ count: '2', sides: 6 }], add: '@this', by: ['aim'] },
    { id: 'dodge', label: 'Dodge', dice: [{ count: '1', sides: 20 }], add: '@this', by: ['luck'] },
  ],
  ...(luck ? { luck } : {}),
});

let db;
let emitted;
let handlers;
const setUp = async (luck = { name: 'Luck', most: '@luck', each: 'plus', on: 'all' }, as = 'kes') => {
  db = await makeTestDb();
  await run(db, `CREATE TABLE IF NOT EXISTS dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER, results TEXT, color TEXT, historyString TEXT,
    players_history TEXT, seen_by TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  const def = JSON.stringify(SYSTEM(luck));
  await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Luckfall', def, def]);
  await new Promise((resolve) => runtime.load(db, resolve));
  await run(db, 'INSERT INTO global_settings (key, value) VALUES (\'game_system\', ?)', [ID]);
  await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (\'kes\', ?, ?, 0)', [ID, JSON.stringify({ name: 'Kes', aim: 3, luck: 4 })]);
  await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (\'ash\', ?, ?, 0)', [ID, JSON.stringify({ name: 'Ash', aim: 1, luck: 2, [LUCK_KEY]: 0 })]);
  await run(db, 'INSERT INTO locations (name, shape, owner, x, z, hp_current, hp_max) VALUES (\'Kes\', \'rhombus\', \'kes\', 0, 0, 10, 10)');
  emitted = [];
  let connection;
  socketsFactory({ on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: (event, data) => emitted.push({ event, data }), to: () => ({ emit: () => {} }) },
    db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
  handlers = {};
  connection({ id: `luck-${as}`, on: (e, fn) => { handlers[e] = fn; }, emit: (event, data) => emitted.push({ event, data }), broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
  handlers.identify(as === 'gm' ? { userName: 'gm', isAdmin: true, token: GM } : as);
  await drain(db);
};
const kept = async (username) => JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', [username])).data)[LUCK_KEY];
const rolls = () => emitted.filter((e) => e.event === 'diceRollBroadcast').map((e) => e.data);

describe('spent on a roll from the sheet', () => {
  beforeEach(() => setUp());

  it('+1 a point: the roll says LUCK, the points come off the sheet', async () => {
    handlers.requestSheetRoll({ fieldId: 'aim', luck: 2 });
    await until(() => rolls().length === 1, { label: 'the roll' });
    expect(rolls()[0].historyString).toMatch(/Shoot \(Aim\).*LUCK/);
    await until(async () => (await kept('kes')) === 2, { label: 'two spent' });
  });

  it('more than is left, or none of it a whole number above 0: nothing spent; asking for more than left rolls nothing', async () => {
    handlers.requestSheetRoll({ fieldId: 'aim', luck: 5 });
    handlers.requestSheetRoll({ fieldId: 'aim', luck: 'two' });
    // A number written as words is not one: rolled plain.
    handlers.requestSheetRoll({ fieldId: 'aim', luck: '2' });
    await until(() => rolls().length === 2, { label: 'only the plain rolls' });
    await drain(db);
    expect(rolls()).toHaveLength(2);
    for (const r of rolls()) expect(r.historyString).not.toContain('LUCK');
    expect(await kept('kes')).toBeUndefined();
  });
});

describe('a die a point, on only some rolls', () => {
  beforeEach(() => setUp({ name: 'Edge', most: '3', each: 'die', on: ['shoot'] }));

  it('more dice of the roll\'s kind on a roll it is on; a roll it isn\'t on, nothing rolled', async () => {
    handlers.requestSheetRoll({ fieldId: 'aim', luck: 1 });
    await until(() => rolls().length === 1, { label: 'the roll' });
    expect(rolls()[0].historyString).toContain('1 EDGE');
    expect(rolls()[0].results['6']).toHaveLength(3);
    await until(async () => (await kept('kes')) === 2, { label: 'one spent' });
    handlers.requestSheetRoll({ fieldId: 'luck', luck: 1 });
    await drain(db);
    expect(rolls()).toHaveLength(1);
    expect(await kept('kes')).toBe(2);
  });
});

describe('without luck', () => {
  it('a game without it: a roll asking to spend some is not made', async () => {
    await setUp(null);
    handlers.requestSheetRoll({ fieldId: 'aim', luck: 1 });
    handlers.requestSheetRoll({ fieldId: 'aim' });
    await until(() => rolls().length === 1, { label: 'the plain roll' });
    await drain(db);
    expect(rolls()).toHaveLength(1);
  });
});

describe('REFILL LUCK, the GM\'s', () => {
  it('every player\'s character back to their most; a player may not', async () => {
    await setUp(undefined, 'kes');
    expect(await new Promise((ok) => handlers.refillLuck(ok))).toEqual({ ok: false, error: 'The GM\'s to do' });
    await setUp(undefined, 'gm');
    await run(db, 'UPDATE character_sheets SET data = json_set(data, \'$._luck\', 1) WHERE username = \'kes\'');
    expect(await new Promise((ok) => handlers.refillLuck(ok))).toEqual({ ok: true, refilled: 2 });
    expect(await kept('kes')).toBeUndefined();
    expect(await kept('ash')).toBeUndefined();
    expect(emitted.filter((e) => e.event === 'sheetUpdated').map((e) => e.data.username).sort()).toEqual(['ash', 'kes']);
    expect(await new Promise((ok) => handlers.refillLuck(ok))).toEqual({ ok: true, refilled: 0 });
    // Its answer as the only argument too.
    expect(await new Promise((ok) => handlers.refillLuck({}, ok))).toEqual({ ok: true, refilled: 0 });
  });

  it('a game without luck: said so', async () => {
    await setUp(null, 'gm');
    expect(await new Promise((ok) => handlers.refillLuck(ok))).toEqual({ ok: false, error: 'This game has no luck' });
  });
});

describe('worked out for the strip (8c6)', () => {
  it("what is left of the most, beside the sheet's other worked values; nothing in a game without luck", async () => {
    await setUp();
    const { applyDerived } = require_('../sheets/templates');
    const data = { name: 'Kes', aim: 3, luck: 4, [LUCK_KEY]: 1 };
    applyDerived(ID, data);
    expect(data._worked.luck).toEqual({ current: 1, most: 4 });
    const full = { name: 'Kes', aim: 3, luck: 4 };
    applyDerived(ID, full);
    expect(full._worked.luck).toEqual({ current: 4, most: 4 });
    await setUp(null);
    const none = { name: 'Kes', aim: 3, luck: 4 };
    applyDerived(ID, none);
    expect(none._worked?.luck).toBeUndefined();
  });
});
