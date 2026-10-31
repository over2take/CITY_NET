/**
 * Recovery dice at the table (R2a; approved mockup docs/mockups/rest-on-sheet.html, 2026-10-30): a
 * character's pools from their picks, spent with a roll that heals through the health model and is a
 * dice-log line for everyone, ticked off for real dice, given back by rests; any time, or, where the
 * system leaves it to the GM, only while the GM has spending open. Through the socket, as a player
 * and as the GM.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';

const require_ = createRequire(import.meta.url);
const { poolsOf, spendFrom, givenBack, maySpend, RECOVERY_KEY, ALL_POOL, OPEN_SETTING, MOST } = require_('../systemBuilder/recovery');
const { PICKS_KEY, WORKED_KEY } = require_('../systemBuilder/choices');
const { pickAction } = require_('../systemBuilder/picking');
const { checkDefinition } = require_('../systemBuilder/definition');
const { restOn, restLine } = require_('../systemBuilder/resting');
const { spendLine } = require_('../sheets/recover');
const { CLOSED } = require_('../sockets/choices');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = (await import('../sockets/index.js')).default;

const FORGE = {
  format: 1, name: 'Forge',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Constitution' }] }],
  derived: [{ id: 'con_mod', label: 'CON modifier', formula: 'floor((@con - 10) / 2)' }],
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, again: true, options: [
      { id: 'fighter', label: 'Fighter', die: 10 }, { id: 'wizard', label: 'Wizard', die: 6 }, { id: 'rogue', label: 'Rogue' },
    ] },
    { id: 'feats', one: 'Feat', many: 'Feats', options: [{ id: 'tough', label: 'Tough' }] },
  ],
  resting: { recovery: { name: 'Hit Dice', plus: '@con_mod', spent_at: ['short_rest'], back: [{ rest: 'long_rest', how: 'half' }] } },
};
/** 13th Age's: 8 of the largest die, each healing it once per level. */
const AGE = { ...FORGE, resting: { recovery: { name: 'Recoveries', count: '8', per_level: true, spent_at: 'any', back: [{ rest: 'long_rest', how: 'all' }] } } };
const withRecovery = (patch) => ({ ...FORGE, resting: { recovery: { ...FORGE.resting.recovery, ...patch } } });
/** Fighter 3 / Wizard 2 / Rogue 1, CON 14. */
const ROOK = { con: 14, con_mod: 2, [PICKS_KEY]: { classes: [{ option: 'fighter', level: 3 }, { option: 'wizard', level: 2 }, { option: 'rogue', level: 1 }] } };
const sixes = () => 0.5; // d10 → 6, d6 → 4

describe('the pools', () => {
  it('the systems check clean, the spend setting too', () => {
    expect(checkDefinition(FORGE).problems).toEqual([]);
    expect(checkDefinition(AGE).problems).toEqual([]);
    expect(checkDefinition(withRecovery({ spend: 'gm' })).problems).toEqual([]);
    expect(checkDefinition(withRecovery({ spend: 'player' })).problems.map((p) => `${p.where}: ${p.message}`))
      .toEqual(['resting, recovery, spend: any (any time) or gm (while the GM has spending open)']);
  });

  it('counted by levels: one for each class with a die, as many as its level; none spent', () => {
    expect(poolsOf(FORGE, ROOK)).toEqual([
      { id: 'fighter', label: 'Fighter', die: 10, total: 3, spent: 0, times: 1 },
      { id: 'wizard', label: 'Wizard', die: 6, total: 2, spent: 0, times: 1 },
    ]);
  });

  it('counted by a formula: one pool of that many, of the largest die, healing once per level of the classes with a die', () => {
    expect(poolsOf(AGE, ROOK)).toEqual([{ id: ALL_POOL, label: 'Recoveries', die: 10, total: 8, spent: 0, times: 5 }]);
    expect(poolsOf({ ...AGE, resting: { recovery: { ...AGE.resting.recovery, count: '@con_mod + 100', per_level: false } } }, ROOK)[0]).toMatchObject({ total: MOST.pool, times: 1 });
    expect(poolsOf({ ...AGE, resting: { recovery: { ...AGE.resting.recovery, count: '0 - 3' } } }, ROOK)[0].total).toBe(0);
    // Once per level, counted by levels: each class's own level.
    expect(poolsOf(withRecovery({ per_level: true }), ROOK).map((p) => p.times)).toEqual([3, 2]);
  });

  it('what is spent, held to the pool; none without recovery dice or a class with a die', () => {
    expect(poolsOf(FORGE, { ...ROOK, [RECOVERY_KEY]: { fighter: 2, wizard: 9, gone: 1 } }).map((p) => p.spent)).toEqual([2, 2]);
    expect(poolsOf(FORGE, { ...ROOK, [RECOVERY_KEY]: { fighter: -1, wizard: 1.5 } }).map((p) => p.spent)).toEqual([0, 0]);
    expect(poolsOf({ ...FORGE, resting: undefined }, ROOK)).toEqual([]);
    expect(poolsOf(FORGE, { [PICKS_KEY]: { classes: [{ option: 'rogue', level: 4 }] } })).toEqual([]);
    expect(poolsOf(FORGE, {})).toEqual([]);
    // A stray die on a list every character has (refused by the checks) is never a pool, though its options have a level.
    const everyone = { ...FORGE, choices: [...FORGE.choices, { id: 'kin', one: 'Kin', many: 'Kin', picked: 'everyone', options: [{ id: 'giant', label: 'Giant', die: 12 }] }] };
    expect(poolsOf(everyone, ROOK).map((p) => p.id)).toEqual(['fighter', 'wizard']);
  });

  it('a formula\'s pool takes the largest die, whichever class comes first', () => {
    const wizardFirst = { ...ROOK, [PICKS_KEY]: { classes: [{ option: 'wizard', level: 2 }, { option: 'fighter', level: 1 }] } };
    expect(poolsOf(AGE, wizardFirst)[0]).toMatchObject({ die: 10, times: 3 });
  });
});

describe('spending', () => {
  it('rolls the die for each, the plus formula added for each, and marks them spent', () => {
    const s = spendFrom(FORGE, ROOK, 'fighter', 2, sixes);
    expect(s).toMatchObject({ ok: true, count: 2, rolls: [6, 6], plus: 4, heal: 16 });
    expect(s.data[RECOVERY_KEY]).toEqual({ fighter: 2 });
    expect(spendFrom(FORGE, s.data, 'fighter', 1, sixes).data[RECOVERY_KEY]).toEqual({ fighter: 3 });
    // The other pool keeps its own.
    expect(spendFrom(FORGE, { ...ROOK, [RECOVERY_KEY]: { fighter: 1 } }, 'wizard', 1, sixes).data[RECOVERY_KEY]).toEqual({ fighter: 1, wizard: 1 });
  });

  it('once per level rolls the die that many times; with no plus, nothing added; never heals below 0', () => {
    expect(spendFrom(AGE, ROOK, ALL_POOL, 1, sixes)).toMatchObject({ rolls: [6, 6, 6, 6, 6], plus: 0, heal: 30 });
    const weak = { ...ROOK, con: 2, con_mod: -4 };
    expect(spendFrom(FORGE, weak, 'wizard', 1, () => 0)).toMatchObject({ rolls: [1], plus: -4, heal: 0 });
  });

  it('says why not: a pool they haven\'t got, none, more than are left', () => {
    expect(spendFrom(FORGE, ROOK, 'rogue', 1, sixes)).toEqual({ ok: false, error: 'No such recovery dice on this character' });
    expect(spendFrom(FORGE, ROOK, 'fighter', 0, sixes)).toEqual({ ok: false, error: 'Spend at least one' });
    expect(spendFrom(FORGE, ROOK, 'fighter', 1.5, sixes)).toEqual({ ok: false, error: 'Spend at least one' });
    expect(spendFrom(FORGE, { ...ROOK, [RECOVERY_KEY]: { fighter: 2 } }, 'fighter', 2, sixes)).toEqual({ ok: false, error: 'Only 1 left' });
  });

  it('the dice-log line names what was spent, the sum, and the health it moved', () => {
    const s = spendFrom(FORGE, ROOK, 'fighter', 2, sixes);
    expect(spendLine('Hit Dice', 'Rook', s, { label: 'HP', from: 21, to: 37 })).toBe('HIT DICE · Rook: spent 2 Fighter d10, 6 + 6 + 4 = 16 · HP 21 → 37');
    const age = spendFrom(AGE, ROOK, ALL_POOL, 1, sixes);
    expect(spendLine('Recoveries', 'Rook', age, null)).toBe('RECOVERIES · Rook: spent 1 d10, 6 + 6 + 6 + 6 + 6 = 30');
    const weak = spendFrom(FORGE, { ...ROOK, con_mod: -4 }, 'wizard', 1, () => 0);
    expect(spendLine('Hit Dice', 'Rook', weak, null)).toBe('HIT DICE · Rook: spent 1 Wizard d6, 1 - 4 = 0');
  });

  it('the system file carries who says when, installed with no problems', () => {
    const citysys = require_('../systemBuilder/citysys');
    const read = citysys.readFile(JSON.stringify(citysys.buildFile({ definition: withRecovery({ spend: 'gm' }), version: 1, origin: 'forge' })));
    expect(read.problems).toEqual([]);
    expect(read.file.definition.resting.recovery.spend).toBe('gm');
  });

  it('players may spend any time; where the GM has the say, only while it is open; the GM always', () => {
    expect(maySpend(FORGE)).toBe(true);
    const gm = withRecovery({ spend: 'gm' });
    expect(maySpend(gm)).toBe(false);
    expect(maySpend(gm, { open: true })).toBe(true);
    expect(maySpend(gm, { gm: true })).toBe(true);
    expect(maySpend({ ...FORGE, resting: undefined }, { gm: true })).toBe(false);
  });
});

describe('ticking off and putting right', () => {
  it('a pool\'s spent set from none to all of them, by the player or the GM', () => {
    expect(pickAction(FORGE, ROOK, { kind: 'recovery', pool: 'fighter', spent: 3 }).data[RECOVERY_KEY]).toEqual({ fighter: 3 });
    expect(pickAction(FORGE, { ...ROOK, [RECOVERY_KEY]: { fighter: 3, wizard: 1 } }, { kind: 'recovery', pool: 'fighter', spent: 0 }).data[RECOVERY_KEY]).toEqual({ fighter: 0, wizard: 1 });
    for (const bad of [4, -1, 1.5, 'x']) expect(pickAction(FORGE, ROOK, { kind: 'recovery', pool: 'fighter', spent: bad }), String(bad)).toEqual({ ok: false, error: 'Between none and all 3 of them' });
    expect(pickAction(FORGE, ROOK, { kind: 'recovery', pool: 'rogue', spent: 1 })).toEqual({ ok: false, error: 'This character has no such recovery dice' });
  });
});

describe('given back by rests', () => {
  const spent = { ...ROOK, [RECOVERY_KEY]: { fighter: 3, wizard: 1 } };

  it('half of each pool\'s dice, at least 1, at the rest that gives them back or one counting as it', () => {
    const long = restOn({ definition: FORGE, restId: 'long_rest', sheet: spent });
    expect(long.sheetPatch[RECOVERY_KEY]).toEqual({ fighter: 2, wizard: 0 });
    expect(long.changes).toEqual([
      { what: 'recovery:fighter', label: 'Hit Dice Fighter d10', from: 0, to: 1 },
      { what: 'recovery:wizard', label: 'Hit Dice Wizard d6', from: 1, to: 2 },
    ]);
    expect(restLine(FORGE, 'Long rest', 'Rook', long)).toBe('LONG REST · Rook: Hit Dice Fighter d10 0 → 1, Hit Dice Wizard d6 1 → 2');
    const camp = { ...FORGE, rests: { camp: { name: 'Camp', counts_as: ['long_rest'] } } };
    expect(restOn({ definition: camp, restId: 'camp', sheet: spent }).sheetPatch[RECOVERY_KEY]).toEqual({ fighter: 2, wizard: 0 });
    // A rest that doesn't give them back, or nothing spent: nothing written.
    expect(restOn({ definition: FORGE, restId: 'short_rest', sheet: spent }).sheetPatch).not.toHaveProperty(RECOVERY_KEY);
    expect(restOn({ definition: FORGE, restId: 'long_rest', sheet: ROOK }).sheetPatch).not.toHaveProperty(RECOVERY_KEY);
  });

  it('all of them, or by an amount worked out on the sheet; one pool for a formula\'s count', () => {
    const all = withRecovery({ back: [{ rest: 'long_rest', how: 'all' }] });
    expect(givenBack(all, spent, new Set(['long_rest'])).spent).toEqual({ fighter: 0, wizard: 0 });
    const by = withRecovery({ back: [{ rest: 'long_rest', how: 'by', amount: '@con_mod' }] });
    expect(givenBack(by, spent, new Set(['long_rest'])).spent).toEqual({ fighter: 1, wizard: 0 });
    const none = withRecovery({ back: [{ rest: 'long_rest', how: 'by', amount: '0 - 5' }] });
    expect(givenBack(none, spent, new Set(['long_rest']))).toBeNull();
    const age = restOn({ definition: AGE, restId: 'long_rest', sheet: { ...ROOK, [RECOVERY_KEY]: { [ALL_POOL]: 5 } } });
    expect(age.changes).toEqual([{ what: `recovery:${ALL_POOL}`, label: 'Recoveries d10', from: 3, to: 8 }]);
  });

  it('half of a pool of one gives back one', () => {
    const one = { ...ROOK, [PICKS_KEY]: { classes: [{ option: 'wizard', level: 1 }] }, [RECOVERY_KEY]: { wizard: 1 } };
    expect(givenBack(FORGE, one, new Set(['long_rest'])).spent).toEqual({ wizard: 0 });
  });

  it('two rests giving them back, both counted', () => {
    const both = withRecovery({ back: [{ rest: 'short_rest', how: 'by', amount: '1' }, { rest: 'long_rest', how: 'by', amount: '1' }] });
    const def = { ...both, rests: { long_rest: { counts_as: ['short_rest'] } } };
    expect(restOn({ definition: def, restId: 'long_rest', sheet: spent }).sheetPatch[RECOVERY_KEY]).toEqual({ fighter: 1, wizard: 0 });
  });
});

describe('through the socket', () => {
  let db;
  const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
  const ID = 'sys_recoverrecover';

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
      return { handlers, refused: () => [...said('choicesRefused'), ...said('recoveryRefused')] };
    };
    return { shared, gm: await join('gm', { userName: 'gm', isAdmin: true, token: GM }), rook: await join('rook', 'rook') };
  };
  const stored = async () => JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', ['rook'])).data);
  const token = () => get(db, `SELECT hp_current, hp_max FROM locations WHERE owner = 'rook'`);
  const install = async (definition) => {
    const def = JSON.stringify(definition);
    await run(db, 'DELETE FROM custom_systems');
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, definition.name, def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
  };

  beforeEach(async () => {
    db = await makeTestDb();
    await run(db, `CREATE TABLE IF NOT EXISTS dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, total INTEGER NOT NULL,
      results TEXT NOT NULL, color TEXT NOT NULL, historyString TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await install(FORGE);
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [ID]);
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('rook', ?, ?, 0)`, [ID, JSON.stringify({ name: 'Rook', ...ROOK })]);
    for (const n of [1, 2]) {
      await run(db, 'INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max, hp_temp, conditions) VALUES (?, 0, 0, 0, ?, ?, ?, ?, 0, ?)', [`Rook ${n}`, 'rhombus', 'rook', 21, 37, '[]']);
    }
  });

  it('every save shows the pools; a player spends some, healed on every token, a roll for everyone', async () => {
    const { rook, shared } = await table();
    rook.handlers.choicesAction({ kind: 'recovery', pool: 'wizard', spent: 0 });
    await until(async () => !!(await stored())[WORKED_KEY]?.recovery, { label: 'the pools shown' });
    expect((await stored())[WORKED_KEY].recovery).toEqual([
      { id: 'fighter', label: 'Fighter', die: 10, total: 3, spent: 0 }, { id: 'wizard', label: 'Wizard', die: 6, total: 2, spent: 0 },
    ]);
    rook.handlers.recoverySpend({ pool: 'fighter', count: 2 });
    await until(async () => (await stored())[RECOVERY_KEY]?.fighter === 2, { label: 'spent' });
    await until(() => shared.some((e) => e.event === 'diceRollBroadcast'), { label: 'the roll' });
    const roll = shared.find((e) => e.event === 'diceRollBroadcast').data;
    const dice = roll.results[10];
    expect(dice).toHaveLength(2);
    expect(roll).toMatchObject({ userName: 'Rook', account: 'rook', modifiers: [4], total: dice[0] + dice[1] + 4 });
    expect(roll.historyString).toBe(`HIT DICE · Rook: spent 2 Fighter d10, ${dice[0]} + ${dice[1]} + 4 = ${roll.total} · HP 21 → ${Math.min(37, 21 + roll.total)}`);
    await until(async () => (await token()).hp_current !== 21, { label: 'healed' });
    const tokens = await new Promise((ok) => db.all(`SELECT hp_current FROM locations WHERE owner = 'rook'`, (e, rows) => ok(rows)));
    expect(tokens.map((t) => t.hp_current)).toEqual(Array(2).fill(Math.min(37, 21 + roll.total)));
    expect((await get(db, 'SELECT historyString FROM dice_rolls')).historyString).toBe(roll.historyString);
    expect(shared.filter((e) => e.event === 'sheetUpdated').map((e) => e.data)).toContainEqual({ username: 'rook', system: ID });
    expect((await stored())[WORKED_KEY].recovery[0].spent).toBe(2);
    expect(rook.refused()).toEqual([]);
  });

  it('a player is told why not, and nothing is written: more than are left, none at all', async () => {
    const { rook, shared } = await table();
    rook.handlers.recoverySpend({ pool: 'fighter', count: 4 });
    await until(() => rook.refused().length === 1, { label: 'the refusal' });
    rook.handlers.recoverySpend({ pool: 'rogue', count: 1 });
    await until(() => rook.refused().length === 2, { label: 'the second' });
    expect(rook.refused()).toEqual(['Only 3 left', 'No such recovery dice on this character']);
    expect((await stored())[RECOVERY_KEY]).toBeUndefined();
    expect(shared.some((e) => e.event === 'diceRollBroadcast')).toBe(false);
  });

  it('where the GM has the say: refused while closed, spent and ticked once open; the GM any time', async () => {
    await install(withRecovery({ spend: 'gm' }));
    const { rook, gm } = await table();
    rook.handlers.recoverySpend({ pool: 'fighter', count: 1 });
    rook.handlers.choicesAction({ kind: 'recovery', pool: 'fighter', spent: 1 });
    await until(() => rook.refused().length === 2, { label: 'both refused' });
    expect(rook.refused()).toEqual([CLOSED, CLOSED]);
    expect(CLOSED).toBe('The GM hasn\'t opened spending recovery dice');
    gm.handlers.choicesAction({ kind: 'recovery', pool: 'wizard', spent: 1, username: 'rook' });
    await until(async () => (await stored())[RECOVERY_KEY]?.wizard === 1, { label: 'the GM\'s tick' });
    await run(db, 'INSERT INTO global_settings (key, value) VALUES (?, ?)', [OPEN_SETTING, '1']);
    rook.handlers.recoverySpend({ pool: 'fighter', count: 1 });
    await until(async () => (await stored())[RECOVERY_KEY]?.fighter === 1, { label: 'spent once open' });
    await run(db, 'UPDATE global_settings SET value = ? WHERE key = ?', ['0', OPEN_SETTING]);
    rook.handlers.choicesAction({ kind: 'recovery', pool: 'fighter', spent: 0 });
    await until(() => rook.refused().length === 3, { label: 'closed again' });
    expect(gm.refused()).toEqual([]);
  });

  it('a spend that isn\'t a whole number of dice, or names no pool, is ignored', async () => {
    const { rook, shared } = await table();
    for (const bad of [{ pool: 'fighter', count: 0 }, { pool: 'fighter', count: 1.5 }, { pool: 'fighter', count: 101 }, { count: 1 }, null]) rook.handlers.recoverySpend(bad);
    await drain(db);
    expect(rook.refused()).toEqual([]);
    expect(shared.some((e) => e.event === 'diceRollBroadcast')).toBe(false);
  });

  it('a roll that can\'t be logged still goes out: the dice were spent', async () => {
    await run(db, 'DROP TABLE dice_rolls');
    const { rook, shared } = await table();
    const said = vi.spyOn(console, 'error').mockImplementation(() => {});
    rook.handlers.recoverySpend({ pool: 'wizard', count: 1 });
    await until(() => shared.some((e) => e.event === 'diceRollBroadcast'), { label: 'the roll' });
    expect(said.mock.calls.some(([m]) => String(m).startsWith('[recovery] roll not logged'))).toBe(true);
    said.mockRestore();
    expect(rook.refused()).toEqual([]);
  });

  it('a character with no token rolls and spends, healing nothing', async () => {
    await run(db, `DELETE FROM locations WHERE owner = 'rook'`);
    const { rook, shared } = await table();
    rook.handlers.recoverySpend({ pool: 'wizard', count: 1 });
    await until(() => shared.some((e) => e.event === 'diceRollBroadcast'), { label: 'the roll' });
    expect(shared.find((e) => e.event === 'diceRollBroadcast').data.historyString).toMatch(/^HIT DICE · Rook: spent 1 Wizard d6, \d \+ 2 = \d$/);
    expect((await stored())[RECOVERY_KEY]).toEqual({ wizard: 1 });
    expect(shared.some((e) => e.event === 'dataUpdated')).toBe(false);
  });
});
